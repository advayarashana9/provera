import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
from app.main import app
from app.models.company import CompanyOverview, RecentFilingsResponse, FilingSummary
from app.models.investment_memo import InvestmentMemo, InvestmentMemoRequest
from app.models.research_report import ConfidenceIndicator
from app.services.investment_memo_service import InvestmentMemoService

client = TestClient(app)

MOCK_OVERVIEW = CompanyOverview(
    cik=320193,
    name="Apple Inc.",
    tickers=["AAPL"],
    exchanges=["NASDAQ"],
    sic="3571",
    sic_description="Computers"
)

@pytest.fixture
def mock_dependencies():
    profile = MagicMock()
    profile.get_overview = AsyncMock(return_value=MOCK_OVERVIEW)
    profile.get_recent_filings = AsyncMock(return_value=RecentFilingsResponse(
        cik=320193,
        company_name="Apple Inc.",
        count=0,
        filings=[]
    ))

    dashboard_res = MagicMock()
    dashboard_res.cik = 320193
    dashboard_res.company_name = "Apple Inc."
    dashboard_res.latest_period_end = "2026-03-28"
    dashboard_res.latest_form = "10-Q"
    dashboard_res.metrics = []
    dashboard_res.ratios = []
    
    dashboard = MagicMock()
    dashboard.get_dashboard = AsyncMock(return_value=dashboard_res)

    diff = MagicMock()
    normalizer = MagicMock()

    return profile, dashboard, diff, normalizer

@pytest.mark.asyncio
async def test_investment_memo_service_fallback(mock_dependencies):
    profile, dashboard, diff, normalizer = mock_dependencies
    
    # Initialize service with API Key None so it uses fallback
    service = InvestmentMemoService(
        profile_service=profile,
        dashboard_service=dashboard,
        diff_service=diff,
        fact_normalizer=normalizer,
        api_key=""
    )
    
    assert not service.is_available()
    
    memo = await service.generate_memo(cik=320193, peers=[789019])
    
    assert isinstance(memo, InvestmentMemo)
    assert "Apple Inc." in memo.executive_summary.content
    assert "Business Overview" in memo.business_overview.title
    assert "Financial Strength" in memo.financial_strength.title


def test_investment_memo_endpoints(monkeypatch):
    mock_memo = InvestmentMemo(
        title="Investment Memo: Apple Inc.",
        confidence=ConfidenceIndicator(
            data_coverage="100% data coverage",
            confidence_level="High",
            missing_information="None"
        ),
        executive_summary={"title": "Summary", "content": "Apple is a strong company.", "citations": []},
        business_overview={"title": "Business", "content": "Consumer electronics.", "citations": []},
        financial_strength={"title": "Strength", "content": "High reserves.", "citations": []},
        growth_drivers={"title": "Drivers", "content": "Filing evidence.", "citations": []},
        key_risks={"title": "Risks", "content": "Item 1A review.", "citations": []},
        filing_changes={"title": "Diff", "content": "No major changes.", "citations": []},
        competitive_position={"title": "Peers", "content": "Benchmark details.", "citations": []},
        overall_assessment={"title": "Assessment", "content": "Strong balance sheet.", "citations": []},
        citations=[]
    )

    with patch("app.services.company_profile.CompanyProfileService.get_overview", AsyncMock(return_value=MOCK_OVERVIEW)), \
         patch("app.services.investment_memo_service.InvestmentMemoService.generate_memo", AsyncMock(return_value=mock_memo)):
        
        # 1. Post generate memo
        res = client.post("/companies/320193/investment-memo", json={"peers": [789019], "periods": 4})
        assert res.status_code == 200
        data = res.json()
        assert data["title"] == "Investment Memo: Apple Inc."
        assert "high reserves" in data["financial_strength"]["content"].lower()

        # 2. Post pdf generation
        pdf_res = client.post("/companies/320193/investment-memo/pdf", json=mock_memo.model_dump())
        assert pdf_res.status_code == 200
        assert pdf_res.headers["content-type"] == "application/pdf"
        assert len(pdf_res.content) > 0
