import os
import re
import logging
from typing import List, Optional, Tuple, Dict
from datetime import datetime
from pydantic import BaseModel
from google import genai
from google.genai import types
from dotenv import load_dotenv
from pathlib import Path

from app.models.financial_fact import NormalizedFinancialFact
from app.models.chat import ChatCitation, ChatComparison, ChatResponse
from app.services.fact_normalizer import FactNormalizerService
from app.services.explanation_service import ExplanationService

logger = logging.getLogger(__name__)

# Load api/.env to ensure GEMINI_API_KEY is in environment
base_dir = Path(__file__).resolve().parent.parent.parent
dotenv_path = base_dir / ".env"
load_dotenv(dotenv_path=dotenv_path)

# ---------------------------------------------------------------------------
# XBRL Synonym Table
# Maps a human-readable canonical metric name to ALL known equivalent US-GAAP
# concept names. Used to boost scoring and detect metric availability.
# Concept names are stored lowercase for case-insensitive matching.
# ---------------------------------------------------------------------------
XBRL_SYNONYMS: Dict[str, List[str]] = {
    "revenue": [
        "revenues",
        "salesrevenuenet",
        "revenuefromcontractwithcustomerexcludingassessedtax",
        "revenuefromcontractwithcustomerincludingassessedtax",
        "operatingrevenue",
        "totalrevenue",
        "netsales",
        "revenuesnetofinterestexpense",
        "revenuenotfromcontractwithcustomer",
        "salesrevenueservicesnet",
        "salesrevenuegoodsnet",
        "revenuefrommedicaid",
        "revenuemineral sales",
        "revenuemineralsales",
        "healthcareorganizationrevenue",
    ],
    "cost_of_revenue": [
        "costofrevenue",
        "costsandexpenses",
        "costofgoodsandservicessold",
        "costofgoodssold",
        "costofservices",
        "costofgoodssolddepreciation",
        "costofrevenuesdepreciation",
    ],
    "gross_profit": [
        "grossprofit",
    ],
    "operating_income": [
        "operatingincomeloss",
        "operatingincome",
        "incomefromoperations",
        "incomelossbeforeequitymethodinvestments",
    ],
    "net_income": [
        "netincomeloss",
        "netincome",
        "profitloss",
        "netincomelossavailabletocommonstockholdersbasic",
        "netincomelossavailabletocommonstockholdersdiluted",
        "comprehensiveincomelossnetoftax",
    ],
    "ebitda": [
        "ebitda",
        "earningsbeforeinteresttaxesdepreciationandamortization",
    ],
    "research_development": [
        "researchanddevelopmentexpense",
        "researchanddevelopmentexpenseexcludingacquiredintechnology",
        "researchanddevelopment",
    ],
    "selling_general_admin": [
        "sellinggeneralandadministrativeexpense",
        "generalandadministrativeexpense",
        "sellinganddistributionexpense",
        "marketingexpense",
    ],
    "assets": [
        "assets",
        "totalassets",
    ],
    "current_assets": [
        "assetscurrent",
        "currentassets",
    ],
    "liabilities": [
        "liabilities",
        "totalliabilities",
        "liabilitiesandstockholdersequity",
    ],
    "current_liabilities": [
        "liabilitiescurrent",
        "currentliabilities",
    ],
    "equity": [
        "stockholdersequity",
        "stockholdersequityincludingportionattributabletononcontrollinginterest",
        "totalstockholdersequity",
        "totalequity",
        "membersequity",
    ],
    "long_term_debt": [
        "longtermdebt",
        "longtermdebtnoncurrent",
        "debentures",
        "notespayable",
        "seniornotespayable",
    ],
    "cash": [
        "cashandcashequivalentsatcarryingvalue",
        "cash",
        "cashcashequivalentsrestrictedcashandrestrictedcashequivalents",
        "cashandcashequivalents",
        "restrictedcashandcashequivalents",
    ],
    "operating_cash_flow": [
        "netcashprovidedbyusedinoperatingactivities",
        "operatingcashflow",
        "cashfromoperations",
    ],
    "investing_cash_flow": [
        "netcashprovidedbyusedininvestingactivities",
        "investingcashflow",
    ],
    "financing_cash_flow": [
        "netcashprovidedbyusedinfinancingactivities",
        "financingcashflow",
    ],
    "inventory": [
        "inventorynet",
        "inventoriesnet",
        "inventories",
        "inventory",
    ],
    "accounts_receivable": [
        "accountsreceivablenetcurrent",
        "accountsreceivablenet",
        "receivablesnetcurrent",
        "receivables",
        "tradereceivables",
    ],
    "accounts_payable": [
        "accountspayablecurrent",
        "accountspayable",
        "tradepayables",
    ],
    "depreciation_amortization": [
        "depreciationdepletionandamortization",
        "depreciationandamortization",
        "amortizationofintangibleassets",
    ],
    "goodwill": [
        "goodwill",
        "goodwillnet",
    ],
    "intangible_assets": [
        "intangibleassetsnetexcludinggoodwill",
        "intangibleassets",
        "finitelivedintangibleassetsnet",
    ],
    "interest_expense": [
        "interestexpense",
        "interestexpensenet",
        "interestexpensedebt",
    ],
    "income_tax_expense": [
        "incometaxexpensebenefit",
        "incometaxexpense",
        "currentincometaxexpensebenefit",
    ],
    "eps": [
        "earningspersharebasic",
        "earningspersharediluted",
        "earningspershare",
        "netincomelossperoutstandingunitbasic",
    ],
    "shares_outstanding": [
        "commonstocksharesoutstanding",
        "sharesoutstanding",
        "weightedaveragenumberofdilutedsharesoutstanding",
        "weightedaveragenumberofsharesoutstandingbasic",
    ],
}

# Reverse index: concept_name_lowercase -> canonical_family
_CONCEPT_TO_FAMILY: Dict[str, str] = {}
for _family, _concepts in XBRL_SYNONYMS.items():
    for _c in _concepts:
        _CONCEPT_TO_FAMILY[_c.lower()] = _family

class ChatService:
    def __init__(self, fact_normalizer: Optional[FactNormalizerService] = None, explanation_service: Optional[ExplanationService] = None):
        """
        Initialize the ChatService.
        """
        self.fact_normalizer = fact_normalizer or FactNormalizerService()
        self.explanation_service = explanation_service or ExplanationService()
        self.api_key = self.explanation_service.api_key
        self.client = self.explanation_service.client

    def is_available(self) -> bool:
        """
        Check if the Gemini client is available.
        """
        return self.client is not None

    def _get_duration_days(self, start_str: Optional[str], end_str: str) -> Optional[int]:
        if not start_str or not end_str:
            return None
        try:
            start = datetime.strptime(start_str, "%Y-%m-%d")
            end = datetime.strptime(end_str, "%Y-%m-%d")
            return abs((end - start).days)
        except Exception:
            return None

    def detect_available_metrics(self, facts: List[NormalizedFinancialFact]) -> Dict[str, str]:
        """
        Scan all company facts and return a dict of:
            canonical_family -> representative concept name that was actually found

        This is used to:
        1. Tell Gemini which metrics ARE available so follow-up questions are grounded.
        2. Provide accurate "closest available" suggestions when a metric is missing.
        """
        found: Dict[str, str] = {}  # family -> first matching concept seen
        for f in facts:
            c_lower = f.concept.lower().replace("-", "").replace("_", "").replace(" ", "")
            family = _CONCEPT_TO_FAMILY.get(c_lower)
            if family and family not in found:
                found[family] = f.concept  # store original casing for display
        return found

    def _synonyms_for_query(self, query_lower: str) -> set:
        """
        Return the set of all lowercase concept names that are synonyms for
        any metric family mentioned in the query.
        For example, if the query mentions 'revenue', return all revenue
        synonym concept names so they score highly even with unusual XBRL names.
        """
        # Map query keywords -> canonical family names
        QUERY_FAMILY_TRIGGERS: Dict[str, List[str]] = {
            "revenue": ["revenue"],
            "sales": ["revenue"],
            "turnover": ["revenue"],
            "net sales": ["revenue"],
            "top line": ["revenue"],
            "cost of revenue": ["cost_of_revenue"],
            "cost of goods": ["cost_of_revenue"],
            "cogs": ["cost_of_revenue"],
            "gross profit": ["gross_profit", "cost_of_revenue", "revenue"],
            "gross margin": ["gross_profit", "cost_of_revenue", "revenue"],
            "operating income": ["operating_income"],
            "operating margin": ["operating_income", "revenue"],
            "operating profit": ["operating_income"],
            "ebit": ["operating_income"],
            "net income": ["net_income"],
            "net profit": ["net_income"],
            "net margin": ["net_income", "revenue"],
            "earnings": ["net_income", "eps"],
            "profit": ["net_income", "gross_profit", "operating_income"],
            "ebitda": ["ebitda", "operating_income", "depreciation_amortization"],
            "r&d": ["research_development"],
            "research": ["research_development"],
            "sg&a": ["selling_general_admin"],
            "general and administrative": ["selling_general_admin"],
            "administrative": ["selling_general_admin"],
            "cash": ["cash", "operating_cash_flow"],
            "liquidity": ["cash", "current_assets", "current_liabilities"],
            "current ratio": ["current_assets", "current_liabilities"],
            "working capital": ["current_assets", "current_liabilities"],
            "operating cash flow": ["operating_cash_flow"],
            "cash from operations": ["operating_cash_flow"],
            "investing": ["investing_cash_flow"],
            "financing": ["financing_cash_flow"],
            "asset": ["assets", "current_assets"],
            "liabilit": ["liabilities", "current_liabilities"],
            "debt": ["long_term_debt", "liabilities"],
            "leverage": ["long_term_debt", "equity", "liabilities"],
            "equity": ["equity"],
            "shareholder": ["equity"],
            "inventory": ["inventory"],
            "receivable": ["accounts_receivable"],
            "payable": ["accounts_payable"],
            "depreciation": ["depreciation_amortization"],
            "amortization": ["depreciation_amortization"],
            "goodwill": ["goodwill"],
            "intangible": ["intangible_assets"],
            "interest expense": ["interest_expense"],
            "tax": ["income_tax_expense"],
            "eps": ["eps"],
            "earnings per share": ["eps"],
            "shares outstanding": ["shares_outstanding"],
            "diluted": ["eps", "shares_outstanding"],
        }
        families_to_boost: set = set()
        for trigger, families in QUERY_FAMILY_TRIGGERS.items():
            if trigger in query_lower:
                families_to_boost.update(families)
        # Collect all synonym concept names (lowercase, no separators) for those families
        boost_concepts: set = set()
        for family in families_to_boost:
            for c in XBRL_SYNONYMS.get(family, []):
                boost_concepts.add(c.lower().replace("-", "").replace("_", "").replace(" ", ""))
        return boost_concepts

    def filter_relevant_facts(self, facts: List[NormalizedFinancialFact], query: str) -> List[NormalizedFinancialFact]:
        """
        Scoring algorithm to filter, deduplicate, and retrieve the most relevant facts.
        Uses the XBRL_SYNONYMS table to boost equivalent concept names so that
        e.g. RevenueFromContractWithCustomerExcludingAssessedTax scores just as
        highly as the word 'revenue' when the query asks about revenue.
        """
        query_lower = query.lower()

        # Build the set of all synonym concepts relevant to this query (normalized)
        synonym_boost_set = self._synonyms_for_query(query_lower)

        # 1. Sort all facts by accession number / filed date descending so we process the latest filings first
        facts_sorted = sorted(
            facts,
            key=lambda x: (x.filed_date or "", x.accession_number or "", x.end_date),
            reverse=True
        )

        # 2. Deduplicate: keep ONLY the latest value for any given (concept, unit, end_date, start_date)
        # This prevents contradictory evidence from different filings or revision retrieval paths
        deduped = []
        seen_keys = set()
        for f in facts_sorted:
            key = (f.concept.upper(), f.unit.upper(), f.end_date, f.start_date)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            deduped.append(f)

        # 3. Extract years
        years = [int(y) for y in re.findall(r'\b(20\d{2})\b', query_lower)]

        # 4. Extract query words for exact match checks
        query_words = set(re.findall(r'\b[a-zA-Z]{3,}\b', query_lower))

        # 5. Key financial terms mapping (kept for backward-compatible keyword scoring)
        keywords = []
        if any(x in query_lower for x in ["cash", "liqui", "restricted cash"]):
            keywords.extend(["cash", "liqui"])
        if any(x in query_lower for x in ["revenue", "sales", "turnover", "contract"]):
            keywords.extend(["revenue", "sales", "turnover", "contract"])
        if any(x in query_lower for x in ["income", "profit", "earnings", "net income", "loss"]):
            keywords.extend(["income", "profit", "loss", "earnings", "netincome"])
        if any(x in query_lower for x in ["expense", "cost", "spending", "r&d", "rnd", "sg&a", "sga", "depreciation", "amortization"]):
            keywords.extend(["expense", "cost", "spending", "research", "development", "administrative", "depreciation", "amortization"])
        if any(x in query_lower for x in ["asset", "property", "goodwill", "inventory", "receivable"]):
            keywords.extend(["asset", "property", "goodwill", "inventory", "receivable"])
        if any(x in query_lower for x in ["liabilit", "debt", "obligation", "payable", "borrow"]):
            keywords.extend(["liabilit", "debt", "obligation", "payable", "borrow"])
        if any(x in query_lower for x in ["equity", "shareholder", "stock", "capital", "retained"]):
            keywords.extend(["equity", "shareholder", "stock", "capital", "retained"])

        if not keywords:
            stopwords = {"what", "how", "much", "many", "were", "where", "when", "does", "have", "with", "from", "that", "this", "then", "there", "about", "company", "total"}
            keywords = [w for w in query_words if w not in stopwords]

        # 6. Score candidate facts
        scored_candidates = []
        for f in deduped:
            score = 0
            # Normalize concept for synonym matching (remove separators, lowercase)
            concept_normalized = f.concept.lower().replace("-", "").replace("_", "").replace(" ", "")
            concept_lower = f.concept.lower()
            label_lower = (f.label or "").lower()
            desc_lower = (f.description or "").lower()

            # SYNONYM BOOST: highest priority — recognises all equivalent XBRL concept names
            # (e.g. RevenueFromContractWithCustomerExcludingAssessedTax for 'revenue')
            if concept_normalized in synonym_boost_set:
                score += 600

            # A. Exact concept match against query words
            if concept_lower in query_words:
                score += 100

            # B. Match keywords (fragment matching on concept / label / description)
            for kw in keywords:
                if kw in concept_lower:
                    score += 20
                if kw in label_lower:
                    score += 15
                if kw in desc_lower:
                    score += 5

            # C. Match years
            for yr in years:
                if f.fiscal_year == yr:
                    score += 30
                if str(yr) in f.end_date:
                    score += 20
                if f.start_date and str(yr) in f.start_date:
                    score += 10

            if score > 0:
                # D. Newest compatible filing periods ranking
                try:
                    year_val = int(f.end_date[:4])
                    score += (year_val - 2010) * 2
                except ValueError:
                    pass

                # E. Prefer standard US-GAAP namespace
                if f.namespace.lower() == "us-gaap":
                    score += 5
                elif f.namespace.lower() == "dei":
                    score += 2

                scored_candidates.append((score, f))

        # Sort candidates by score descending (relevance ranking), then by end_date descending
        scored_candidates.sort(key=lambda x: (x[0], x[1].end_date), reverse=True)
        candidate_facts = [item[1] for item in scored_candidates]

        # Slice to default maximum (12 facts)
        selected_facts = candidate_facts[:12]

        # If a trend/comparison is requested, ensure we pull prior period facts up to hard maximum (20 facts)
        has_trend_keywords = any(w in query_lower for w in ["changed", "increased", "decreased", "trend", "recently", "latest", "compare"])
        if has_trend_keywords:
            for f in list(selected_facts):
                if len(selected_facts) >= 20:
                    break
                is_duration = f.start_date is not None
                f_days = self._get_duration_days(f.start_date, f.end_date)

                # Find compatible older facts
                prior_candidates = []
                for x in candidate_facts[12:]:
                    if x in selected_facts:
                        continue
                    if x.concept.upper() != f.concept.upper():
                        continue
                    if x.unit.upper() != f.unit.upper():
                        continue
                    if (x.start_date is not None) != is_duration:
                        continue
                    if x.end_date >= f.end_date:
                        continue

                    # If duration, check if period lengths are compatible (within 30 days) to avoid mixing quarterly and annual
                    if is_duration:
                        x_days = self._get_duration_days(x.start_date, x.end_date)
                        if f_days is not None and x_days is not None:
                            if abs(f_days - x_days) > 30:
                                continue
                    prior_candidates.append(x)

                prior_candidates.sort(key=lambda x: x.end_date, reverse=True)
                for pf in prior_candidates:
                    if pf not in selected_facts:
                        selected_facts.append(pf)
                        if len(selected_facts) >= 20:
                            break

        return selected_facts

    def calculate_comparisons(self, facts: List[NormalizedFinancialFact]) -> List[ChatComparison]:
        """
        Calculate absolute and percentage changes between compatible periods deterministically.
        """
        comparisons = []
        # Group facts by (concept, unit, start_date is not None)
        groups = {}
        for f in facts:
            is_duration = f.start_date is not None
            key = (f.concept.upper(), f.unit.upper(), is_duration)
            groups.setdefault(key, []).append(f)

        for key, group_facts in groups.items():
            if len(group_facts) < 2:
                continue

            # Sort by end_date descending
            group_facts.sort(key=lambda x: x.end_date, reverse=True)
            current = group_facts[0]

            # Look for a compatible prior fact (different end date, compatible duration days)
            prior = None
            is_duration = key[2]
            current_days = self._get_duration_days(current.start_date, current.end_date)

            for candidate in group_facts[1:]:
                if candidate.end_date >= current.end_date:
                    continue
                if is_duration:
                    candidate_days = self._get_duration_days(candidate.start_date, candidate.end_date)
                    if current_days is not None and candidate_days is not None:
                        if abs(current_days - candidate_days) > 30:
                            # Avoid mixing quarterly and annual without matching
                            continue
                prior = candidate
                break

            if current and prior:
                abs_change = current.value - prior.value
                pct_change = (abs_change / prior.value) if prior.value != 0 else None
                
                # Check for incompatible units safety: double check matching units (already in group key)
                comparisons.append(ChatComparison(
                    concept=current.concept,
                    label=current.label,
                    current_value=current.value,
                    prior_value=prior.value,
                    unit=current.unit,
                    current_period_end=current.end_date,
                    prior_period_end=prior.end_date,
                    absolute_change=abs_change,
                    percentage_change=pct_change
                ))

        return comparisons

    async def ask_question(self, cik: int, question: str) -> ChatResponse:
        """
        Grounded Ask FilingLens assistant.
        """
        # Fetch and normalize all company facts (limit to 2000 to keep it fast)
        facts_res = await self.fact_normalizer.get_company_facts(cik, limit=2000)
        company_name = facts_res.company_name
        all_facts = facts_res.facts

        # Detect which canonical metric families are actually present in the filing data.
        # This is used both to answer 'is X available?' accurately AND to constrain
        # the follow-up question suggestions to only what is retrievable.
        available_metrics = self.detect_available_metrics(all_facts)

        # Filter the facts using synonym-aware scoring
        relevant_facts = self.filter_relevant_facts(all_facts, question)
        evidence_count = len(relevant_facts)

        # Build Citations
        citations = []
        for idx, f in enumerate(relevant_facts):
            citations.append(ChatCitation(
                id=idx + 1,
                concept=f.concept,
                label=f.label,
                value=f.value,
                unit=f.unit,
                period_end=f.end_date,
                form=f.form,
                accession_number=f.accession_number,
                source_url=f.source_url
            ))

        # Calculate comparisons deterministically
        comparisons = self.calculate_comparisons(relevant_facts)

        # Format retrieved citations for prompt context
        citations_text = ""
        for c in citations:
            period_lbl = f"(Form: {c.form or 'N/A'}, Period end: {c.period_end})"
            url_str = f" [Link]({c.source_url})" if c.source_url else ""
            citations_text += (
                f"[{c.id}] Concept: {c.concept} | Label: {c.label or 'N/A'} | "
                f"Value: {c.value} {c.unit} | Period: {period_lbl}{url_str}\n"
            )

        # Format comparisons for prompt context
        comparisons_text = ""
        for idx, comp in enumerate(comparisons):
            pct_lbl = f"{comp.percentage_change * 100:.2f}%" if comp.percentage_change is not None else "N/A"
            comparisons_text += (
                f"- Comparison {idx+1}: Concept: {comp.concept} ({comp.label or 'N/A'}) | "
                f"Current ({comp.current_period_end}) = {comp.current_value} {comp.unit} | "
                f"Prior ({comp.prior_period_end}) = {comp.prior_value} {comp.unit} | "
                f"Absolute Change = {comp.absolute_change} {comp.unit} | "
                f"Percentage Change = {pct_lbl}\n"
            )

        # Summarise available metrics for the prompt (human-readable names only)
        # Convert snake_case family names to readable labels
        _FAMILY_LABELS = {
            "revenue": "Revenue",
            "cost_of_revenue": "Cost of Revenue",
            "gross_profit": "Gross Profit",
            "operating_income": "Operating Income",
            "net_income": "Net Income",
            "ebitda": "EBITDA",
            "research_development": "R&D Expense",
            "selling_general_admin": "SG&A Expense",
            "assets": "Total Assets",
            "current_assets": "Current Assets",
            "liabilities": "Total Liabilities",
            "current_liabilities": "Current Liabilities",
            "equity": "Stockholders' Equity",
            "long_term_debt": "Long-Term Debt",
            "cash": "Cash & Equivalents",
            "operating_cash_flow": "Operating Cash Flow",
            "investing_cash_flow": "Investing Cash Flow",
            "financing_cash_flow": "Financing Cash Flow",
            "inventory": "Inventory",
            "accounts_receivable": "Accounts Receivable",
            "accounts_payable": "Accounts Payable",
            "depreciation_amortization": "Depreciation & Amortization",
            "goodwill": "Goodwill",
            "intangible_assets": "Intangible Assets",
            "interest_expense": "Interest Expense",
            "income_tax_expense": "Income Tax Expense",
            "eps": "Earnings Per Share",
            "shares_outstanding": "Shares Outstanding",
        }
        available_metric_names = sorted(
            _FAMILY_LABELS.get(f, f.replace("_", " ").title())
            for f in available_metrics.keys()
        )
        available_metrics_text = ", ".join(available_metric_names) if available_metric_names else "None detected"

        # Evaluate if evidence exists
        insufficient_evidence = len(relevant_facts) == 0

        fallback_answer = "Insufficient evidence in the filing data exists to answer this question. The retrieved filing facts show no matching entries or do not establish its cause."

        if not self.is_available():
            return ChatResponse(
                answer=fallback_answer,
                citations=citations,
                comparisons=comparisons,
                evidence_count=evidence_count,
                insufficient_evidence=insufficient_evidence or not self.is_available()
            )

        # Build prompt
        prompt = f"""You are "Ask FilingLens", an AI financial analyst assistant built to answer user questions about a company's SEC filings.
You are helping a professional institutional investor analyze {company_name} (CIK: {cik}).

User Question: {question}

Below are the relevant financial facts retrieved from the company's SEC filings:
---
{citations_text or "No matching SEC filing facts were found in the database."}
---

Below are the deterministic trend comparisons calculated by the system:
---
{comparisons_text or "No compatible trend comparison data calculated."}
---

METRIC AVAILABILITY — The following financial metric families are confirmed present
in this company's structured XBRL filing data (via all known equivalent US-GAAP concept names):
  {available_metrics_text}

IMPORTANT: Use this availability list when evaluating `can_compute` and when generating
`suggested_follow_up_questions`. Only suggest follow-ups that draw on metrics from this list.
Do NOT suggest questions about metrics that are NOT in this list (e.g., if 'Revenue' is absent,
do not suggest gross margin or net margin questions that require revenue).

CRITICAL INSTRUCTIONS:
1. Classify the user question into one of these exact categories:
    * Financial Metric
    * Trend Analysis
    * Filing Comparison
    * Balance Sheet
    * Income Statement
    * Cash Flow
    * Risk Factors
    * MD&A
    * General Filing Question

2. Before concluding that a metric is unavailable, check whether any equivalent US-GAAP concept
   was found in the filing facts above. For example:
     - Revenue may appear as: Revenues, SalesRevenueNet, RevenueFromContractWithCustomerExcludingAssessedTax,
       OperatingRevenue, TotalRevenue, NetSales, RevenueNotFromContractWithCustomer.
     - Net Income may appear as: NetIncomeLoss, ProfitLoss, NetIncomeLossAvailableToCommonStockholdersBasic.
     - Assets may appear as: Assets, TotalAssets.
   If an equivalent concept is present in the citation list above, treat it as the requested metric
   and set `can_compute` to true. Name the actual concept used in your answer.

3. Evaluate whether the requested metric can actually be computed or verified with the provided SEC facts:
    * If it CANNOT be computed/verified (after checking equivalents), set `can_compute` to false.
    * If `can_compute` is false, you MUST set `explanation_or_missing_concepts` to follow this format:
      "We cannot verify whether [metric] [declined/changed] because [Concept A] and [Concept B] are not
      both available in the structured filing data. The available metrics for this company are: [list from METRIC AVAILABILITY]."
    * Provide the closest available financial facts or proxy metrics in `closest_available_evidence`.
      Only use metrics that appear in the METRIC AVAILABILITY list above.
    * If it CAN be computed/answered, set `can_compute` to true.

4. Answer formatting and ranking:
    * Keep the main `answer` concise, professional, and suitable for institutional investors. Never hallucinate.
    * Directly answer the user's actual question in the very first paragraph of the `answer`.
    * Do NOT refer to or list unrelated XBRL facts. Only include metrics directly related to the question.
    * Every number or claim must be cited using the citation IDs in brackets, e.g., [1], [2].
    * Include the concepts actually relevant to the question in `relevant_concepts`.
    * Do not infer causal relationships unless the facts explicitly support them.

5. Provide a brief "Analyst Interpretation" explaining what the figures imply for the company's financial condition.

6. Generate 3 to 4 highly relevant, professional "Suggested Follow-up Questions" in `suggested_follow_up_questions`.
   RULE: Every suggested question must be answerable using only the metrics listed in METRIC AVAILABILITY.
   Do not suggest questions about gross margin if Revenue is not available. Do not suggest questions about
   debt-to-equity if neither Long-Term Debt nor Equity is available.

7. Set `low_confidence` to true if the available structured facts are insufficient or limited.

8. If the question requires narrative disclosures (MD&A, Risk Factors, Notes, etc.), mention that
   those sections require parsing the full filing text rather than XBRL facts.
"""

        class GeminiChatResponse(BaseModel):
            category: str
            can_compute: bool
            explanation_or_missing_concepts: Optional[str] = None
            closest_available_evidence: Optional[str] = None
            answer: str
            analyst_interpretation: Optional[str] = None
            relevant_concepts: List[str] = []
            low_confidence: bool = False
            suggested_follow_up_questions: List[str] = []

        try:
            # Call Gemini
            response = await self.client.aio.models.generate_content(
                model='gemini-3.1-flash-lite',
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=GeminiChatResponse,
                    temperature=0.1
                )
            )
            resp_text = response.text.strip()
            
            # Fallback for old style mock tests which return plain text
            if not (resp_text.startswith("{") and resp_text.endswith("}")):
                is_insufficient = "insufficient evidence" in resp_text.lower()
                gemini_res = GeminiChatResponse(
                    category="General Filing Question",
                    can_compute=not is_insufficient,
                    explanation_or_missing_concepts=resp_text if is_insufficient else None,
                    answer=resp_text if not is_insufficient else "",
                    relevant_concepts=[c.concept for c in citations],
                    low_confidence=False
                )
            else:
                gemini_res = GeminiChatResponse.model_validate_json(resp_text)
        except Exception as e:
            logger.error(f"Gemini API call or JSON parsing failed for Ask FilingLens CIK {cik}: {e}")
            if 'response' in locals() and hasattr(response, 'text') and response.text:
                raw_text = response.text.strip()
                is_insufficient = "insufficient evidence" in raw_text.lower()
                gemini_res = GeminiChatResponse(
                    category="General Filing Question",
                    can_compute=not is_insufficient,
                    explanation_or_missing_concepts=raw_text if is_insufficient else None,
                    answer=raw_text if not is_insufficient else "",
                    relevant_concepts=[c.concept for c in citations],
                    low_confidence=False
                )
            else:
                return ChatResponse(
                    answer=fallback_answer,
                    citations=citations,
                    comparisons=comparisons,
                    evidence_count=evidence_count,
                    insufficient_evidence=True
                )

        # Enforce Requirement 4 sentence structure backup check in python
        if not gemini_res.can_compute:
            if not gemini_res.explanation_or_missing_concepts:
                if "gross margin" in question.lower() or "gross profit" in question.lower():
                    gemini_res.explanation_or_missing_concepts = "We cannot verify whether gross margin declined because Revenue and Cost of Revenue are not both available in the structured filing data."
                elif "operating margin" in question.lower():
                    gemini_res.explanation_or_missing_concepts = "We cannot verify whether operating margin changed because Operating Income and Revenue are not both available in the structured filing data."
                else:
                    gemini_res.explanation_or_missing_concepts = f"We cannot verify the requested metrics because the necessary concepts are not available in the structured filing data."

        # Build final answer text in a professional institutional analyst style
        final_parts = []
        
        # 1. Main Answer or computation explanation (Requirement 3: Actual question first!)
        if not gemini_res.can_compute:
            missing_explanation = gemini_res.explanation_or_missing_concepts
            closest_ev = f" {gemini_res.closest_available_evidence}" if gemini_res.closest_available_evidence else ""
            final_parts.append(f"{missing_explanation}{closest_ev}")
            insufficient_evidence = True
        else:
            if gemini_res.answer:
                final_parts.append(gemini_res.answer)
            insufficient_evidence = "insufficient evidence" in gemini_res.answer.lower()

        # 2. Analyst Interpretation (Requirement 5)
        if gemini_res.analyst_interpretation:
            if "Analyst Interpretation" not in gemini_res.answer:
                final_parts.append(f"**Analyst Interpretation:**\n{gemini_res.analyst_interpretation}")

        # 3. Category Tag & Metadata (Limitations/Warnings/Category at the bottom!)
        meta_info = [f"**Category:** {gemini_res.category}"]
        if gemini_res.low_confidence or "limited by available structured SEC data" in gemini_res.answer.lower():
            if "limited by available structured SEC data" not in gemini_res.answer.lower():
                meta_info.append("*This conclusion is limited by available structured SEC data.*")
            
        is_narrative = gemini_res.category in ["Risk Factors", "MD&A"] or any(word in question.lower() for word in ["risk", "mda", "note", "disclosure", "narrative", "text", "factor", "explain"])
        if is_narrative:
            if "parsing the filing text" not in gemini_res.answer.lower():
                meta_info.append("*Note: Answering questions regarding narrative disclosures (e.g. MD&A, Risk Factors, Notes) requires parsing the full text of the filing, whereas Ask FilingLens is currently optimized for structured XBRL facts.*")
            
        final_parts.append("\n".join(meta_info))

        # 4. Suggested Follow-up Questions (Requirement 5)
        if gemini_res.suggested_follow_up_questions:
            final_parts.append(
                "**Suggested Follow-up Questions:**\n" + 
                "\n".join([f"- {q}" for q in gemini_res.suggested_follow_up_questions[:4]])
            )

        answer_str = "\n\n".join(final_parts)

        # Filter citations list and comparison tables to keep ONLY the semantically relevant concepts (Requirement 1, 6 & 7)
        rel_concepts_clean = {c.replace("_", "").replace(" ", "").lower() for c in gemini_res.relevant_concepts}
        
        def is_concept_relevant(concept_name: str, label_name: Optional[str]) -> bool:
            if not rel_concepts_clean:
                return True
            c_name = concept_name.lower().replace("_", "").replace(" ", "")
            l_name = label_name.lower().replace("_", "").replace(" ", "") if label_name else ""
            return any(rc in c_name or rc in l_name or c_name in rc or l_name in rc for rc in rel_concepts_clean)

        filtered_citations = [c for c in citations if is_concept_relevant(c.concept, c.label)]
        filtered_comparisons = [comp for comp in comparisons if is_concept_relevant(comp.concept, comp.label)]

        # Fallback to keep everything if filtering resulted in empty lists but the answer is valid
        if gemini_res.can_compute and not filtered_citations and citations:
            filtered_citations = citations
        if gemini_res.can_compute and not filtered_comparisons and comparisons:
            filtered_comparisons = comparisons

        return ChatResponse(
            answer=answer_str,
            citations=filtered_citations,
            comparisons=filtered_comparisons,
            evidence_count=len(filtered_citations),
            insufficient_evidence=insufficient_evidence
        )
