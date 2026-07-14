from typing import List, Optional, Tuple, Dict
import httpx
import time
import logging
from app.services.sec_client import SECClient
from app.services.fact_normalizer import FactNormalizerService
from app.models.financial_fact import NormalizedFinancialFact
from app.models.verification import VerificationEvidence, VerificationFinding, VerificationSummary

logger = logging.getLogger(__name__)

class VerificationEngine:
    def __init__(self, sec_client: Optional[SECClient] = None):
        """
        Initialize VerificationEngine with a given SEC client.
        """
        self.sec_client = sec_client or SECClient()
        self.fact_normalizer = FactNormalizerService(sec_client=self.sec_client)

    def _check_tolerance(self, reported: float, expected: float) -> bool:
        """
        Evaluate if a reported value matches the expected value within allowed tolerance.
        """
        diff = abs(reported - expected)
        abs_tol = max(1.0, abs(expected) * 0.0001)
        if diff <= abs_tol:
            return True
        if expected != 0:
            rel_diff = diff / abs(expected)
            if rel_diff <= 0.0001:  # 0.01% relative tolerance
                return True
        return False

    def _make_explanation(
        self,
        check_id: str,
        status: str,
        reported: float,
        expected: float,
        diff: float,
        equation: str
    ) -> Tuple[str, List[str]]:
        """
        Generate a deterministic explanation and possible explanations for a finding,
        ensuring that no prohibited words (fraud, manipulation, etc.) are used.
        """
        if status == "passed":
            return "Check passed successfully.", []

        explanation = ""
        possible_explanations = []

        if check_id == "BS_EQUITY":
            explanation = f"Balance sheet equation mismatch: reported Assets ({reported}) does not match expected Liabilities and Equity sum ({expected}) (difference of {diff})."
            possible_explanations = [
                "XBRL context differences between assets and liabilities/equity reporting.",
                "Filing-specific accounting treatments or presentation choices.",
                "Reclassification of items not captured in standard tags."
            ]
        elif check_id == "GROSS_PROFIT":
            explanation = f"Gross profit mismatch: reported Gross Profit ({reported}) does not match expected Revenues less Cost of Revenue ({expected}) (difference of {diff})."
            possible_explanations = [
                "Filing-specific accounting treatment of direct costs vs general operating expenses.",
                "Use of custom or alternative tags for revenues or cost of revenues.",
                "Presentation choices on multi-step income statements."
            ]
        elif check_id == "OPERATING_INCOME":
            explanation = f"Operating income mismatch: reported Operating Income ({reported}) does not match expected Gross Profit less Operating Expenses ({expected}) (difference of {diff})."
            possible_explanations = [
                "Presentation choices regarding operating vs non-operating items.",
                "Differences in classification of operating expenses across periods.",
                "Custom tag usage for specific expense categories."
            ]
        elif check_id == "CASH_CONSISTENCY":
            explanation = f"Cash consistency discrepancy: reported balance sheet Cash and Cash Equivalents ({reported}) does not match cash flow ending cash ({expected}) (difference of {diff})."
            possible_explanations = [
                "Restricted cash inclusions or exclusions in cash flow ending balances.",
                "XBRL context differences or presentation choices between balance sheet and cash flow statements.",
                "Filing-specific accounting treatments of cash equivalents."
            ]
        elif check_id == "NET_INCOME_DUPLICATE":
            explanation = f"Duplicate facts mismatch for NetIncomeLoss: found conflicting reported values of {reported} and {expected} within the same filing reporting context."
            possible_explanations = [
                "Duplicate fact tagging with subtle context differences (e.g. continuing operations vs total).",
                "Filing-specific XBRL presentation choices or tag overrides."
            ]

        return explanation, possible_explanations

    def _to_evidence(self, fact: NormalizedFinancialFact) -> VerificationEvidence:
        """
        Convert a NormalizedFinancialFact into a VerificationEvidence record.
        """
        return VerificationEvidence(
            namespace=fact.namespace,
            concept=fact.concept,
            label=fact.label,
            value=fact.value,
            unit=fact.unit,
            end_date=fact.end_date,
            start_date=fact.start_date,
            form=fact.form,
            filed_date=fact.filed_date,
            accession_number=fact.accession_number,
            source_url=fact.source_url
        )

    async def verify_company(
        self,
        cik: int,
        forms: Optional[List[str]] = None,
        limit_periods: int = 8
    ) -> VerificationSummary:
        """
        Run the deterministic financial verification checks on a company's SEC facts.
        """
        limit_periods = max(1, min(20, limit_periods))
        target_forms = forms or ["10-K", "10-Q"]

        # Fetch and normalize all company facts
        facts_res = await self.fact_normalizer.get_company_facts(cik, forms=target_forms, limit=5000)
        company_name = facts_res.company_name
        all_facts = facts_res.facts

        ver_start_time = time.time()

        # Extract unique end dates, newest first
        end_dates = sorted(list({f.end_date for f in all_facts}), reverse=True)
        top_end_dates = end_dates[:limit_periods]

        checks_run = 0
        checks_passed = 0
        confirmed_inconsistencies = 0
        review_items = 0
        skipped_checks = 0
        findings: List[VerificationFinding] = []

        for period_end in top_end_dates:
            # Group facts for this period by accession number
            acc_groups: Dict[str, List[NormalizedFinancialFact]] = {}
            for f in all_facts:
                if f.end_date == period_end:
                    acc_num = f.accession_number or "UNKNOWN"
                    acc_groups.setdefault(acc_num, []).append(f)

            for acc_num, group_facts in acc_groups.items():
                # Further group by unit (case-insensitive)
                unit_groups: Dict[str, List[NormalizedFinancialFact]] = {}
                for f in group_facts:
                    unit_key = f.unit.upper()
                    unit_groups.setdefault(unit_key, []).append(f)

                for unit_key, unit_facts in unit_groups.items():
                    # Get standard form for metadata
                    form_val = unit_facts[0].form

                    # Helper to find first matching fact by concept name
                    def find_fact(concepts: List[str], start_date_val: Optional[str] = None, is_duration: bool = False) -> Optional[NormalizedFinancialFact]:
                        upper_concepts = [c.upper() for c in concepts]
                        for f in unit_facts:
                            if f.concept.upper() in upper_concepts:
                                if is_duration:
                                    if f.start_date == start_date_val:
                                        return f
                                else:
                                    if f.start_date is None:
                                        return f
                        return None

                    # ----------------------------------------------------
                    # Check A: Balance Sheet Equation
                    # ----------------------------------------------------
                    assets = find_fact(["Assets"])
                    liab_eq = find_fact(["LiabilitiesAndStockholdersEquity"])
                    liab = find_fact(["Liabilities"])
                    eq = find_fact(["StockholdersEquity"])

                    check_a_status = "skipped"
                    reported_a, expected_a, diff_a, rel_diff_a = None, None, None, None
                    eq_str_a = None
                    evidence_a = []

                    if assets and liab_eq:
                        reported_a = assets.value
                        expected_a = liab_eq.value
                        eq_str_a = "Assets = LiabilitiesAndStockholdersEquity"
                        evidence_a = [assets, liab_eq]
                        check_a_status = "passed" if self._check_tolerance(reported_a, expected_a) else "confirmed_inconsistency"
                    elif assets and liab and eq:
                        reported_a = assets.value
                        expected_a = liab.value + eq.value
                        eq_str_a = "Assets = Liabilities + StockholdersEquity"
                        evidence_a = [assets, liab, eq]
                        check_a_status = "passed" if self._check_tolerance(reported_a, expected_a) else "confirmed_inconsistency"

                    if check_a_status != "skipped":
                        checks_run += 1
                        if check_a_status == "passed":
                            checks_passed += 1
                        else:
                            confirmed_inconsistencies += 1
                            diff_a = abs(reported_a - expected_a)
                            rel_diff_a = diff_a / abs(expected_a) if expected_a else None
                            explanation, possible_exps = self._make_explanation(
                                "BS_EQUITY", "confirmed_inconsistency", reported_a, expected_a, diff_a, eq_str_a
                            )
                            findings.append(VerificationFinding(
                                check_id="BS_EQUITY",
                                title="Balance Sheet Equation Consistency",
                                category="Balance Sheet",
                                status="confirmed_inconsistency",
                                severity="high",
                                confidence=0.95,
                                period_end=period_end,
                                form=form_val,
                                unit=unit_key,
                                reported_value=reported_a,
                                expected_value=expected_a,
                                difference=diff_a,
                                relative_difference=rel_diff_a,
                                equation=eq_str_a,
                                explanation=explanation,
                                possible_explanations=possible_exps,
                                evidence=[self._to_evidence(x) for x in evidence_a]
                            ))
                    else:
                        skipped_checks += 1

                    # ----------------------------------------------------
                    # Check D: Cash Consistency (Instant / Balance Sheet vs Restricted ending Cash)
                    # ----------------------------------------------------
                    cash_carrying = find_fact(["CashAndCashEquivalentsAtCarryingValue"])
                    cash_restricted = find_fact(["CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"])

                    if cash_carrying and cash_restricted:
                        reported_d = cash_carrying.value
                        expected_d = cash_restricted.value
                        eq_str_d = "CashAndCashEquivalentsAtCarryingValue = CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"
                        evidence_d = [cash_carrying, cash_restricted]
                        
                        checks_run += 1
                        if self._check_tolerance(reported_d, expected_d):
                            checks_passed += 1
                        else:
                            review_items += 1
                            diff_d = abs(reported_d - expected_d)
                            rel_diff_d = diff_d / abs(expected_d) if expected_d else None
                            explanation, possible_exps = self._make_explanation(
                                "CASH_CONSISTENCY", "review_item", reported_d, expected_d, diff_d, eq_str_d
                            )
                            findings.append(VerificationFinding(
                                check_id="CASH_CONSISTENCY",
                                title="Cash Flow Ending Cash Consistency",
                                category="Cash Flow",
                                status="review_item",
                                severity="low",
                                confidence=0.70,
                                period_end=period_end,
                                form=form_val,
                                unit=unit_key,
                                reported_value=reported_d,
                                expected_value=expected_d,
                                difference=diff_d,
                                relative_difference=rel_diff_d,
                                equation=eq_str_d,
                                explanation=explanation,
                                possible_explanations=possible_exps,
                                evidence=[self._to_evidence(x) for x in evidence_d]
                            ))

                    # ----------------------------------------------------
                    # Duration Checks (grouped by start_date)
                    # ----------------------------------------------------
                    start_dates = {f.start_date for f in unit_facts if f.start_date is not None}
                    for start_date in start_dates:
                        # Find Gross Profit, Revenues, Cost
                        gp = find_fact(["GrossProfit"], start_date, is_duration=True)
                        rev = find_fact([
                            "RevenueFromContractWithCustomerExcludingAssessedTax",
                            "SalesRevenueNet",
                            "Revenues"
                        ], start_date, is_duration=True)
                        cost = find_fact([
                            "CostOfRevenue",
                            "CostOfGoodsAndServicesSold",
                            "CostOfGoodsSold"
                        ], start_date, is_duration=True)

                        # Check B: Gross profit
                        check_b_status = "skipped"
                        reported_b, expected_b, diff_b, rel_diff_b = None, None, None, None
                        eq_str_b = None
                        evidence_b = []

                        if gp and rev and cost:
                            reported_b = gp.value
                            expected_b = rev.value - cost.value
                            eq_str_b = "GrossProfit = Revenues - CostOfRevenue"
                            evidence_b = [gp, rev, cost]
                            check_b_status = "passed" if self._check_tolerance(reported_b, expected_b) else "confirmed_inconsistency"

                        if check_b_status != "skipped":
                            checks_run += 1
                            if check_b_status == "passed":
                                checks_passed += 1
                            else:
                                confirmed_inconsistencies += 1
                                diff_b = abs(reported_b - expected_b)
                                rel_diff_b = diff_b / abs(expected_b) if expected_b else None
                                explanation, possible_exps = self._make_explanation(
                                    "GROSS_PROFIT", "confirmed_inconsistency", reported_b, expected_b, diff_b, eq_str_b
                                )
                                findings.append(VerificationFinding(
                                    check_id="GROSS_PROFIT",
                                    title="Gross Profit Calculation",
                                    category="Income Statement",
                                    status="confirmed_inconsistency",
                                    severity="medium",
                                    confidence=0.95,
                                    period_end=period_end,
                                    form=form_val,
                                    unit=unit_key,
                                    reported_value=reported_b,
                                    expected_value=expected_b,
                                    difference=diff_b,
                                    relative_difference=rel_diff_b,
                                    equation=eq_str_b,
                                    explanation=explanation,
                                    possible_explanations=possible_exps,
                                    evidence=[self._to_evidence(x) for x in evidence_b]
                                ))
                        else:
                            skipped_checks += 1

                        # Check C: Operating Income
                        op_inc = find_fact(["OperatingIncomeLoss"], start_date, is_duration=True)
                        op_exp = find_fact(["OperatingExpenses"], start_date, is_duration=True)

                        check_c_status = "skipped"
                        reported_c, expected_c, diff_c, rel_diff_c = None, None, None, None
                        eq_str_c = None
                        evidence_c = []

                        if op_inc and gp and op_exp:
                            reported_c = op_inc.value
                            expected_c = gp.value - op_exp.value
                            eq_str_c = "OperatingIncomeLoss = GrossProfit - OperatingExpenses"
                            evidence_c = [op_inc, gp, op_exp]
                            check_c_status = "passed" if self._check_tolerance(reported_c, expected_c) else "confirmed_inconsistency"

                        if check_c_status != "skipped":
                            checks_run += 1
                            if check_c_status == "passed":
                                checks_passed += 1
                            else:
                                confirmed_inconsistencies += 1
                                diff_c = abs(reported_c - expected_c)
                                rel_diff_c = diff_c / abs(expected_c) if expected_c else None
                                explanation, possible_exps = self._make_explanation(
                                    "OPERATING_INCOME", "confirmed_inconsistency", reported_c, expected_c, diff_c, eq_str_c
                                )
                                findings.append(VerificationFinding(
                                    check_id="OPERATING_INCOME",
                                    title="Operating Income Calculation",
                                    category="Income Statement",
                                    status="confirmed_inconsistency",
                                    severity="medium",
                                    confidence=0.95,
                                    period_end=period_end,
                                    form=form_val,
                                    unit=unit_key,
                                    reported_value=reported_c,
                                    expected_value=expected_c,
                                    difference=diff_c,
                                    relative_difference=rel_diff_c,
                                    equation=eq_str_c,
                                    explanation=explanation,
                                    possible_explanations=possible_exps,
                                    evidence=[self._to_evidence(x) for x in evidence_c]
                                ))
                        else:
                            skipped_checks += 1

                        # Check D: Cash Consistency (Duration ending cash vs carrying value at start)
                        cash_inc_dec = find_fact(["CashAndCashEquivalentsPeriodIncreaseDecrease"], start_date, is_duration=True)
                        if cash_inc_dec and cash_carrying:
                            # Look for beginning cash (carrying value at start_date)
                            # Start date must be the end date of the beginning fact
                            beg_cash = None
                            for f in unit_facts:
                                if f.concept == "CashAndCashEquivalentsAtCarryingValue" and f.start_date is None and f.end_date == start_date:
                                    beg_cash = f
                                    break
                            
                            if beg_cash:
                                reported_d2 = cash_carrying.value
                                expected_d2 = beg_cash.value + cash_inc_dec.value
                                eq_str_d2 = "CashCarryingEnd = CashCarryingStart + CashPeriodIncreaseDecrease"
                                evidence_d2 = [cash_carrying, beg_cash, cash_inc_dec]
                                
                                checks_run += 1
                                if self._check_tolerance(reported_d2, expected_d2):
                                    checks_passed += 1
                                else:
                                    confirmed_inconsistencies += 1
                                    diff_d2 = abs(reported_d2 - expected_d2)
                                    rel_diff_d2 = diff_d2 / abs(expected_d2) if expected_d2 else None
                                    explanation, possible_exps = self._make_explanation(
                                        "CASH_CONSISTENCY", "confirmed_inconsistency", reported_d2, expected_d2, diff_d2, eq_str_d2
                                    )
                                    findings.append(VerificationFinding(
                                        check_id="CASH_CONSISTENCY",
                                        title="Cash Flow Ending Cash Consistency",
                                        category="Cash Flow",
                                        status="confirmed_inconsistency",
                                        severity="medium",
                                        confidence=0.95,
                                        period_end=period_end,
                                        form=form_val,
                                        unit=unit_key,
                                        reported_value=reported_d2,
                                        expected_value=expected_d2,
                                        difference=diff_d2,
                                        relative_difference=rel_diff_d2,
                                        equation=eq_str_d2,
                                        explanation=explanation,
                                        possible_explanations=possible_exps,
                                        evidence=[self._to_evidence(x) for x in evidence_d2]
                                    ))

                        # Check E: Net Income Consistency (Duplicates)
                        net_income_facts = [
                            f for f in unit_facts 
                            if f.concept == "NetIncomeLoss" and f.start_date == start_date
                        ]
                        # Sub-group duplicate facts by form, fiscal year, fiscal period
                        dup_groups: Dict[Tuple[Optional[str], Optional[int], Optional[str]], List[NormalizedFinancialFact]] = {}
                        for f in net_income_facts:
                            key = (f.form, f.fiscal_year, f.fiscal_period)
                            dup_groups.setdefault(key, []).append(f)
                            
                        for key, dup_facts in dup_groups.items():
                            if len(dup_facts) >= 2:
                                # We evaluate all pairs or check if all equal to the first
                                base_fact = dup_facts[0]
                                mismatch_fact = None
                                for f in dup_facts[1:]:
                                    if not self._check_tolerance(f.value, base_fact.value):
                                        mismatch_fact = f
                                        break
                                
                                checks_run += 1
                                if not mismatch_fact:
                                    checks_passed += 1
                                else:
                                    confirmed_inconsistencies += 1
                                    reported_e = base_fact.value
                                    expected_e = mismatch_fact.value
                                    diff_e = abs(reported_e - expected_e)
                                    rel_diff_e = diff_e / abs(expected_e) if expected_e else None
                                    eq_str_e = "NetIncomeLoss_1 = NetIncomeLoss_2"
                                    
                                    explanation, possible_exps = self._make_explanation(
                                        "NET_INCOME_DUPLICATE", "confirmed_inconsistency", reported_e, expected_e, diff_e, eq_str_e
                                    )
                                    findings.append(VerificationFinding(
                                        check_id="NET_INCOME_DUPLICATE",
                                        title="Net Income Duplicate Fact Consistency",
                                        category="Income Statement",
                                        status="confirmed_inconsistency",
                                        severity="high",
                                        confidence=0.95,
                                        period_end=period_end,
                                        form=form_val,
                                        unit=unit_key,
                                        reported_value=reported_e,
                                        expected_value=expected_e,
                                        difference=diff_e,
                                        relative_difference=rel_diff_e,
                                        equation=eq_str_e,
                                        explanation=explanation,
                                        possible_explanations=possible_exps,
                                        evidence=[self._to_evidence(x) for x in dup_facts]
                                    ))

        # Sort findings: Period newest first (descending), then Severity (highest first)
        severity_rank = {"high": 0, "medium": 1, "low": 2}
        findings.sort(key=lambda f: severity_rank.get(f.severity, 3))
        findings.sort(key=lambda f: f.period_end, reverse=True)

        ver_duration = time.time() - ver_start_time
        logger.info(f"[TIMING] Verification checks for CIK {cik} took {ver_duration:.4f}s")

        return VerificationSummary(
            cik=cik,
            company_name=company_name,
            checks_run=checks_run,
            checks_passed=checks_passed,
            confirmed_inconsistencies=confirmed_inconsistencies,
            review_items=review_items,
            skipped_checks=skipped_checks,
            findings=findings
        )
