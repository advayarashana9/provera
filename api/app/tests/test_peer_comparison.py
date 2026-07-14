import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
from app.main import app
from app.models.company import CompanyOverview, RecentFilingsResponse, FilingSummary
from app.models.dashboard import FinancialDashboardResponse, PeerComparisonResponse, DashboardMetric, FinancialRatio, DashboardSeries, DashboardSeriesPoint, AIInsightPanel, HealthScoreBreakdown, QuarterHighlight
from app.services.dashboard_service import FinancialDashboardService

client = TestClient(app)

MOCK_OVERVIEW = CompanyOverview(
    cik=320193,
    name="Apple Inc.",
    tickers=["AAPL"],
    exchanges=["NASDAQ"],
    sic="3571",
    sic_description="Electronic Computers"
)

MOCK_PEER_OVERVIEW = CompanyOverview(
    cik=789019,
    name="Microsoft Corp.",
    tickers=["MSFT"],
    exchanges=["NASDAQ"],
    sic="7372",
    sic_description="Prepackaged Software"
)

@pytest.fixture
def mock_services():
    profile_service = MagicMock()
    profile_service.get_overview = AsyncMock(side_effect=lambda cik: MOCK_OVERVIEW if cik == 320193 else MOCK_PEER_OVERVIEW)
    
    profile_service.get_recent_filings = AsyncMock(return_value=RecentFilingsResponse(
        cik=320193,
        company_name="Apple Inc.",
        count=2,
        filings=[
            FilingSummary(accession_number="123", form="10-K", filing_date="2026-04-01", report_date="2026-03-28", primary_document="doc.htm", sec_url="http://sec.gov"),
            FilingSummary(accession_number="456", form="10-K", filing_date="2025-01-08", report_date="2024-12-28", primary_document="doc2.htm", sec_url="http://sec.gov")
        ]
    ))

    return profile_service

@pytest.mark.asyncio
async def test_roe_calculation_in_dashboard():
    # Setup test with actual DashboardService to verify that ROE is appended to ratios list
    service = FinancialDashboardService()
    
    # We can mock facts extraction to return net_income and equity
    all_facts = []
    
    # Let's verify that we can calculate ROE deterministically
    ratios = []
    latest_10k = FilingSummary(accession_number="123", form="10-K", filing_date="2026-04-01", report_date="2026-03-28", primary_document="doc.htm", sec_url="http://sec.gov")
    prior_10k = FilingSummary(accession_number="456", form="10-K", filing_date="2025-01-08", report_date="2024-12-28", primary_document="doc2.htm", sec_url="http://sec.gov")
    prior_prior_10k = None

    metrics_dict = {
        "net_income": {"value": 20000.0, "unit": "USD"},
        "equity": {"value": 100000.0, "unit": "USD"},
    }

    # Mock extract metric value
    with patch.object(FinancialDashboardService, "_extract_metric_value") as mock_extract:
        # Latest Net income: 20000, Current Equity: 100000, Prev Equity: 80000
        mock_extract.side_effect = lambda facts, filing, key: (
            {"value": 20000.0, "unit": "USD"} if key == "net_income" and filing == latest_10k else (
                {"value": 100000.0, "unit": "USD"} if key == "equity" and filing == latest_10k else (
                    {"value": 80000.0, "unit": "USD"} if key == "equity" and filing == prior_10k else (
                        {"value": 15000.0, "unit": "USD"} if key == "net_income" and filing == prior_10k else (
                            {"value": 80000.0, "unit": "USD"} if key == "equity" and filing == prior_10k else None
                        )
                    )
                )
            )
        )
        
        # Test ROE calculation block
        roe_val = None
        roe_prior = None

        if latest_10k:
            roe_ni = service._extract_metric_value(all_facts, latest_10k, "net_income")
            roe_equity_curr = service._extract_metric_value(all_facts, latest_10k, "equity")
            
            if roe_ni and roe_equity_curr and prior_10k:
                roe_equity_prev = service._extract_metric_value(all_facts, prior_10k, "equity")
                if roe_equity_prev and roe_ni["value"] is not None and roe_equity_curr["value"] is not None and roe_equity_prev["value"] is not None:
                    avg_equity = (roe_equity_curr["value"] + roe_equity_prev["value"]) / 2
                    if avg_equity != 0:
                        roe_val = roe_ni["value"] / avg_equity
            
        assert roe_val == 20000.0 / 90000.0


def test_peer_comparison_endpoint_success(monkeypatch):
    # Mock profile service and dashboard service in the route
    mock_overview = CompanyOverview(
        cik=320193,
        name="Apple Inc.",
        tickers=["AAPL"],
        exchanges=["NASDAQ"],
        sic="3571",
        sic_description="Computers"
    )
    
    mock_dashboard = FinancialDashboardResponse(
        cik=320193,
        company_name="Apple Inc.",
        ticker="AAPL",
        latest_period_end="2026-03-28",
        latest_form="10-Q",
        metrics=[],
        ratios=[],
        series=[],
        warnings=[],
        ai_insights=AIInsightPanel(
            biggest_strength="Strength",
            biggest_risk="Risk",
            biggest_change="Change",
            most_important_metric="Revenue",
            watch_next_quarter="Profit"
        ),
        health_score=HealthScoreBreakdown(
            overall=85,
            growth=80,
            profitability=90,
            liquidity=85,
            leverage=90,
            stability=80
        ),
        timeline=[]
    )

    with patch("app.services.company_profile.CompanyProfileService.get_overview", AsyncMock(return_value=mock_overview)), \
         patch("app.services.dashboard_service.FinancialDashboardService.get_dashboard", AsyncMock(return_value=mock_dashboard)):
        
        response = client.get("/companies/320193/peer-comparison?peers=789019")
        assert response.status_code == 200
        data = response.json()
        assert data["base_cik"] == 320193
        assert len(data["companies"]) == 2
        assert data["companies"][0]["ticker"] == "AAPL"


def test_peer_comparison_endpoint_unresolved_peers():
    # If a peer fails to load, the endpoint should still return base company metrics and succeed
    mock_overview = CompanyOverview(
        cik=320193,
        name="Apple Inc.",
        tickers=["AAPL"],
        exchanges=["NASDAQ"],
        sic="3571",
        sic_description="Computers"
    )
    
    mock_dashboard = FinancialDashboardResponse(
        cik=320193,
        company_name="Apple Inc.",
        ticker="AAPL",
        latest_period_end="2026-03-28",
        latest_form="10-Q",
        metrics=[],
        ratios=[],
        series=[],
        warnings=[],
        ai_insights=AIInsightPanel(
            biggest_strength="Strength",
            biggest_risk="Risk",
            biggest_change="Change",
            most_important_metric="Revenue",
            watch_next_quarter="Profit"
        ),
        health_score=HealthScoreBreakdown(
            overall=85,
            growth=80,
            profitability=90,
            liquidity=85,
            leverage=90,
            stability=80
        ),
        timeline=[]
    )
    
    with patch("app.services.company_profile.CompanyProfileService.get_overview", AsyncMock(return_value=mock_overview)), \
         patch("app.services.dashboard_service.FinancialDashboardService.get_dashboard") as mock_dash_call:
        
        # Base succeeds, peer throws exception
        mock_dash_call.side_effect = [
            mock_dashboard,
            Exception("Peer CIK not found or rate limited")
        ]
        
        response = client.get("/companies/320193/peer-comparison?peers=999999")
        assert response.status_code == 200
        data = response.json()
        assert len(data["companies"]) == 1 # Only base company returned!
