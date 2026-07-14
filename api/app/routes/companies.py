from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
import httpx
import asyncio
import time
import logging
from app.services.sec_client import SECClient
from app.services.company_search import CompanySearchService
from app.services.company_profile import CompanyProfileService
from app.services.fact_normalizer import FactNormalizerService
from app.services.verification_engine import VerificationEngine
from app.models.company import CompanyOverview, RecentFilingsResponse
from app.models.financial_fact import CompanyFactsResponse, ConceptFactsResponse, NormalizedFinancialFact
from app.models.verification import VerificationSummary, VerificationFinding
from app.services.explanation_service import GeminiExplanation
from app.models.research_report import AIResearchReport, ResearchReportRequest
from app.services.cache_service import cache_service

logger = logging.getLogger(__name__)


router = APIRouter()
sec_client = SECClient()
search_service = CompanySearchService(sec_client=sec_client)
profile_service = CompanyProfileService(sec_client=sec_client)
fact_service = FactNormalizerService(sec_client=sec_client)
verification_engine = VerificationEngine(sec_client=sec_client)

@router.get("/search")
async def search(q: str, limit: int = Query(default=10, ge=1, le=25)):
    """
    Search companies by ticker or name.
    """
    if not q or not q.strip():
        raise HTTPException(status_code=400, detail="Query cannot be blank")
    async def _fetch():
        return await search_service.search(q, limit)
    try:
        results = await cache_service.get_or_set(f"search_{q}_{limit}", 86400, _fetch)
        return {
            "query": q,
            "results": results
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=f"SEC API error: {exc.response.text}"
        )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Connection error to SEC API: {str(exc)}"
        )

@router.get("/{cik}/overview", response_model=CompanyOverview)
async def get_overview(cik: int):
    """
    Get normalized company overview details for a given CIK.
    """
    async def _fetch():
        return await profile_service.get_overview(cik)
    try:
        return await cache_service.get_or_set(f"overview_{cik}", 1800, _fetch)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=f"SEC API error: {exc.response.text}"
        )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Connection error to SEC API: {str(exc)}"
        )

@router.get("/{cik}/filings", response_model=RecentFilingsResponse)
async def get_recent_filings(
    cik: int,
    forms: Optional[str] = Query(default=None, description="Comma-separated list of form types to filter, e.g. 10-K,10-Q"),
    limit: int = Query(default=20, ge=1, le=100)
):
    """
    Get recent filings for a company, with optional form filtering and limit capping.
    """
    form_list = [f.strip() for f in forms.split(",")] if forms else None
    async def _fetch():
        return await profile_service.get_recent_filings(cik, forms=form_list, limit=limit)
    try:
        key = f"filings_{cik}_{forms}_{limit}"
        return await cache_service.get_or_set(key, 900, _fetch)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=f"SEC API error: {exc.response.text}"
        )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Connection error to SEC API: {str(exc)}"
        )

@router.get("/{cik}/normalized-facts", response_model=CompanyFactsResponse)
async def get_normalized_facts(
    cik: int,
    forms: Optional[str] = Query(default=None, description="Comma-separated list of form types, e.g. 10-K,10-Q"),
    units: Optional[str] = Query(default=None, description="Comma-separated list of unit types, e.g. USD,shares"),
    concepts: Optional[str] = Query(default=None, description="Comma-separated list of concept names, e.g. AccountsPayableCurrent"),
    limit: int = Query(default=1000, ge=1, le=5000)
):
    """
    Get normalized and filtered financial facts for a given company.
    """
    form_list = [f.strip() for f in forms.split(",")] if forms else None
    unit_list = [u.strip() for u in units.split(",")] if units else None
    concept_list = [c.strip() for c in concepts.split(",")] if concepts else None
    async def _fetch():
        return await fact_service.get_company_facts(
            cik, forms=form_list, units=unit_list, concepts=concept_list, limit=limit
        )
    try:
        key = f"norm_facts_{cik}_{forms}_{units}_{concepts}_{limit}"
        return await cache_service.get_or_set(key, 1800, _fetch)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=f"SEC API error: {exc.response.text}"
        )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Connection error to SEC API: {str(exc)}"
        )

@router.get("/{cik}/concepts/{namespace}/{concept}", response_model=ConceptFactsResponse)
async def get_concept_facts(
    cik: int,
    namespace: str,
    concept: str,
    forms: Optional[str] = Query(default=None, description="Comma-separated list of form types, e.g. 10-K,10-Q"),
    limit: int = Query(default=500, ge=1, le=5000)
):
    """
    Get normalized and filtered facts for a specific namespace and concept.
    """
    form_list = [f.strip() for f in forms.split(",")] if forms else None
    async def _fetch():
        return await fact_service.get_concept_facts(
            cik, namespace=namespace, concept=concept, forms=form_list, limit=limit
        )
    try:
        key = f"concept_facts_{cik}_{namespace}_{concept}_{forms}_{limit}"
        return await cache_service.get_or_set(key, 1800, _fetch)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=f"SEC API error: {exc.response.text}"
        )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Connection error to SEC API: {str(exc)}"
        )

@router.get("/{cik}/verify", response_model=VerificationSummary)
async def verify_company(
    cik: int,
    forms: Optional[str] = Query(default=None, description="Comma-separated list of form types to verify, e.g. 10-K,10-Q"),
    limit_periods: int = Query(default=8, ge=1, le=20)
):
    """
    Run deterministic financial verification checks on a company's SEC facts.
    """
    form_list = [f.strip() for f in forms.split(",")] if forms else ["10-K", "10-Q"]
    async def _fetch():
        return await verification_engine.verify_company(
            cik, forms=form_list, limit_periods=limit_periods
        )
    try:
        key = f"verify_{cik}_{forms}_{limit_periods}"
        return await cache_service.get_or_set(key, 1800, _fetch)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=f"SEC API error: {exc.response.text}"
        )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Connection error to SEC API: {str(exc)}"
        )

@router.post("/{cik}/findings/explain", response_model=GeminiExplanation)
async def explain_finding(cik: int, finding: VerificationFinding):
    """
    Generate Gemini explanations for a specific VerificationFinding.
    """
    from app.services.explanation_service import (
        ExplanationService,
        GeminiExplanation,
        GeminiUnavailableError,
        GeminiRateLimitError,
        GeminiAPIError
    )

    # Reject findings with no evidence using HTTP 400
    if not finding.evidence or len(finding.evidence) == 0:
        raise HTTPException(
            status_code=400,
            detail="Finding must contain at least one evidence fact."
        )

    try:
        explanation_service = ExplanationService()
        result = await explanation_service.generate_explanation(finding)
        return result
    except GeminiUnavailableError as e:
        raise HTTPException(
            status_code=503,
            detail="Gemini service is unavailable or not configured."
        ) from e
    except GeminiRateLimitError as e:
        raise HTTPException(
            status_code=429,
            detail="Gemini API rate limit exceeded."
        ) from e
    except GeminiAPIError as e:
        raise HTTPException(
            status_code=502,
            detail="Gemini API returned an error."
        ) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Failed to generate Gemini explanation."
        ) from e

@router.get("/{cik}/submissions")
async def get_submissions(cik: int):
    """
    Get SEC company submissions for a given CIK.
    """
    try:
        return await sec_client.get_company_submissions(cik)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=f"SEC API error: {exc.response.text}"
        )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Connection error to SEC API: {str(exc)}"
        )

@router.get("/{cik}/facts")
async def get_facts(cik: int):
    """
    Get SEC company facts for a given CIK.
    """
    try:
        return await sec_client.get_company_facts(cik)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=f"SEC API error: {exc.response.text}"
        )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Connection error to SEC API: {str(exc)}"
        )

from app.models.chat import ChatRequest, ChatResponse

@router.post("/{cik}/ask", response_model=ChatResponse)
async def ask_company_question(cik: int, payload: ChatRequest):
    """
    Answer user queries using the company's SEC filing facts, powered by Gemini.
    """
    from app.services.chat_service import ChatService

    if not payload.question or not payload.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    try:
        chat_service = ChatService()
        result = await chat_service.ask_question(cik, payload.question)
        return result
    except Exception as e:
        logger.exception("Error in ask_company_question route:")
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred while processing your question: {str(e)}"
        )

from app.models.diff import FilingDiffRequest, FilingDiffResponse

@router.post("/{cik}/filing-diff", response_model=FilingDiffResponse)
async def compare_company_filings(cik: int, payload: FilingDiffRequest):
    """
    Compare two filings for a given company, calculating metric changes and diffing sections.
    """
    from app.services.diff_service import FilingDiffService

    async def _fetch():
        diff_service = FilingDiffService()
        return await diff_service.compare_filings(cik, payload)
    try:
        key = f"diff_{cik}_{payload.older_accession_number}_{payload.newer_accession_number}"
        return await cache_service.get_or_set(key, 1800, _fetch)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error in compare_company_filings route:")
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred while comparing filings: {str(e)}"
        )


from app.models.dashboard import FinancialDashboardResponse, PeerComparisonResponse

@router.get("/{cik}/dashboard", response_model=FinancialDashboardResponse)
async def get_financial_dashboard(
    cik: int,
    forms: Optional[str] = Query(default=None, description="Comma-separated list of form types to filter, e.g. 10-K,10-Q"),
    periods: int = Query(default=8, ge=4, le=20)
):
    """
    Get the financial dashboard for a company, containing core KPIs, margins/ratios, and trends.
    """
    from app.services.dashboard_service import FinancialDashboardService

    form_list = [f.strip() for f in forms.split(",")] if forms else ["10-K", "10-Q"]
    async def _fetch():
        service = FinancialDashboardService(sec_client=sec_client)
        result = await service.get_dashboard(cik, forms=form_list, periods=periods)
        try:
            overview = await profile_service.get_overview(cik)
            result.ticker = overview.tickers[0] if overview.tickers else None
        except Exception:
            pass
        return result
    try:
        key = f"dash_{cik}_{forms}_{periods}"
        return await cache_service.get_or_set(key, 1800, _fetch)
    except HTTPException:
        raise
    except Exception as e:
        import logging
        logging.getLogger(__name__).exception("Error in get_financial_dashboard route:")
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred while generating the dashboard: {str(e)}"
        )


@router.post("/{cik}/research-report", response_model=AIResearchReport)
async def generate_research_report(cik: int, payload: ResearchReportRequest):
    """
    Generate an AI research report for the company based on SEC filings and dashboard KPIs.
    """
    from app.services.research_report_service import AIResearchReportService
    from app.services.dashboard_service import FinancialDashboardService
    from app.services.diff_service import FilingDiffService
    import logging
    logger = logging.getLogger(__name__)

    try:
        dashboard_service = FinancialDashboardService(sec_client=sec_client)
        diff_service = FilingDiffService(sec_client=sec_client)
        report_service = AIResearchReportService(
            profile_service=profile_service,
            dashboard_service=dashboard_service,
            diff_service=diff_service,
            fact_normalizer=fact_service
        )
        return await report_service.generate_report(cik, periods=payload.periods)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error in generate_research_report route:")
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred while generating the research report: {str(e)}"
        )


@router.post("/{cik}/research-report/pdf")
async def generate_research_report_pdf(cik: int, report: AIResearchReport):
    """
    Generate and stream a polished PDF from a research report.
    """
    from app.services.pdf_service import PDFService
    from fastapi.responses import StreamingResponse
    from io import BytesIO
    from datetime import datetime
    import logging
    logger = logging.getLogger(__name__)

    try:
        overview = await profile_service.get_overview(cik)
        company_name = overview.name
        ticker = overview.tickers[0] if overview.tickers else str(cik)
        date_str = datetime.now().strftime("%B %d, %Y")
        
        pdf_bytes = PDFService.generate_report_pdf(report, company_name, ticker, date_str)
        
        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={ticker}_AI_Research_Report.pdf"}
        )
    except Exception as e:
        logger.exception("Error in generate_research_report_pdf route:")
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred while generating the PDF: {str(e)}"
        )


@router.get("/{cik}/peer-comparison", response_model=PeerComparisonResponse)
async def get_peer_comparison(
    cik: int,
    peers: Optional[str] = Query(default=None, description="Comma-separated list of peer CIKs to compare"),
    periods: int = Query(default=8, ge=4, le=20)
):
    """
    Get financial dashboard metrics for the base company and all compared peer companies.
    """
    from app.services.dashboard_service import FinancialDashboardService
    import logging
    logger = logging.getLogger(__name__)

    async def _fetch_peer_comparison():
        dashboard_service = FinancialDashboardService(sec_client=sec_client)
        
        # 1. Fetch base company dashboard
        base_dashboard = await dashboard_service.get_dashboard(cik, periods=periods)
        try:
            overview = await profile_service.get_overview(cik)
            base_dashboard.ticker = overview.tickers[0] if overview.tickers else None
        except Exception:
            pass

        companies = [base_dashboard]

        # 2. Fetch peer companies dashboards in parallel safely
        if peers:
            peer_ciks = [int(p.strip()) for p in peers.split(",") if p.strip()]
            sem = asyncio.Semaphore(2)

            async def _fetch_peer(p_cik: int):
                async with sem:
                    try:
                        peer_dash = await dashboard_service.get_dashboard(p_cik, periods=periods)
                        try:
                            p_overview = await profile_service.get_overview(p_cik)
                            peer_dash.ticker = p_overview.tickers[0] if p_overview.tickers else None
                        except Exception:
                            pass
                        return peer_dash
                    except Exception as ex:
                        logger.warning(f"Failed to fetch peer CIK {p_cik} for comparison: {ex}")
                        return None

            tasks = [_fetch_peer(p_cik) for p_cik in peer_ciks[:3]]
            results = await asyncio.gather(*tasks)
            for res in results:
                if res is not None:
                    companies.append(res)

        return PeerComparisonResponse(
            base_cik=cik,
            companies=companies
        )

    try:
        key = f"peer_comp_{cik}_{peers}_{periods}"
        start_time = time.time()
        res = await cache_service.get_or_set(key, 1800, _fetch_peer_comparison)
        duration = time.time() - start_time
        logger.info(f"[TIMING] Peer-comparison for CIK {cik} took {duration:.4f}s")
        return res
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error in get_peer_comparison route:")
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred while generating peer comparison: {str(e)}"
        )


from app.models.investment_memo import InvestmentMemo, InvestmentMemoRequest

@router.post("/{cik}/investment-memo", response_model=InvestmentMemo)
async def generate_investment_memo(
    cik: int,
    request: InvestmentMemoRequest
):
    """
    Generate an institutional Investment Memo using verified financial facts and peer comparisons.
    """
    from app.services.investment_memo_service import InvestmentMemoService
    from app.services.dashboard_service import FinancialDashboardService
    from app.services.diff_service import FilingDiffService
    from app.services.fact_normalizer import FactNormalizerService
    import logging
    logger = logging.getLogger(__name__)

    try:
        dashboard_service = FinancialDashboardService(sec_client=sec_client)
        diff_service = FilingDiffService(sec_client=sec_client)
        fact_normalizer = FactNormalizerService()
        
        memo_service = InvestmentMemoService(
            profile_service=profile_service,
            dashboard_service=dashboard_service,
            diff_service=diff_service,
            fact_normalizer=fact_normalizer
        )
        
        return await memo_service.generate_memo(
            cik=cik,
            peers=request.peers,
            periods=request.periods
        )
    except Exception as e:
        logger.exception("Error in generate_investment_memo route:")
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred while generating investment memo: {str(e)}"
        )


@router.post("/{cik}/investment-memo/pdf")
async def generate_investment_memo_pdf(
    cik: int,
    memo: InvestmentMemo
):
    """
    Generate a formatted PDF for the given Investment Memo.
    """
    from app.services.pdf_service import PDFService
    from fastapi.responses import StreamingResponse
    from io import BytesIO
    from datetime import datetime
    import logging
    logger = logging.getLogger(__name__)

    try:
        overview = await profile_service.get_overview(cik)
        ticker = overview.tickers[0] if overview.tickers else str(cik)
        date_str = datetime.now().strftime("%Y-%m-%d")

        pdf_bytes = PDFService.generate_memo_pdf(
            memo=memo,
            company_name=overview.name,
            ticker=ticker,
            date_str=date_str
        )

        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={ticker}_Investment_Memo.pdf"}
        )
    except Exception as e:
        logger.exception("Error in generate_investment_memo_pdf route:")
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred while generating PDF: {str(e)}"
        )




