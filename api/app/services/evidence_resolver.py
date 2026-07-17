"""
evidence_resolver.py
====================
Multi-stage, confidence-scored SEC evidence-resolution pipeline.

Resolution order
----------------
  Stage A  –  Search the pre-normalised local fact list (cache).
  Stage B  –  Force-refresh companyfacts from SEC EDGAR if Stage A misses.
  Stage C  –  Identify the most relevant filing via submissions and inspect
              its inline XBRL facts directly.
  Stage D  –  Scan for validated extension (company-specific) concepts.

The resolver returns a typed ``EvidenceResolutionResult`` that carries:
  - the best matching ``NormalizedFinancialFact`` (or None)
  - a structured ``resolution_status`` string
  - a list of human-readable ``stage_details`` lines for the UI checklist

Genuine ``insufficient_evidence`` is only returned after *all* stages fail.
``SECRetrievalError`` is separately flagged as ``retrieval_error`` and must
not be mapped to ``insufficient_evidence``.
"""

from __future__ import annotations

import logging
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from app.models.claim_audit import ExtractedClaim
from app.models.financial_fact import CompanyFactsResponse, NormalizedFinancialFact
from app.services.claim_verification_service import (
    CONCEPT_MAPPINGS,
    INSTANT_METRICS,
    METRIC_LABEL_KEYWORDS,
    parse_period,
)
from app.services.fact_normalizer import FactNormalizerService
from app.services.sec_client import SECClient, SECRetrievalError

logger = logging.getLogger(__name__)

# ── Resolution status constants ──────────────────────────────────────────────
STATUS_CACHE_MATCH = "cache_match"
STATUS_LIVE_CF_MATCH = "live_companyfacts_match"
STATUS_FILING_XBRL_MATCH = "filing_xbrl_match"
STATUS_EXTENSION_MATCH = "extension_concept_match"
STATUS_NO_MATCH = "no_confident_match"
STATUS_RETRIEVAL_ERROR = "retrieval_error"

# ── Confidence score thresholds ───────────────────────────────────────────────
MIN_CONFIDENCE_SCORE = 40  # candidates below this are rejected


# ── Result dataclass ──────────────────────────────────────────────────────────

@dataclass
class EvidenceResolutionResult:
    fact: Optional[NormalizedFinancialFact] = None
    resolution_status: str = STATUS_NO_MATCH
    confidence_score: int = 0
    stage_details: List[str] = field(default_factory=list)
    error_message: Optional[str] = None
    score_breakdown: Optional[Dict[str, int]] = None


# ── Scoring helpers ───────────────────────────────────────────────────────────

def _score_candidate_with_breakdown(
    fact: NormalizedFinancialFact,
    metric_key: str,
    year: int,
    period: str,
    is_alias: bool,
    is_extension: bool,
    claim_company_cik: Optional[str] = None,
) -> Tuple[int, Dict[str, int]]:
    """
    Score a candidate fact against the claim requirements, returning the total score
    and a breakdown dictionary.
    """
    breakdown = {
        "company_match": 0,
        "concept_match": 0,
        "period_match": 0,
        "form_match": 0,
        "unit_match": 0,
        "filing_date_score": 0,
        "accession_number_score": 0,
        "taxonomy_confidence": 0,
    }

    # 1. Company match
    if claim_company_cik and fact.source_url and f"/data/{int(claim_company_cik)}/" in fact.source_url:
        breakdown["company_match"] = 20
    else:
        breakdown["company_match"] = 10

    # 2. Concept match
    if not is_alias and not is_extension:
        breakdown["concept_match"] = 30  # exact standard concept
    elif is_alias:
        breakdown["concept_match"] = 20  # known alias concept
    else:
        breakdown["concept_match"] = 15  # validated extension concept

    # 3. Taxonomy confidence
    if fact.namespace.lower() == "us-gaap":
        breakdown["taxonomy_confidence"] = 10
    elif fact.namespace.lower() == "dei":
        breakdown["taxonomy_confidence"] = 8
    else:
        breakdown["taxonomy_confidence"] = 5  # Extension has lower base confidence

    # 4. Period match
    p_score = 0
    # Fiscal year check
    if fact.fiscal_year == year:
        p_score += 15
    elif fact.end_date:
        try:
            end_dt = datetime.strptime(fact.end_date, "%Y-%m-%d")
            if end_dt.year == year:
                p_score += 10
        except ValueError:
            pass

    # Fiscal period check (FY vs Q1/Q2/Q3/Q4)
    if fact.fiscal_period == period:
        p_score += 15
    elif fact.end_date:
        try:
            end_dt = datetime.strptime(fact.end_date, "%Y-%m-%d")
            end_mo = end_dt.month
            if period == "FY" and end_mo in (11, 12, 1):
                p_score += 10
            elif period == "Q1" and end_mo in (3, 4, 5):
                p_score += 10
            elif period == "Q2" and end_mo in (6, 7, 8):
                p_score += 10
            elif period == "Q3" and end_mo in (9, 10, 11):
                p_score += 10
            elif period == "Q4" and end_mo in (11, 12, 1, 2):
                p_score += 10
        except ValueError:
            pass

    # Duration/Instant match
    is_instant = metric_key in INSTANT_METRICS
    if is_instant:
        if fact.start_date is None:
            p_score += 10
        else:
            p_score -= 15
    else:
        if fact.start_date is not None:
            p_score += 5
            try:
                start_dt = datetime.strptime(fact.start_date, "%Y-%m-%d")
                end_dt = datetime.strptime(fact.end_date, "%Y-%m-%d")
                days = (end_dt - start_dt).days
                if period == "FY" and 330 <= days <= 400:
                    p_score += 10
                elif period != "FY" and 60 <= days <= 120:
                    p_score += 10
                else:
                    p_score -= 5
            except ValueError:
                pass
        else:
            p_score -= 15

    breakdown["period_match"] = p_score

    # 5. Form match
    f_score = 0
    if fact.form:
        form_upper = fact.form.upper()
        if period == "FY" and form_upper == "10-K":
            f_score += 15
        elif period != "FY" and form_upper == "10-Q":
            f_score += 15
        elif form_upper in ("10-K/A", "10-Q/A"):
            f_score += 5
    breakdown["form_match"] = f_score

    # 6. Unit match
    u_score = 10
    if fact.unit:
        unit_upper = fact.unit.upper()
        dollar_metrics = {
            "revenue", "net_income", "gross_profit", "operating_income",
            "ebit", "assets", "liabilities", "equity", "cash", "inventory",
            "receivables", "operating_cash_flow", "investing_cash_flow",
            "financing_cash_flow", "capex", "research_development", "debt",
            "cost_of_revenue", "operating_expenses",
        }
        if metric_key in dollar_metrics:
            if unit_upper in ("USD", "EUR", "GBP", "CAD", "JPY"):
                u_score += 10
            else:
                u_score -= 20
        elif metric_key == "eps":
            if "SHARES" in unit_upper or "USD" in unit_upper:
                u_score += 10
            else:
                u_score -= 10
    breakdown["unit_match"] = u_score

    # 7. Filing date
    fd_score = 0
    if fact.filed_date:
        try:
            fd_dt = datetime.strptime(fact.filed_date, "%Y-%m-%d")
            fd_score = min(10, (fd_dt.year - 2000) // 2)
        except ValueError:
            pass
    breakdown["filing_date_score"] = fd_score

    # 8. Accession number
    breakdown["accession_number_score"] = 5 if fact.accession_number else 0

    total_score = sum(breakdown.values())
    return total_score, breakdown


def _score_candidate(
    fact: NormalizedFinancialFact,
    metric_key: str,
    year: int,
    period: str,
    is_alias: bool,
    is_extension: bool,
) -> int:
    """Return a confidence score for a candidate fact."""
    score, _ = _score_candidate_with_breakdown(
        fact, metric_key, year, period, is_alias, is_extension
    )
    return score


def _is_valid_extension_concept(
    fact: NormalizedFinancialFact,
    metric_key: str,
    year: int,
    period: str,
    parsed_linkbases: Optional[Dict[str, Any]] = None,
) -> bool:
    """
    Accept an extension (non-us-gaap) concept only when ALL criteria are met:
    1. The namespace is NOT us-gaap, dei, srt, or country (i.e. it really is an extension).
    2. Label/concept name contains a relevant keyword for the metric.
    3. Unit is consistent (USD for dollar metrics, shares for EPS).
    4. Plausible contextual validation mapping to a standard concept if linkbases are present.
    """
    ns_lower = fact.namespace.lower()
    if ns_lower in ("us-gaap", "dei", "srt", "country"):
        return False

    # Label keyword check
    label = (fact.label or "").lower()
    concept_name = fact.concept.lower()
    keywords = METRIC_LABEL_KEYWORDS.get(metric_key, [])
    if not any(kw in label for kw in keywords) and not any(kw in concept_name for kw in keywords):
        return False

    # Unit plausibility
    unit = (fact.unit or "").upper()
    dollar_metrics = {
        "revenue", "net_income", "gross_profit", "operating_income",
        "ebit", "assets", "liabilities", "equity", "cash", "inventory",
        "receivables", "operating_cash_flow", "investing_cash_flow",
        "financing_cash_flow", "capex", "research_development", "debt",
        "cost_of_revenue", "operating_expenses",
    }
    if metric_key in dollar_metrics and unit not in ("USD", ""):
        return False

    # Contextual check via parsed linkbases
    if parsed_linkbases:
        concept_id = f"{fact.namespace}_{fact.concept}"
        
        # Check Statement Location
        presentation = parsed_linkbases.get("presentation", {})
        concept_roles = presentation.get("concept_roles", {})
        roles_for_concept = concept_roles.get(concept_id, [])
        
        expected_roles = []
        if metric_key in ("revenue", "net_income", "operating_income", "gross_profit", "eps", "research_development", "cost_of_revenue", "operating_expenses"):
            expected_roles = ["operations", "income", "earnings", "benefit", "loss"]
        elif metric_key in ("assets", "liabilities", "equity"):
            expected_roles = ["balance", "position", "condition"]
        elif metric_key in ("cash", "operating_cash_flow", "investing_cash_flow", "financing_cash_flow", "capex"):
            expected_roles = ["cash", "flows"]
            
        if expected_roles:
            role_matched = False
            for role in roles_for_concept:
                role_lower = role.lower()
                if any(er in role_lower for er in expected_roles):
                    role_matched = True
                    break
            if not role_matched and roles_for_concept:
                return False
                
        # Check Presentation or Calculation Relationship
        std_concepts = CONCEPT_MAPPINGS.get(metric_key, [])
        std_concept_ids = {f"us-gaap_{c}" for c in std_concepts}
        
        rel_matched = False
        
        pre_parents = presentation.get("parents", {})
        if concept_id in pre_parents:
            for p, _ in pre_parents[concept_id]:
                if p in std_concept_ids:
                    rel_matched = True
                    break
                    
        for child, p_list in pre_parents.items():
            if rel_matched:
                break
            for p, _ in p_list:
                if p == concept_id and child in std_concept_ids:
                    rel_matched = True
                    break
                    
        calculation = parsed_linkbases.get("calculation", {})
        cal_parents = calculation.get("parents", {})
        if concept_id in cal_parents:
            for p, _, _ in cal_parents[concept_id]:
                if p in std_concept_ids:
                    rel_matched = True
                    break
                    
        for child, p_list in cal_parents.items():
            if rel_matched:
                break
            for p, _, _ in p_list:
                if p == concept_id and child in std_concept_ids:
                    rel_matched = True
                    break
                    
        if not rel_matched:
            is_in_pre = concept_id in pre_parents or any(concept_id == p for p_list in pre_parents.values() for p, _ in p_list)
            is_in_cal = concept_id in cal_parents or any(concept_id == p for p_list in cal_parents.values() for p, _, _ in p_list)
            if is_in_pre or is_in_cal:
                return False

    return True


# ── Main resolver class ───────────────────────────────────────────────────────

class EvidenceResolver:
    """
    Multi-stage SEC evidence-resolution pipeline.

    Usage::

        resolver = EvidenceResolver()
        result = await resolver.resolve(claim, cached_facts)
    """

    def __init__(
        self,
        sec_client: Optional[SECClient] = None,
        fact_normalizer: Optional[FactNormalizerService] = None,
    ):
        self.sec_client = sec_client or SECClient()
        self.fact_normalizer = fact_normalizer or FactNormalizerService(self.sec_client)

    # ── Public entry point ────────────────────────────────────────────────────

    async def resolve(
        self,
        claim: ExtractedClaim,
        cached_facts: Optional[CompanyFactsResponse],
        metric_key: str,
        year: int,
        period: str,
    ) -> EvidenceResolutionResult:
        """
        Try to find the best-matching XBRL fact for *metric_key* / *year* /
        *period* for the given claim.  Returns an ``EvidenceResolutionResult``
        regardless of success; only the ``resolution_status`` field differs.
        """
        cik: Optional[int] = None
        if claim.cik:
            try:
                cik = int(claim.cik)
            except (ValueError, TypeError):
                pass

        log_prefix = (
            f"[EVIDENCE RESOLVER] claim='{claim.original_text[:60]}' "
            f"company={claim.company_name} cik={cik} "
            f"metric={metric_key} period={period} year={year}"
        )
        logger.debug(f"{log_prefix} → starting resolution")

        concepts = CONCEPT_MAPPINGS.get(metric_key, [])
        is_instant = metric_key in INSTANT_METRICS

        # ── Stage A: Search cached/pre-normalised fact list ──────────────────
        if cached_facts and cached_facts.facts:
            result = self._search_facts(
                cached_facts.facts, concepts, metric_key, year, period, is_instant,
                stage_label="A (cached companyfacts)",
                claim_company_cik=str(cik) if cik else None,
            )
            if result.fact:
                result.resolution_status = STATUS_CACHE_MATCH
                logger.info(
                    f"[EVIDENCE RESOLUTION PATH] claim_id={hash(claim.original_text)} | "
                    f"company={claim.company_name} | CIK={cik} | "
                    f"candidate_concepts={concepts} | candidate_periods={(year, period)} | "
                    f"selected_fact={result.fact.concept} | confidence_score={result.confidence_score} | "
                    f"resolution_source={result.resolution_status} | failure_reason=None"
                )
                return result

        # ── Stage B: Refresh companyfacts from SEC EDGAR ─────────────────────
        if cik:
            try:
                logger.debug(f"{log_prefix} → Stage A miss, refreshing companyfacts (Stage B)")
                raw = await self.sec_client.refresh_company_facts(cik)
                fresh_facts_res = await self.fact_normalizer.get_company_facts(
                    cik, forms=["10-K", "10-Q"]
                )
                result = self._search_facts(
                    fresh_facts_res.facts, concepts, metric_key, year, period, is_instant,
                    stage_label="B (live companyfacts)",
                    claim_company_cik=str(cik),
                )
                if result.fact:
                    result.resolution_status = STATUS_LIVE_CF_MATCH
                    logger.info(
                        f"[EVIDENCE RESOLUTION PATH] claim_id={hash(claim.original_text)} | "
                        f"company={claim.company_name} | CIK={cik} | "
                        f"candidate_concepts={concepts} | candidate_periods={(year, period)} | "
                        f"selected_fact={result.fact.concept} | confidence_score={result.confidence_score} | "
                        f"resolution_source={result.resolution_status} | failure_reason=None"
                    )
                    return result

                # ── Stage C: Filing-level XBRL fallback ──────────────────────
                filing_result = await self._resolve_from_filing(
                    cik, metric_key, concepts, year, period, is_instant, log_prefix
                )
                if filing_result.fact:
                    logger.info(
                        f"[EVIDENCE RESOLUTION PATH] claim_id={hash(claim.original_text)} | "
                        f"company={claim.company_name} | CIK={cik} | "
                        f"candidate_concepts={concepts} | candidate_periods={(year, period)} | "
                        f"selected_fact={filing_result.fact.concept} | confidence_score={filing_result.confidence_score} | "
                        f"resolution_source={filing_result.resolution_status} | failure_reason=None"
                    )
                    return filing_result

                # ── Stage D: Extension concept scan ───────────────────────────
                submissions = await self.sec_client.get_company_submissions(cik)
                target_accession = self._find_best_filing_accession(submissions, year, period)
                linkbase_data = None
                if target_accession:
                    try:
                        linkbase_data = await self._parse_filing_linkbases(cik, target_accession)
                    except Exception as e:
                        logger.warning(f"Could not parse linkbases for extension scan: {e}")

                filing_facts = []
                if target_accession:
                    recent_filings = submissions.get("filings", {}).get("recent", {})
                    form = "10-K"
                    filed_date = ""
                    if "form" in recent_filings and "accessionNumber" in recent_filings:
                        try:
                            idx = recent_filings["accessionNumber"].index(target_accession)
                            form = recent_filings["form"][idx]
                            filed_date = recent_filings["filingDate"][idx]
                        except Exception:
                            pass
                    filing_facts = await self._fetch_and_parse_filing_xbrl_facts(cik, target_accession, form, filed_date)

                ext_result = self._search_extension_concepts(
                    fresh_facts_res.facts + filing_facts, metric_key, year, period, is_instant, log_prefix,
                    parsed_linkbases=linkbase_data, claim_company_cik=str(cik)
                )
                if ext_result.fact:
                    ext_result.resolution_status = STATUS_EXTENSION_MATCH
                    logger.info(
                        f"[EVIDENCE RESOLUTION PATH] claim_id={hash(claim.original_text)} | "
                        f"company={claim.company_name} | CIK={cik} | "
                        f"candidate_concepts={concepts} | candidate_periods={(year, period)} | "
                        f"selected_fact={ext_result.fact.concept} | confidence_score={ext_result.confidence_score} | "
                        f"resolution_source={ext_result.resolution_status} | failure_reason=None"
                    )
                    return ext_result

            except SECRetrievalError as exc:
                logger.warning(f"{log_prefix} → SEC retrieval error: {exc}")
                err_result = EvidenceResolutionResult(
                    resolution_status=STATUS_RETRIEVAL_ERROR,
                    error_message=str(exc),
                    stage_details=[
                        "✓ Company identified" if cik else "✕ Company not identified",
                        "✕ SEC data temporarily unavailable — please retry",
                    ],
                )
                logger.info(
                    f"[EVIDENCE RESOLUTION PATH] claim_id={hash(claim.original_text)} | "
                    f"company={claim.company_name} | CIK={cik} | "
                    f"candidate_concepts={concepts} | candidate_periods={(year, period)} | "
                    f"selected_fact=None | confidence_score=0 | "
                    f"resolution_source={STATUS_RETRIEVAL_ERROR} | failure_reason={str(exc)}"
                )
                return err_result

        # All stages exhausted
        logger.debug(f"{log_prefix} → no confident match found after all stages")
        fail_result = EvidenceResolutionResult(
            resolution_status=STATUS_NO_MATCH,
            stage_details=self._build_failure_stages(
                company_ok=bool(cik),
                period_ok=True,
                metric_key=metric_key,
            ),
        )
        logger.info(
            f"[EVIDENCE RESOLUTION PATH] claim_id={hash(claim.original_text)} | "
            f"company={claim.company_name} | CIK={cik} | "
            f"candidate_concepts={concepts} | candidate_periods={(year, period)} | "
            f"selected_fact=None | confidence_score=0 | "
            f"resolution_source={STATUS_NO_MATCH} | failure_reason=No confident match across all stages"
        )
        return fail_result

    # ── Stage A / B internal search ───────────────────────────────────────────

    def _search_facts(
        self,
        facts: List[NormalizedFinancialFact],
        concepts: List[str],
        metric_key: str,
        year: int,
        period: str,
        is_instant: bool,
        stage_label: str,
        claim_company_cik: Optional[str] = None,
    ) -> EvidenceResolutionResult:
        """
        Search a list of facts for a concept match, returning the highest-
        scored candidate above MIN_CONFIDENCE_SCORE.
        """
        concepts_lower = {c.lower() for c in concepts}
        first_concepts_lower = {concepts[0].lower()} if concepts else set()

        scored: List[Tuple[int, Dict[str, int], NormalizedFinancialFact]] = []

        for fact in facts:
            fl = fact.concept.lower()
            if fl not in concepts_lower:
                continue

            # Duration / instant filter
            if not self._duration_ok(fact, period, is_instant):
                continue

            is_alias = fl not in first_concepts_lower
            score, breakdown = _score_candidate_with_breakdown(
                fact, metric_key, year, period, is_alias=is_alias, is_extension=False, claim_company_cik=claim_company_cik
            )
            if score >= MIN_CONFIDENCE_SCORE:
                scored.append((score, breakdown, fact))

        if not scored:
            return EvidenceResolutionResult()

        scored.sort(key=lambda t: (-t[0], -(t[2].filed_date or "").__len__()))
        best_score, best_breakdown, best_fact = scored[0]
        return EvidenceResolutionResult(
            fact=best_fact,
            confidence_score=best_score,
            score_breakdown=best_breakdown,
            stage_details=[
                "✓ Company identified",
                "✓ Fiscal period matched",
                f"✓ Metric matched via {stage_label}",
                "✓ Calculation performed",
            ],
        )

    # ── Stage C: Filing-level XBRL ────────────────────────────────────────────

    async def _resolve_from_filing(
        self,
        cik: int,
        metric_key: str,
        concepts: List[str],
        year: int,
        period: str,
        is_instant: bool,
        log_prefix: str,
    ) -> EvidenceResolutionResult:
        """
        Identify the best filing for the requested period via submissions, fetch/parse
        direct inline XBRL facts, and return the best match.
        """
        try:
            submissions = await self.sec_client.get_company_submissions(cik)
        except SECRetrievalError:
            raise

        target_accession = self._find_best_filing_accession(submissions, year, period)
        if not target_accession:
            logger.debug(f"{log_prefix} → Stage C: no matching filing found in submissions")
            return EvidenceResolutionResult()

        # Fetch form and filed date details
        recent_filings = submissions.get("filings", {}).get("recent", {})
        form = "10-K"
        filed_date = ""
        if "form" in recent_filings and "accessionNumber" in recent_filings:
            try:
                idx = recent_filings["accessionNumber"].index(target_accession)
                form = recent_filings["form"][idx]
                filed_date = recent_filings["filingDate"][idx]
            except Exception:
                pass

        # Retrieve and parse direct inline XBRL facts
        filing_facts = await self._fetch_and_parse_filing_xbrl_facts(cik, target_accession, form, filed_date)
        if filing_facts:
            # Cache newly retrieved facts back to companyfacts cache
            try:
                await self._update_company_facts_cache(cik, filing_facts)
            except Exception as e:
                logger.warning(f"Could not update company facts cache with parsed filing facts: {e}")

        logger.debug(
            f"{log_prefix} → Stage C: parsed {len(filing_facts)} facts "
            f"for accession {target_accession}"
        )

        if not filing_facts:
            return EvidenceResolutionResult()

        result = self._search_facts(
            filing_facts, concepts, metric_key, year, period, is_instant,
            stage_label="C (filing XBRL)",
            claim_company_cik=str(cik),
        )
        if result.fact:
            result.resolution_status = STATUS_FILING_XBRL_MATCH
        return result

    def _find_best_filing_accession(
        self, submissions: Dict[str, Any], year: int, period: str
    ) -> Optional[str]:
        """
        Walk the submissions recent filings list and pick the accession number
        for the best-matching filing (10-K for FY, 10-Q for quarterly).
        """
        filings = submissions.get("filings", {}).get("recent", {})
        if not filings:
            return None

        forms = filings.get("form", [])
        accessions = filings.get("accessionNumber", [])
        periods_of_report = filings.get("periodOfReport", [])
        filed_dates = filings.get("filingDate", [])

        preferred_form = "10-K" if period == "FY" else "10-Q"

        candidates = []
        for i, form in enumerate(forms):
            if not form:
                continue
            form_upper = form.upper()
            if form_upper not in (preferred_form, f"{preferred_form}/A"):
                continue

            por = periods_of_report[i] if i < len(periods_of_report) else ""
            accn = accessions[i] if i < len(accessions) else ""
            filed = filed_dates[i] if i < len(filed_dates) else ""

            try:
                por_dt = datetime.strptime(por, "%Y-%m-%d")
                por_year = por_dt.year
                por_month = por_dt.month
            except (ValueError, TypeError):
                continue

            if por_year != year:
                continue

            if period == "FY" and por_month not in (1, 6, 7, 8, 9, 10, 11, 12):
                continue

            amend_penalty = 1 if form_upper.endswith("/A") else 0
            candidates.append((-amend_penalty, filed, accn))

        if not candidates:
            return None

        candidates.sort(key=lambda c: (c[0], c[1]), reverse=True)
        return candidates[0][2]

    # ── Stage D: Extension concept scan ──────────────────────────────────────

    def _search_extension_concepts(
        self,
        facts: List[NormalizedFinancialFact],
        metric_key: str,
        year: int,
        period: str,
        is_instant: bool,
        log_prefix: str,
        parsed_linkbases: Optional[Dict[str, Any]] = None,
        claim_company_cik: Optional[str] = None,
    ) -> EvidenceResolutionResult:
        """
        Scan non-us-gaap facts and accept them only when all contextual
        validation criteria are met (label, unit, form, period).
        """
        scored: List[Tuple[int, Dict[str, int], NormalizedFinancialFact]] = []

        for fact in facts:
            if fact.namespace.lower() == "us-gaap":
                continue
            if not _is_valid_extension_concept(fact, metric_key, year, period, parsed_linkbases):
                continue
            if not self._duration_ok(fact, period, is_instant):
                continue

            score, breakdown = _score_candidate_with_breakdown(
                fact, metric_key, year, period, is_alias=False, is_extension=True, claim_company_cik=claim_company_cik
            )
            if score >= MIN_CONFIDENCE_SCORE + 5:
                scored.append((score, breakdown, fact))

        if not scored:
            return EvidenceResolutionResult()

        scored.sort(key=lambda t: -t[0])
        best_score, best_breakdown, best_fact = scored[0]
        logger.debug(
            f"{log_prefix} → Stage D: accepted extension concept "
            f"'{best_fact.concept}' score={best_score}"
        )
        return EvidenceResolutionResult(
            fact=best_fact,
            confidence_score=best_score,
            score_breakdown=best_breakdown,
            stage_details=[
                "✓ Company identified",
                "✓ Fiscal period matched",
                "✓ Company-specific XBRL concept validated",
                "✓ Calculation performed",
            ],
        )

    # ── Inline XBRL Direct Parsing & Caching ──────────────────────────────────

    async def _parse_filing_linkbases(self, cik: int, accession: str) -> Dict[str, Any]:
        """
        Download and parse the index.json, _pre.xml, and _cal.xml for a filing.
        """
        from app.services.cache_service import cache_service
        cache_key = f"parsed_linkbases_{cik}_{accession}"
        
        async def loader():
            try:
                index_text = await self.sec_client.get_filing_file(cik, accession, "index.json")
                import json
                index_data = json.loads(index_text)
                items = index_data.get("directory", {}).get("item", [])
            except Exception as e:
                logger.warning(f"Failed to parse index.json for CIK {cik} acc {accession}: {e}")
                items = []

            pre_file = None
            cal_file = None
            instance_file = None
            
            for item in items:
                name = item.get("name", "")
                if name.endswith("_pre.xml"):
                    pre_file = name
                elif name.endswith("_cal.xml"):
                    cal_file = name
                elif name.endswith("_htm.xml") or (name.endswith(".xml") and not name.endswith("_def.xml") and not name.endswith("_lab.xml") and not name.endswith("FilingSummary.xml")):
                    instance_file = name
            
            pre_parents = {}
            pre_concept_roles = {}
            if pre_file:
                try:
                    pre_text = await self.sec_client.get_filing_file(cik, accession, pre_file)
                    root = ET.fromstring(pre_text.encode("utf-8"))
                    loc_map = {}
                    for elem in root.iter():
                        tag_local = elem.tag.split('}')[-1]
                        if tag_local == "loc":
                            label = elem.attrib.get("{http://www.w3.org/1999/xlink}label", "")
                            href = elem.attrib.get("{http://www.w3.org/1999/xlink}href", "")
                            if label and href:
                                concept_id = href.split('#')[-1]
                                loc_map[label] = concept_id
                    
                    for link in root.findall(".//{http://www.xbrl.org/2003/linkbase}presentationLink"):
                        role = link.attrib.get("{http://www.w3.org/1999/xlink}role", "")
                        role_name = role.split('/')[-1]
                        for arc in link.findall("{http://www.xbrl.org/2003/linkbase}presentationArc"):
                            frm = arc.attrib.get("{http://www.w3.org/1999/xlink}from", "")
                            to = arc.attrib.get("{http://www.w3.org/1999/xlink}to", "")
                            frm_concept = loc_map.get(frm, frm)
                            to_concept = loc_map.get(to, to)
                            pre_parents.setdefault(to_concept, []).append((frm_concept, role_name))
                            pre_concept_roles.setdefault(to_concept, []).append(role_name)
                            pre_concept_roles.setdefault(frm_concept, []).append(role_name)
                except Exception as e:
                    logger.warning(f"Failed to parse presentation file {pre_file}: {e}")

            cal_parents = {}
            if cal_file:
                try:
                    cal_text = await self.sec_client.get_filing_file(cik, accession, cal_file)
                    root = ET.fromstring(cal_text.encode("utf-8"))
                    loc_map = {}
                    for elem in root.iter():
                        tag_local = elem.tag.split('}')[-1]
                        if tag_local == "loc":
                            label = elem.attrib.get("{http://www.w3.org/1999/xlink}label", "")
                            href = elem.attrib.get("{http://www.w3.org/1999/xlink}href", "")
                            if label and href:
                                concept_id = href.split('#')[-1]
                                loc_map[label] = concept_id
                                
                    for link in root.findall(".//{http://www.xbrl.org/2003/linkbase}calculationLink"):
                        role = link.attrib.get("{http://www.w3.org/1999/xlink}role", "")
                        role_name = role.split('/')[-1]
                        for arc in link.findall("{http://www.xbrl.org/2003/linkbase}calculationArc"):
                            frm = arc.attrib.get("{http://www.w3.org/1999/xlink}from", "")
                            to = arc.attrib.get("{http://www.w3.org/1999/xlink}to", "")
                            weight = float(arc.attrib.get("weight", "1.0"))
                            frm_concept = loc_map.get(frm, frm)
                            to_concept = loc_map.get(to, to)
                            cal_parents.setdefault(to_concept, []).append((frm_concept, weight, role_name))
                except Exception as e:
                    logger.warning(f"Failed to parse calculation file {cal_file}: {e}")

            return {
                "presentation": {
                    "parents": pre_parents,
                    "concept_roles": pre_concept_roles
                },
                "calculation": {
                    "parents": cal_parents
                },
                "instance_file": instance_file
            }
            
        return await cache_service.get_or_set(cache_key, 86400, loader)

    async def _fetch_and_parse_filing_xbrl_facts(
        self, cik: int, accession: str, form: str, filed_date: str
    ) -> List[NormalizedFinancialFact]:
        """
        Fetch the filing's index.json, find the XBRL instance document,
        parse it and extract all facts.
        """
        linkbase_data = await self._parse_filing_linkbases(cik, accession)
        instance_file = linkbase_data.get("instance_file")
        if not instance_file:
            logger.warning(f"No XBRL instance xml file found for CIK {cik} acc {accession}")
            return []
            
        try:
            xml_text = await self.sec_client.get_filing_file(cik, accession, instance_file)
        except Exception as e:
            logger.error(f"Failed to fetch XBRL instance file {instance_file} for CIK {cik} acc {accession}: {e}")
            return []
            
        try:
            root = ET.fromstring(xml_text.encode("utf-8"))
        except Exception as e:
            logger.error(f"Failed to parse XML for XBRL instance {instance_file}: {e}")
            return []
            
        contexts = {}
        for elem in root.findall(".//{http://www.xbrl.org/2003/instance}context"):
            ctx_id = elem.attrib.get("id")
            if not ctx_id:
                continue
                
            period_elem = elem.find("{http://www.xbrl.org/2003/instance}period")
            if period_elem is None:
                continue
                
            start_date = None
            end_date = None
            
            start_elem = period_elem.find("{http://www.xbrl.org/2003/instance}startDate")
            end_elem = period_elem.find("{http://www.xbrl.org/2003/instance}endDate")
            if start_elem is not None and end_elem is not None:
                start_date = start_elem.text.strip() if start_elem.text else None
                end_date = end_elem.text.strip() if end_elem.text else None
            else:
                inst_elem = period_elem.find("{http://www.xbrl.org/2003/instance}instant")
                if inst_elem is not None:
                    end_date = inst_elem.text.strip() if inst_elem.text else None
                    
            if end_date:
                contexts[ctx_id] = {
                    "start_date": start_date,
                    "end_date": end_date
                }
                
        units = {}
        for elem in root.findall(".//{http://www.xbrl.org/2003/instance}unit"):
            unit_id = elem.attrib.get("id")
            if not unit_id:
                continue
            meas_elem = elem.find(".//{http://www.xbrl.org/2003/instance}measure")
            if meas_elem is not None and meas_elem.text:
                units[unit_id] = meas_elem.text.strip().split(":")[-1]
            else:
                units[unit_id] = "USD"
                
        facts = []
        unpadded_cik = str(int(cik))
        accn_no_dashes = accession.replace("-", "")
        
        for elem in root.iter():
            ctx_ref = elem.attrib.get("contextRef")
            if not ctx_ref or ctx_ref not in contexts:
                continue
                
            tag = elem.tag
            ns = "us-gaap"
            concept = tag
            if tag.startswith("{"):
                ns_url, concept = tag[1:].split("}", 1)
                if "fasb.org/us-gaap" in ns_url:
                    ns = "us-gaap"
                elif "sec.gov/dei" in ns_url:
                    ns = "dei"
                elif "fasb.org/srt" in ns_url:
                    ns = "srt"
                else:
                    ns = ns_url.split("/")[-1].replace("-", "_")
                    
            if not elem.text:
                continue
            try:
                val = float(elem.text.strip())
            except ValueError:
                continue
                
            ctx = contexts[ctx_ref]
            unit_ref = elem.attrib.get("unitRef", "")
            unit_name = units.get(unit_ref, unit_ref or "USD")
            
            fy = None
            fp = None
            try:
                dt = datetime.strptime(ctx["end_date"], "%Y-%m-%d")
                fy = dt.year
                if ctx["start_date"]:
                    s_dt = datetime.strptime(ctx["start_date"], "%Y-%m-%d")
                    days = (dt - s_dt).days
                    if 330 <= days <= 400:
                        fp = "FY"
                    elif 60 <= days <= 120:
                        month = dt.month
                        if month in (3, 4, 5):
                            fp = "Q1"
                        elif month in (6, 7, 8):
                            fp = "Q2"
                        elif month in (9, 10, 11):
                            fp = "Q3"
                        else:
                            fp = "Q4"
                else:
                    fp = "FY"
            except Exception:
                pass
                
            source_url = f"https://www.sec.gov/Archives/edgar/data/{unpadded_cik}/{accn_no_dashes}/"
            
            fact = NormalizedFinancialFact(
                namespace=ns,
                concept=concept,
                label=concept,
                description=None,
                unit=unit_name,
                value=val,
                start_date=ctx["start_date"],
                end_date=ctx["end_date"],
                filed_date=filed_date,
                form=form,
                fiscal_year=fy,
                fiscal_period=fp,
                accession_number=accession,
                source_url=source_url
            )
            facts.append(fact)
            
        logger.info(f"Parsed {len(facts)} facts directly from inline XBRL XML {instance_file}")
        return facts

    async def _update_company_facts_cache(self, cik: int, new_facts: List[NormalizedFinancialFact]) -> None:
        """
        Integrate parsed direct filing facts into the global companyfacts cache.
        """
        from app.services.cache_service import cache_service
        key = f"sec_companyfacts_{cik}"
        
        cache_data = cache_service.get_sync(key)
        if cache_data is None:
            cache_data = {
                "cik": cik,
                "entityName": "",
                "facts": {}
            }
            
        raw_facts = cache_data.setdefault("facts", {})
        for fact in new_facts:
            ns_data = raw_facts.setdefault(fact.namespace, {})
            concept_data = ns_data.setdefault(fact.concept, {"units": {}})
            if "label" not in concept_data and fact.label:
                concept_data["label"] = fact.label
            units_dict = concept_data.setdefault("units", {})
            unit_list = units_dict.setdefault(fact.unit, [])
            
            exists = any(
                x.get("end") == fact.end_date and
                x.get("start") == fact.start_date and
                x.get("form") == fact.form and
                x.get("accn") == fact.accession_number
                for x in unit_list
            )
            if not exists:
                unit_list.append({
                    "val": fact.value,
                    "end": fact.end_date,
                    "start": fact.start_date,
                    "form": fact.form,
                    "accn": fact.accession_number,
                    "fy": fact.fiscal_year,
                    "fp": fact.fiscal_period
                })
                
        cache_service.set_sync(key, cache_data, 1800)

    # ── Utility helpers ───────────────────────────────────────────────────────

    @staticmethod
    def _duration_ok(fact: NormalizedFinancialFact, period: str, is_instant: bool) -> bool:
        """Return True if the fact's instant/duration characteristics are appropriate."""
        if is_instant:
            return fact.start_date is None
        if fact.start_date is None:
            return False
        try:
            start_dt = datetime.strptime(fact.start_date, "%Y-%m-%d")
            end_dt = datetime.strptime(fact.end_date, "%Y-%m-%d")
            days = (end_dt - start_dt).days
        except (ValueError, TypeError):
            return True

        if period == "FY":
            return 280 <= days <= 400
        else:
            return 60 <= days <= 140

    @staticmethod
    def _build_failure_stages(
        company_ok: bool, period_ok: bool, metric_key: str
    ) -> List[str]:
        return [
            "✓ Company identified" if company_ok else "✕ Company could not be matched to an SEC registrant",
            "✓ Fiscal period matched" if period_ok else "✕ Reporting period could not be resolved",
            f"✕ Metric '{metric_key}' could not be mapped confidently to a disclosed concept",
            "— Calculation not performed",
        ]
