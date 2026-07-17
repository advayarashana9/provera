import logging
from typing import Optional, Dict, List

from app.models.claim_audit import (
    ExtractedClaim,
    ClaimAuditResult,
    DocumentAuditResponse,
)
from app.models.financial_fact import CompanyFactsResponse
from app.services.claim_extraction_service import ClaimExtractionService
from app.services.claim_resolution_service import ClaimResolutionService
from app.services.claim_verification_service import ClaimVerificationService, parse_period, normalize_metric
from app.services.evidence_resolver import (
    EvidenceResolver,
    STATUS_RETRIEVAL_ERROR,
    STATUS_NO_MATCH,
)
from app.services.fact_normalizer import FactNormalizerService
from app.services.sec_client import SECRetrievalError

logger = logging.getLogger(__name__)


class DocumentAuditService:
    def __init__(
        self,
        extraction_service: Optional[ClaimExtractionService] = None,
        resolution_service: Optional[ClaimResolutionService] = None,
        verification_service: Optional[ClaimVerificationService] = None,
        fact_normalizer: Optional[FactNormalizerService] = None,
        evidence_resolver: Optional[EvidenceResolver] = None,
    ):
        self.extraction_service = extraction_service or ClaimExtractionService()
        self.resolution_service = resolution_service or ClaimResolutionService()
        self.verification_service = verification_service or ClaimVerificationService()
        self.fact_normalizer = fact_normalizer or FactNormalizerService()
        self.evidence_resolver = evidence_resolver or EvidenceResolver()

    async def verify_single_claim(self, claim: ExtractedClaim, default_cik: Optional[str] = None) -> ClaimAuditResult:
        """
        Verify a single extracted claim: resolve CIK → load facts → verify.
        """
        # Resolve CIK
        cik_str = claim.cik or default_cik
        cik_val = None
        if cik_str:
            try:
                cik_val = int(cik_str)
            except ValueError:
                pass

        if not cik_val:
            cik_val = await self.resolution_service.resolve_cik(claim.ticker, claim.company_name)

        facts_res = None
        if cik_val:
            try:
                # Load facts for the resolved CIK
                facts_res = await self.fact_normalizer.get_company_facts(cik_val, forms=["10-K", "10-Q"])
                # Update claim with resolved info for clarity
                claim.cik = str(cik_val)
                if not claim.company_name and facts_res.company_name:
                    claim.company_name = facts_res.company_name
            except Exception as e:
                logger.error(f"Error fetching company facts for resolved CIK {cik_val}: {e}")

        # Run verification check
        result = self.verification_service.verify_claim(claim, facts_res)
        return result

    async def audit_document(self, text: str, default_cik: Optional[str] = None) -> DocumentAuditResponse:
        """
        Perform a full document audit: extract claims → resolve companies → verify → summarize.

        Evidence resolution order per claim:
          A. Pre-cached / already-fetched companyfacts
          B. Fresh SEC EDGAR companyfacts fetch
          C. Filing-level XBRL fallback
          D. Extension concept scan
          → Only falls back to insufficient_evidence after all stages fail.
          → retrieval_error is treated separately from insufficient_evidence.
        """
        # 1. Extract claims using Gemini
        logger.info("Extracting claims from document...")
        extracted_claims = await self.extraction_service.extract_claims(text)
        logger.info(f"Extracted {len(extracted_claims)} claims.")

        results: List[ClaimAuditResult] = []

        # Local facts cache to prevent duplicate fetches in a single audit run
        facts_cache: Dict[int, CompanyFactsResponse] = {}

        # 2. Verify each claim
        for claim in extracted_claims:
            # Resolve CIK
            cik_str = claim.cik or default_cik
            cik_val = None
            if cik_str:
                try:
                    cik_val = int(cik_str)
                except ValueError:
                    pass

            if not cik_val:
                cik_val = await self.resolution_service.resolve_cik(claim.ticker, claim.company_name)

            facts_res: Optional[CompanyFactsResponse] = None
            retrieval_failed = False

            if cik_val:
                if cik_val in facts_cache:
                    facts_res = facts_cache[cik_val]
                else:
                    try:
                        facts_res = await self.fact_normalizer.get_company_facts(cik_val, forms=["10-K", "10-Q"])
                        facts_cache[cik_val] = facts_res
                    except SECRetrievalError as exc:
                        logger.warning(f"SEC retrieval error for CIK {cik_val}: {exc}")
                        retrieval_failed = True
                    except Exception as e:
                        logger.error(f"Error loading company facts for CIK {cik_val}: {e}")

                if facts_res:
                    claim.cik = str(cik_val)
                    if not claim.company_name and facts_res.company_name:
                        claim.company_name = facts_res.company_name

            # Check if this is an opinion / forward-looking claim — skip evidence resolution
            if claim.claim_type in ("opinion", "forward_looking"):
                audit_res = self.verification_service.verify_claim(claim, facts_res)
                results.append(audit_res)
                continue

            # SEC retrieval failure — return distinct status, NOT insufficient_evidence
            if retrieval_failed:
                audit_res = ClaimAuditResult(
                    claim=claim,
                    verdict="requires_human_review",
                    confidence="low",
                    short_explanation="SEC data temporarily unavailable. Please retry.",
                    evidence=[],
                    calculations=[],
                    limitations=["A temporary SEC network error prevented evidence retrieval. This is not a verification result."],
                    evidence_resolution_status=STATUS_RETRIEVAL_ERROR,
                    resolution_stage_details=[
                        "✓ Company identified" if cik_val else "✕ Company not identified",
                        "✕ SEC data temporarily unavailable — please retry",
                    ],
                )
                results.append(audit_res)
                continue

            # Try the multi-stage evidence resolver BEFORE falling through to
            # the synchronous claim_verification_service path.
            resolved_fact = None
            resolved_prior_fact = None
            target_resolution = None

            if cik_val and claim.metric and claim.end_period:
                try:
                    year, period = parse_period(claim.end_period)
                    metric_key = normalize_metric(claim.metric)

                    if year is not None and period is not None:
                        target_resolution = await self.evidence_resolver.resolve(
                            claim=claim,
                            cached_facts=facts_res,
                            metric_key=metric_key,
                            year=year,
                            period=period,
                        )
                        resolved_fact = target_resolution.fact

                        # If Stage B/C/D found data, re-fetch facts_res so we have enriched set
                        if target_resolution.resolution_status in (
                            "live_companyfacts_match",
                            "filing_xbrl_match",
                            "extension_concept_match",
                        ):
                            try:
                                fresh = await self.fact_normalizer.get_company_facts(
                                    cik_val, forms=["10-K", "10-Q"]
                                )
                                facts_cache[cik_val] = fresh
                                facts_res = fresh
                            except Exception as e:
                                logger.warning(f"Could not refresh facts after live resolution: {e}")

                        # Also resolve prior period if comparative YoY/QoQ
                        if claim.comparison_type in ("YoY", "QoQ"):
                            if claim.comparison_type == "YoY":
                                p_year = year - 1
                                p_period = period
                            else:
                                if period == "Q4":
                                    p_year, p_period = year, "Q3"
                                elif period == "Q3":
                                    p_year, p_period = year, "Q2"
                                elif period == "Q2":
                                    p_year, p_period = year, "Q1"
                                else:
                                    p_year, p_period = year - 1, "Q4"

                            prior_resolution = await self.evidence_resolver.resolve(
                                claim=claim,
                                cached_facts=facts_res,
                                metric_key=metric_key,
                                year=p_year,
                                period=p_period,
                            )
                            resolved_prior_fact = prior_resolution.fact

                        if target_resolution.resolution_status == STATUS_RETRIEVAL_ERROR:
                            audit_res = ClaimAuditResult(
                                claim=claim,
                                verdict="requires_human_review",
                                confidence="low",
                                short_explanation="SEC data temporarily unavailable. Please retry.",
                                evidence=[],
                                calculations=[],
                                limitations=["A temporary SEC network error prevented evidence retrieval."],
                                evidence_resolution_status=STATUS_RETRIEVAL_ERROR,
                                resolution_stage_details=target_resolution.stage_details,
                            )
                            results.append(audit_res)
                            continue

                except Exception as exc:
                    logger.warning(f"Evidence resolver error for claim '{claim.original_text[:60]}': {exc}")

            # Verify using claim_verification_service
            audit_res = self.verification_service.verify_claim(
                claim, facts_res, resolved_fact=resolved_fact, resolved_prior_fact=resolved_prior_fact
            )

            # Propagate resolution stage details, status, and score breakdown
            if target_resolution:
                audit_res.resolution_stage_details = target_resolution.stage_details
                audit_res.evidence_resolution_status = target_resolution.resolution_status
                audit_res.score_breakdown = target_resolution.score_breakdown
            elif cik_val and claim.metric and claim.end_period and not audit_res.resolution_stage_details:
                if audit_res.verdict in ("supported", "contradicted", "partially_supported"):
                    audit_res.resolution_stage_details = [
                        "✓ Company identified",
                        "✓ Fiscal period matched",
                        "✓ Filing located",
                        "✓ Metric matched confidently",
                        "✓ Calculation performed",
                    ]
                    if not audit_res.evidence_resolution_status:
                        audit_res.evidence_resolution_status = "cache_match"

            results.append(audit_res)

        # 3. Build summary counts
        summary = {
            "total": len(results),
            "supported": 0,
            "contradicted": 0,
            "partially_supported": 0,
            "outdated": 0,
            "insufficient_evidence": 0,
            "opinion": 0,
            "forward_looking": 0,
            "requires_human_review": 0,
        }
        for r in results:
            # First map the factual/primary verdict
            if r.verdict in summary:
                summary[r.verdict] += 1
            else:
                summary["requires_human_review"] += 1
            # Separately track outdatedness count
            if r.is_outdated:
                summary["outdated"] += 1

        return DocumentAuditResponse(
            claims=results,
            summary=summary,
        )
