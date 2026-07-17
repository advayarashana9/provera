import re
import math
import logging
from typing import List, Optional, Tuple, Dict, Any
from datetime import datetime

from app.models.claim_audit import (
    ExtractedClaim,
    ClaimEvidence,
    ClaimCalculation,
    ClaimAuditResult,
)
from app.models.financial_fact import NormalizedFinancialFact, CompanyFactsResponse
from app.services.fact_normalizer import FactNormalizerService, normalize_value, format_value_with_unit

logger = logging.getLogger(__name__)

# Map core metrics to acceptable SEC concepts — full alias registry.
# Ordered by preference: most specific / most common concept first.
CONCEPT_MAPPINGS: Dict[str, List[str]] = {
    "revenue": [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "Revenues",
        "SalesRevenueNet",
        "SalesRevenueGoodsNet",
        "SalesRevenueServicesNet",
        "OperatingRevenue",
        "TotalRevenue",
        "NetSales",
        "RevenueFromRelatedParties",
    ],
    "net_income": [
        "NetIncomeLoss",
        "ProfitLoss",
        "NetIncomeLossAvailableToCommonStockholdersBasic",
        "NetIncomeLossAvailableToCommonStockholdersDiluted",
        "NetIncomeLossAttributableToParent",
        "IncomeLossFromContinuingOperations",
    ],
    "gross_profit": [
        "GrossProfit",
        "GrossProfitLoss",
    ],
    "operating_income": [
        "OperatingIncomeLoss",
        "OperatingIncome",
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic",
    ],
    "ebit": [
        "OperatingIncomeLoss",
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    ],
    "eps": [
        "EarningsPerShareBasic",
        "EarningsPerShareDiluted",
    ],
    "assets": [
        "Assets",
        "AssetsCurrent",
    ],
    "liabilities": [
        "Liabilities",
        "LiabilitiesCurrent",
    ],
    "equity": [
        "StockholdersEquity",
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
        "RetainedEarningsAccumulatedDeficit",
    ],
    "cash": [
        "CashAndCashEquivalentsAtCarryingValue",
        "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
        "Cash",
        "CashAndCashEquivalentsPeriodIncreaseDecrease",
    ],
    "inventory": [
        "InventoryNet",
        "InventoriesNet",
        "Inventories",
    ],
    "receivables": [
        "AccountsReceivableNetCurrent",
        "AccountsReceivableNet",
        "ReceivablesNetCurrent",
        "Receivables",
        "AccountsAndOtherReceivablesNetCurrent",
    ],
    "operating_cash_flow": [
        "NetCashProvidedByUsedInOperatingActivities",
        "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
        "OperatingCashFlow",
    ],
    "investing_cash_flow": [
        "NetCashProvidedByUsedInInvestingActivities",
        "NetCashProvidedByUsedInInvestingActivitiesContinuingOperations",
    ],
    "financing_cash_flow": [
        "NetCashProvidedByUsedInFinancingActivities",
        "NetCashProvidedByUsedInFinancingActivitiesContinuingOperations",
    ],
    "capex": [
        "PaymentsToAcquirePropertyPlantAndEquipment",
        "CapitalExpenditureDiscontinuedOperations",
        "PaymentsForProceedsFromBusinessesAndInterestInAffiliates",
    ],
    "research_development": [
        "ResearchAndDevelopmentExpense",
        "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost",
    ],
    "debt": [
        "LongTermDebtNoncurrent",
        "LongTermDebt",
        "DebtCurrent",
        "LongTermDebtCurrent",
        "ShortTermBorrowings",
        "LongTermDebtAndCapitalLeaseObligations",
    ],
    "cost_of_revenue": [
        "CostOfRevenue",
        "CostOfGoodsAndServicesSold",
        "CostOfGoodsSold",
        "CostOfServices",
    ],
    "operating_expenses": [
        "OperatingExpenses",
        "OperatingCostsAndExpenses",
    ],
}

# Keywords used to validate extension concepts by label inspection
METRIC_LABEL_KEYWORDS: Dict[str, List[str]] = {
    "revenue": ["revenue", "sales", "net sales"],
    "net_income": ["net income", "net loss", "net profit"],
    "gross_profit": ["gross profit"],
    "operating_income": ["operating income", "operating loss", "operating profit"],
    "assets": ["total assets", "assets"],
    "liabilities": ["total liabilities", "liabilities"],
    "equity": ["stockholders equity", "shareholders equity", "equity"],
    "cash": ["cash", "cash equivalents"],
    "inventory": ["inventory", "inventories"],
    "receivables": ["accounts receivable", "receivables"],
    "operating_cash_flow": ["operating activities", "cash from operations"],
    "debt": ["long-term debt", "debt", "borrowings"],
    "eps": ["earnings per share", "eps"],
    "capex": ["capital expenditure", "capex", "property plant and equipment"],
    "research_development": ["research and development", "r&d"],
}

INSTANT_METRICS = {"assets", "liabilities", "equity", "cash", "inventory", "receivables", "debt"}

def normalize_metric(m: str) -> str:
    m = m.strip().lower().replace("_", "").replace(" ", "")
    if m in ["revenue", "sales", "revenues", "contractrevenue", "netsales", "operatingrevenue", "totalrevenue"]:
        return "revenue"
    if m in ["netincome", "netloss", "netprofit"]:
        return "net_income"
    if m in ["grossprofit", "grossincome"]:
        return "gross_profit"
    if m in ["operatingincome", "operatingloss", "operatingprofit", "ebit"]:
        return "operating_income"
    if m in ["assets", "totalassets"]:
        return "assets"
    if m in ["liabilities", "totalliabilities"]:
        return "liabilities"
    if m in ["equity", "shareholderequity", "stockholdersequity", "bookvalue"]:
        return "equity"
    if m in ["cash", "cashandequivalents", "cashandcashequivalents"]:
        return "cash"
    if m in ["inventory", "inventories", "netinventory"]:
        return "inventory"
    if m in ["receivables", "accountsreceivable", "receivablesnetcurrent", "accountsreceivables"]:
        return "receivables"
    if m in ["operatingcashflow", "cashfromoperations", "cashflowfromoperations", "netcashprovidedbyusedinoperatingactivities"]:
        return "operating_cash_flow"
    if m in ["debt", "totaldebt", "longtermdebt"]:
        return "debt"
    if m in ["grossmargin"]:
        return "gross_margin"
    if m in ["operatingmargin"]:
        return "operating_margin"
    if m in ["netmargin"]:
        return "net_margin"
    return m

def parse_period(period_str: str) -> Tuple[Optional[int], Optional[str]]:
    """
    Parse a period string like 'Q3 2023' or '2023' or 'FY23' into (year, period_type).
    Returns (None, None) if ambiguous or unparseable.
    """
    if not period_str:
        return None, None
    
    period_str = period_str.strip().upper()
    
    # Try matching Q1 2023, 2023-Q1, Q1'23, 1Q23, Q1 23 etc.
    q_match = re.search(r'Q([1-4])', period_str) or re.search(r'([1-4])Q', period_str)
    
    # Look for 4-digit year
    y_match = re.search(r'\b(20\d{2})\b', period_str)
    
    if y_match:
        year = int(y_match.group(1))
    else:
        # Look for 2-digit year (e.g. FY23, Q3'23, Q3 23)
        y_short = (
            re.search(r'\'?(\d{2})$', period_str) or 
            re.search(r'FY\s*(\d{2})', period_str) or 
            re.search(r'Q[1-4]\s*(\d{2})', period_str)
        )
        if y_short:
            year = 2000 + int(y_short.group(1))
        else:
            year = None
            
    if q_match:
        q_num = q_match.group(1)
        return year, f"Q{q_num}"
    
    # Check for annual period
    if "FY" in period_str or (year is not None and not any(q in period_str for q in ["Q1", "Q2", "Q3", "Q4"])):
        return year, "FY"
        
    return None, None

# Functions are now imported from fact_normalizer.py

def format_claimed_value(val: float, unit_str: Optional[str]) -> str:
    """
    Format the raw claimed value from the report.
    """
    if val is None:
        return "N/A"
    u = (unit_str or "").strip().lower()
    if u in ["percent", "%"]:
        return f"{val:.2f}%"
    
    # Determine dollar prefix
    prefix = "$"
    if u in ["billion", "billions", "b", "million", "millions", "m", "thousand", "thousands", "k"]:
        # If it has metric scale
        scale_map = {"billion": "billion", "billions": "billion", "b": "billion", 
                     "million": "million", "millions": "million", "m": "million",
                     "thousand": "thousand", "thousands": "thousand", "k": "thousand"}
        return f"{prefix}{val} {scale_map.get(u, u)}"
    return f"{val} {unit_str or ''}".strip()

def check_tolerance(val1: float, val2: float) -> bool:
    """
    Evaluate if two values match within 1.5% relative tolerance or small absolute tolerance.
    """
    if val2 == 0:
        return abs(val1) < 1e-5
    diff = abs(val1 - val2)
    # 1.5% relative tolerance
    if diff / abs(val2) <= 0.015:
        return True
    return False

class ClaimVerificationService:
    def __init__(self, fact_normalizer: Optional[FactNormalizerService] = None):
        self.fact_normalizer = fact_normalizer or FactNormalizerService()

    def _get_duration_days(self, start_str: Optional[str], end_str: str) -> Optional[int]:
        if not start_str or not end_str:
            return None
        try:
            start = datetime.strptime(start_str, "%Y-%m-%d")
            end = datetime.strptime(end_str, "%Y-%m-%d")
            return abs((end - start).days)
        except Exception:
            return None

    def _matches_period_end(self, date_str: str, target_end_str: str) -> bool:
        if date_str == target_end_str:
            return True
        try:
            d = datetime.strptime(date_str, "%Y-%m-%d")
            t = datetime.strptime(target_end_str, "%Y-%m-%d")
            return abs((d - t).days) <= 4
        except Exception:
            return False

    def _find_fact_for_period(
        self,
        facts: List[NormalizedFinancialFact],
        concepts: List[str],
        year: int,
        period: str,
        is_instant: bool
    ) -> Optional[NormalizedFinancialFact]:
        concepts_lower = [c.lower() for c in concepts]
        candidates = []
        
        for f in facts:
            if f.concept.lower() not in concepts_lower:
                continue
            
            # Match period criteria
            matches_year = (f.fiscal_year == year)
            matches_period = (f.fiscal_period == period)
            
            # If fiscal parameters are missing, inspect end_date year and month
            if not matches_year and f.end_date:
                try:
                    dt = datetime.strptime(f.end_date, "%Y-%m-%d")
                    matches_year = (dt.year == year)
                    if period == "FY":
                        matches_period = (dt.month in [11, 12, 1])  # Standard annual end months
                    elif period == "Q1":
                        matches_period = (dt.month in [3, 4, 5])
                    elif period == "Q2":
                        matches_period = (dt.month in [6, 7, 8])
                    elif period == "Q3":
                        matches_period = (dt.month in [9, 10, 11])
                    elif period == "Q4":
                        matches_period = (dt.month in [11, 12, 1, 2])
                except Exception:
                    pass
            
            if matches_year and matches_period:
                candidates.append(f)
                
        # Filter candidates by duration/instant context
        valid_candidates = []
        for c in candidates:
            if is_instant:
                if c.start_date is None:
                    valid_candidates.append(c)
            else:
                if c.start_date is not None:
                    days = self._get_duration_days(c.start_date, c.end_date)
                    if days is not None:
                        if period == "FY":
                            if 330 <= days <= 400:
                                valid_candidates.append(c)
                        else: # Q1, Q2, Q3, Q4
                            if 60 <= days <= 120:
                                valid_candidates.append(c)
                                
        if valid_candidates:
            # Sort: prefer 10-K for FY, 10-Q for Q, latest filed date
            def sorting_key(f: NormalizedFinancialFact):
                form_score = 0
                if period == "FY" and f.form and f.form.upper() == "10-K":
                    form_score = -2
                elif period != "FY" and f.form and f.form.upper() == "10-Q":
                    form_score = -2
                return (form_score, -(f.fiscal_year or 0), f.filed_date or "")
            
            valid_candidates.sort(key=sorting_key)
            return valid_candidates[0]
            
        return None

    def _get_metric_data(
        self,
        metric_key: str,
        year: int,
        period: str,
        facts: List[NormalizedFinancialFact]
    ) -> Optional[Dict[str, Any]]:
        """
        Lookup or derive the value, evidence, and calculations for a given metric key and period.
        """
        is_ratio = metric_key in ["gross_margin", "operating_margin", "net_margin"]
        
        if is_ratio:
            # Margin calculations
            num_key = {
                "gross_margin": "gross_profit",
                "operating_margin": "operating_income",
                "net_margin": "net_income"
            }[metric_key]
            
            num_data = self._get_metric_data(num_key, year, period, facts)
            den_data = self._get_metric_data("revenue", year, period, facts)
            
            if num_data and den_data and den_data["value"] != 0:
                result = num_data["value"] / den_data["value"]
                formula = f"{num_key} / revenue"
                calculation = ClaimCalculation(
                    formula=formula,
                    inputs={num_key: num_data["value"], "revenue": den_data["value"]},
                    result=result
                )
                evidence = num_data["evidence"] + den_data["evidence"]
                return {
                    "value": result,
                    "unit": "ratio",
                    "evidence": evidence,
                    "calculation": calculation
                }
            return None
            
        # Regular metric keys
        concepts = CONCEPT_MAPPINGS.get(metric_key)
        if not concepts:
            return None
            
        is_instant = metric_key in INSTANT_METRICS
        fact = self._find_fact_for_period(facts, concepts, year, period, is_instant)
        
        if fact:
            return {
                "value": fact.value,
                "unit": fact.unit,
                "evidence": [fact],
                "calculation": None
            }
            
        return None

    def verify_claim(
        self,
        claim: ExtractedClaim,
        facts_res: Optional[CompanyFactsResponse],
        resolved_fact: Optional[NormalizedFinancialFact] = None,
        resolved_prior_fact: Optional[NormalizedFinancialFact] = None,
    ) -> ClaimAuditResult:
        """
        Verify a single claim against the retrieved company facts.
        """
        result = self._verify_claim_inner(
            claim, facts_res, resolved_fact=resolved_fact, resolved_prior_fact=resolved_prior_fact
        )
        
        if facts_res and facts_res.facts:
            year, period = parse_period(claim.end_period)
            if year is not None:
                years_present = [f.fiscal_year for f in facts_res.facts if f.fiscal_year is not None]
                if years_present:
                    max_year = max(years_present)
                    if year < max_year - 1:
                        result.is_outdated = True
                        msg = f"Newer filings available: Filing data is available up to fiscal year {max_year}. Claim is from outdated year {year}."
                        if msg not in result.limitations:
                            result.limitations.append(msg)
                        company = claim.company_name or "the company"
                        result.short_explanation = f"This claim accurately describes {company}’s {claim.end_period} filing (verdict: {result.verdict.capitalize()}). However, newer filings are now available (up to fiscal year {max_year}), so Provera also flags this period as Historical to indicate more recent financial data exists."
        return result

    def _verify_claim_inner(
        self,
        claim: ExtractedClaim,
        facts_res: Optional[CompanyFactsResponse],
        resolved_fact: Optional[NormalizedFinancialFact] = None,
        resolved_prior_fact: Optional[NormalizedFinancialFact] = None,
    ) -> ClaimAuditResult:
        # 1. Opinion Check
        if claim.claim_type == "opinion":
            return ClaimAuditResult(
                claim=claim,
                verdict="opinion",
                confidence="high",
                short_explanation="Provera does not audit qualitative opinions, competitive strategies, or management quality.",
                evidence=[],
                calculations=[],
                limitations=["Qualitative statements cannot be audited against structured SEC XBRL disclosures."]
            )

        # 2. Forward-Looking Check
        if claim.claim_type == "forward_looking":
            return ClaimAuditResult(
                claim=claim,
                verdict="forward_looking",
                confidence="high",
                short_explanation="Provera does not audit forward-looking guidance, forecasts, or projections.",
                evidence=[],
                calculations=[],
                limitations=["Forward-looking statements are projection-based and not reported as historical facts in SEC filings."]
            )

        # 3. Missing facts/company check
        if not facts_res or not facts_res.facts:
            return ClaimAuditResult(
                claim=claim,
                verdict="insufficient_evidence",
                confidence="low",
                short_explanation="Provera could not confidently identify the company in SEC EDGAR records.",
                evidence=[],
                calculations=[],
                limitations=["No structured SEC filing data is available for this company."],
                evidence_resolution_status="no_confident_match",
                resolution_stage_details=[
                    "✕ Company could not be matched to an SEC registrant",
                    "— Period matching not attempted",
                    "— Metric lookup not attempted",
                    "— Calculation not performed",
                ]
            )

        facts = facts_res.facts

        # 4. Period Parsing Check
        year, period = parse_period(claim.end_period)
        if year is None or period is None:
            return ClaimAuditResult(
                claim=claim,
                verdict="requires_human_review",
                confidence="medium",
                short_explanation="The company was identified, but the reporting period could not be resolved.",
                evidence=[],
                calculations=[],
                limitations=["Ambiguous period tags require manual mapping to SEC filing dates."]
            )

        # 5. Outdated Check (Separated out to the wrapper so that factual checks run anyway)

        metric_normalized = normalize_metric(claim.metric)
        
        # Helper to convert NormalizedFinancialFact to ClaimEvidence
        def to_claim_evidence(f: NormalizedFinancialFact, explanation: str) -> ClaimEvidence:
            raw_val = getattr(f, "raw_value", None) or f.value
            norm_val = getattr(f, "normalized_value", None) or normalize_value(f.value, f.unit)
            fmt_val = getattr(f, "formatted_value", None) or format_value_with_unit(f.value, f.unit)
            return ClaimEvidence(
                concept=f.concept,
                value=f.value,
                unit=f.unit,
                end_date=f.end_date,
                start_date=f.start_date,
                form=f.form,
                filed_date=f.filed_date,
                accession_number=f.accession_number,
                source_url=f.source_url,
                explanation=explanation,
                raw_value=raw_val,
                normalized_value=norm_val,
                formatted_value=fmt_val
            )

        # 6. Trend / Comparative Claim Check (YoY, QoQ)
        if claim.comparison_type in ["YoY", "QoQ"]:
            # Find comparative prior period
            if claim.comparison_type == "YoY":
                prior_year = year - 1
                prior_period = period
            else: # QoQ
                if period == "Q4":
                    prior_year = year
                    prior_period = "Q3"
                elif period == "Q3":
                    prior_year = year
                    prior_period = "Q2"
                elif period == "Q2":
                    prior_year = year
                    prior_period = "Q1"
                elif period == "Q1":
                    prior_year = year - 1
                    prior_period = "Q4"
                else: # FY
                    return ClaimAuditResult(
                        claim=claim,
                        verdict="requires_human_review",
                        confidence="medium",
                        short_explanation="Quarter-over-Quarter comparison is not meaningful for an annual period (FY).",
                        evidence=[],
                        calculations=[],
                        limitations=["QoQ comparisons require quarterly input periods."]
                    )

            if resolved_fact:
                target_data = {
                    "value": resolved_fact.value,
                    "unit": resolved_fact.unit,
                    "evidence": [resolved_fact],
                    "calculation": None
                }
            else:
                target_data = self._get_metric_data(metric_normalized, year, period, facts)

            if resolved_prior_fact:
                prior_data = {
                    "value": resolved_prior_fact.value,
                    "unit": resolved_prior_fact.unit,
                    "evidence": [resolved_prior_fact],
                    "calculation": None
                }
            else:
                prior_data = self._get_metric_data(metric_normalized, prior_year, prior_period, facts)

            if not target_data or not prior_data:
                missing = []
                if not target_data:
                    missing.append(f"{metric_normalized} for {period} {year}")
                if not prior_data:
                    missing.append(f"{metric_normalized} for {prior_period} {prior_year}")
                return ClaimAuditResult(
                    claim=claim,
                    verdict="insufficient_evidence",
                    confidence="medium",
                    short_explanation="The current and comparison-period values needed for this calculation were not both available.",
                    evidence=[],
                    calculations=[],
                    limitations=[f"Comparative period data for {metric_normalized} could not be located ({', '.join(missing)})."],
                    evidence_resolution_status="no_confident_match",
                    resolution_stage_details=[
                        "✓ Company identified",
                        "✓ Fiscal period matched",
                        f"✕ Metric '{metric_normalized}' could not be matched for both comparison periods",
                        "— Calculation not performed",
                    ]
                )

            t_val = target_data["value"]
            p_val = prior_data["value"]

            if p_val == 0:
                return ClaimAuditResult(
                    claim=claim,
                    verdict="requires_human_review",
                    confidence="low",
                    short_explanation="Comparative base value is zero. Percentage growth calculation is not meaningful.",
                    evidence=[],
                    calculations=[],
                    limitations=["Denominator of growth equation is zero."]
                )

            change_pct = (t_val - p_val) / p_val * 100
            
            calc_formula = f"({metric_normalized}_{year}_{period} - {metric_normalized}_{prior_year}_{prior_period}) / {metric_normalized}_{prior_year}_{prior_period}"
            calculation = ClaimCalculation(
                formula=calc_formula,
                inputs={
                    f"{metric_normalized}_{year}_{period}": t_val,
                    f"{metric_normalized}_{prior_year}_{prior_period}": p_val
                },
                result=change_pct
            )

            # Determine claimed value matches
            claimed_val_norm = claim.claimed_value
            # Normal check: did direction match?
            direction_matches = False
            if claim.direction == "increase" and change_pct > 0:
                direction_matches = True
            elif claim.direction == "decrease" and change_pct < 0:
                direction_matches = True
            elif not claim.direction:
                # If no direction is specified but a percentage grew/shrunk, verify by sign
                if claimed_val_norm is not None:
                    if claimed_val_norm > 0 and change_pct > 0:
                        direction_matches = True
                    elif claimed_val_norm < 0 and change_pct < 0:
                        direction_matches = True
                    else:
                        direction_matches = (abs(change_pct - claimed_val_norm) < 1.5)

            # Check if percentage matches if claimed
            value_matches = True
            if claimed_val_norm is not None:
                # Support comparing 10% change to 10 or 0.1
                val_to_compare = claimed_val_norm
                if abs(claimed_val_norm) < 1.0 and abs(change_pct) >= 1.0:
                    val_to_compare = claimed_val_norm * 100
                value_matches = check_tolerance(abs(change_pct), abs(val_to_compare))

            evidence_items = []
            for f in target_data["evidence"]:
                evidence_items.append(to_claim_evidence(f, f"Current period value for calculation ({t_val})"))
            for f in prior_data["evidence"]:
                evidence_items.append(to_claim_evidence(f, f"Comparative prior period value ({p_val})"))

            source_urls = list({f.source_url for f in evidence_items if f.source_url})

            concept_label = claim.metric or metric_normalized
            company = claim.company_name or "the company"
            form = "10-K"
            if target_data and target_data.get("evidence"):
                form = target_data["evidence"][0].form or "10-K"

            if direction_matches and value_matches:
                verdict = "supported"
                explanation = f"Provera matched this comparative claim to {company}’s {claim.end_period} {concept_label} YoY change in the official SEC {form} filing. The calculated change of {change_pct:.2f}% matches the claimed direction and value of {claim.claimed_value or ''}% within the accepted tolerance, so this claim is classified as Supported."
            elif direction_matches and not value_matches:
                verdict = "partially_supported"
                explanation = f"Provera matched this comparative claim to {company}’s {claim.end_period} {concept_label} YoY change. While the metric moved in the claimed direction ({claim.direction}), the actual change was {change_pct:.2f}%, which materially differs from the claimed {claim.claimed_value or ''}%. This claim is therefore classified as Partially Supported."
            else:
                verdict = "contradicted"
                explanation = f"Provera matched this comparative claim to {company}’s {claim.end_period} {concept_label} YoY change. The official filing results in a change of {change_pct:.2f}%, which contradicts the claimed change of {claim.claimed_value or ''}%. Therefore, this claim is classified as Contradicted."

            return ClaimAuditResult(
                claim=claim,
                verdict=verdict,
                confidence="high",
                short_explanation=explanation,
                evidence=evidence_items,
                calculations=[calculation],
                source_urls=source_urls
            )

        # 7. Direct Metric Claim Check
        if resolved_fact:
            metric_data = {
                "value": resolved_fact.value,
                "unit": resolved_fact.unit,
                "evidence": [resolved_fact],
                "calculation": None
            }
        else:
            metric_data = self._get_metric_data(metric_normalized, year, period, facts)

        # Check if matched fact is an extension concept
        is_extension_concept = False
        if resolved_fact and resolved_fact.namespace.lower() not in ("us-gaap", "dei", "srt"):
            is_extension_concept = True
        elif metric_data and metric_data.get("evidence"):
            primary_ev = metric_data["evidence"][0]
            if primary_ev.namespace.lower() not in ("us-gaap", "dei", "srt"):
                is_extension_concept = True

        if is_extension_concept:
            evidence_items = []
            source_fact = resolved_fact or (metric_data["evidence"][0] if metric_data else None)
            if source_fact:
                evidence_items.append(to_claim_evidence(source_fact, f"Company-specific extension concept '{source_fact.concept}'"))
            source_urls = list({f.source_url for f in evidence_items if f.source_url})
            return ClaimAuditResult(
                claim=claim,
                verdict="requires_human_review",
                confidence="medium",
                short_explanation="The filing contains a company-specific concept that requires human review.",
                evidence=evidence_items,
                calculations=[],
                source_urls=source_urls,
                evidence_resolution_status="extension_concept_match",
                resolution_stage_details=[
                    "✓ Company identified",
                    "✓ Fiscal period matched",
                    "✓ Company-specific XBRL concept validated",
                    "— Calculation not performed",
                ]
            )
        if not metric_data:
            return ClaimAuditResult(
                claim=claim,
                verdict="insufficient_evidence",
                confidence="medium",
                short_explanation="Provera searched SEC company facts and the relevant filing but could not confidently match this metric.",
                evidence=[],
                calculations=[],
                limitations=[f"The metric '{metric_normalized}' could not be matched to a disclosed XBRL concept for this period."],
                evidence_resolution_status="no_confident_match",
                resolution_stage_details=[
                    "✓ Company identified",
                    "✓ Fiscal period matched",
                    f"✕ Metric '{metric_normalized}' could not be mapped confidently to a disclosed concept",
                    "— Calculation not performed",
                ]
            )

        reported_val = metric_data["value"]
        claimed_val_norm = normalize_value(claim.claimed_value, claim.unit)

        evidence_items = []
        for f in metric_data["evidence"]:
            evidence_items.append(to_claim_evidence(f, f"Reported value for {metric_normalized} ({reported_val})"))

        source_urls = list({f.source_url for f in evidence_items if f.source_url})
        calculations_list = []
        if metric_data["calculation"]:
            calculations_list.append(metric_data["calculation"])

        concept_label = claim.metric or metric_normalized
        company = claim.company_name or "the company"
        form = "10-K"
        if evidence_items:
            form = evidence_items[0].form or "10-K"

        if claimed_val_norm is None:
            # Claimed direction only or just states a value exists
            formatted_sec = format_value_with_unit(reported_val, primaryEvidence.unit if primaryEvidence else None)
            explanation = f"Provera matched this claim to {company}’s {claim.end_period} {concept_label} disclosure in the official SEC {form} filing. The reported value of {formatted_sec} is confirmed present in the filing, so this claim is classified as Supported."
            return ClaimAuditResult(
                claim=claim,
                verdict="supported",
                confidence="high",
                short_explanation=explanation,
                evidence=evidence_items,
                calculations=calculations_list,
                source_urls=source_urls
            )

        # Compare values
        # Handle decimal margins vs percentage representation
        calc_to_compare = reported_val
        if metric_data["unit"] == "ratio" or metric_normalized in ["gross_margin", "operating_margin", "net_margin"]:
            if abs(claimed_val_norm) > 1.0 and abs(reported_val) <= 1.0:
                calc_to_compare = reported_val * 100

        value_matches = check_tolerance(claimed_val_norm, calc_to_compare)
        primary_evidence = evidence_items[0] if evidence_items else None

        if value_matches:
            verdict = "supported"
            formatted_sec = format_value_with_unit(reported_val, primary_evidence.unit if primary_evidence else None)
            formatted_claimed = format_claimed_value(claim.claimed_value, claim.unit)
            explanation = f"Provera matched this claim to {company}’s {claim.end_period} {concept_label} disclosure in the official SEC {form} filing. The reported value of {formatted_sec} matches the claim of {formatted_claimed} within the accepted tolerance, so this claim is classified as Supported."
        else:
            verdict = "contradicted"
            formatted_sec = format_value_with_unit(calc_to_compare, primary_evidence.unit if primary_evidence else None)
            formatted_claimed = format_claimed_value(claim.claimed_value, claim.unit)
            explanation = f"The official SEC {form} filing reports {concept_label} of {formatted_sec}, while the submitted report claims {formatted_claimed}. This exceeds the allowed tolerance and is therefore classified as Contradicted."

        return ClaimAuditResult(
            claim=claim,
            verdict=verdict,
            confidence="high",
            short_explanation=explanation,
            evidence=evidence_items,
            calculations=calculations_list,
            source_urls=source_urls
        )
