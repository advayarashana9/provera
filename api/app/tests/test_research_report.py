import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
from app.main import app
from app.models.research_report import AIResearchReport, ReportSection, ReportCitation, ReportMetadata, InvestmentSnapshot, KeyMetricEntry, ConfidenceIndicator
from app.services.research_report_service import AIResearchReportService
from app.services.pdf_service import PDFService
from app.models.company import CompanyOverview, RecentFilingsResponse, FilingSummary
from app.models.dashboard import FinancialDashboardResponse, DashboardMetric, FinancialRatio, DashboardSeries, AIInsightPanel, HealthScoreBreakdown, QuarterHighlight

client = TestClient(app)

MOCK_OVERVIEW = CompanyOverview(
    cik=320193,
    name="Apple Inc.",
    tickers=["AAPL"],
    exchanges=["NASDAQ"],
    sic="3571",
    sic_description="Electronic Computers"
)

MOCK_METRICS = [
    DashboardMetric(key="revenue", concept="Revenue", label="Revenue", value=100000000.0, prior_value=80000000.0, unit="USD", period_end="2026-03-28", status="increased", absolute_change=20000000.0, percentage_change=0.25),
    DashboardMetric(key="net_income", concept="NetIncome", label="Net Income", value=20000000.0, prior_value=15000000.0, unit="USD", period_end="2026-03-28", status="increased", absolute_change=5000000.0, percentage_change=0.33),
    DashboardMetric(key="cash", concept="Cash", label="Cash", value=50000000.0, prior_value=60000000.0, unit="USD", period_end="2026-03-28", status="decreased", absolute_change=-10000000.0, percentage_change=-0.16),
    DashboardMetric(key="assets", concept="Assets", label="Assets", value=200000000.0, prior_value=180000000.0, unit="USD", period_end="2026-03-28", status="increased", absolute_change=20000000.0, percentage_change=0.11),
    DashboardMetric(key="liabilities", concept="Liabilities", label="Liabilities", value=120000000.0, prior_value=110000000.0, unit="USD", period_end="2026-03-28", status="increased", absolute_change=10000000.0, percentage_change=0.09),
    DashboardMetric(key="equity", concept="Equity", label="Stockholders' Equity", value=80000000.0, prior_value=70000000.0, unit="USD", period_end="2026-03-28", status="increased", absolute_change=10000000.0, percentage_change=0.14)
]

MOCK_RATIOS = [
    FinancialRatio(key="gross_margin", label="Gross Margin", value=0.45, prior_value=0.44, absolute_change=0.01, status="increased", formula="GP/Revenue", period_end="2026-03-28"),
    FinancialRatio(key="operating_margin", label="Operating Margin", value=0.30, prior_value=0.28, absolute_change=0.02, status="increased", formula="OperatingIncome/Revenue", period_end="2026-03-28"),
    FinancialRatio(key="net_margin", label="Net Margin", value=0.20, prior_value=0.19, absolute_change=0.01, status="increased", formula="NetIncome/Revenue", period_end="2026-03-28"),
    FinancialRatio(key="current_ratio", label="Current Ratio", value=1.5, prior_value=1.4, absolute_change=0.1, status="increased", formula="CurrentAssets/CurrentLiabilities", period_end="2026-03-28"),
    FinancialRatio(key="debt_to_equity", label="Debt to Equity", value=1.5, prior_value=1.57, absolute_change=-0.07, status="decreased", formula="TotalLiabilities/StockholdersEquity", period_end="2026-03-28"),
    FinancialRatio(key="return_on_assets", label="Return on Assets", value=0.10, prior_value=0.08, absolute_change=0.02, status="increased", formula="NetIncome/TotalAssets", period_end="2026-03-28")
]

MOCK_DASHBOARD = FinancialDashboardResponse(
    cik=320193,
    company_name="Apple Inc.",
    ticker="AAPL",
    latest_period_end="2026-03-28",
    latest_form="10-Q",
    metrics=MOCK_METRICS,
    ratios=MOCK_RATIOS,
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

@pytest.fixture
def mock_services():
    profile_service = MagicMock()
    profile_service.get_overview = AsyncMock(return_value=MOCK_OVERVIEW)
    
    # Mock recent filings to return a single list
    profile_service.get_recent_filings = AsyncMock(return_value=RecentFilingsResponse(
        cik=320193,
        company_name="Apple Inc.",
        count=2,
        filings=[
            FilingSummary(accession_number="123", form="10-Q", filing_date="2026-04-01", report_date="2026-03-28", primary_document="doc.htm", sec_url="http://sec.gov"),
            FilingSummary(accession_number="456", form="10-Q", filing_date="2026-01-08", report_date="2025-12-27", primary_document="doc2.htm", sec_url="http://sec.gov")
        ]
    ))

    dashboard_service = MagicMock()
    dashboard_service.get_dashboard = AsyncMock(return_value=MOCK_DASHBOARD)

    diff_service = MagicMock()
    diff_service.compare_filings = AsyncMock(return_value=None) # Start with no diff

    fact_service = MagicMock()

    return profile_service, dashboard_service, diff_service, fact_service


@pytest.mark.asyncio
async def test_report_service_no_key(mock_services, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    profile_s, dash_s, diff_s, fact_s = mock_services
    
    service = AIResearchReportService(profile_s, dash_s, diff_s, fact_s, api_key=None)
    assert not service.is_available()
    
    report = await service.generate_report(320193)
    assert report is not None
    assert "AI Research Report" in report.title
    assert len(report.citations) > 0
    # Executive summary must contain calculated values like revenue
    assert "100.00M" in report.executive_summary.content


@pytest.mark.asyncio
async def test_report_service_gemini_success(mock_services):
    profile_s, dash_s, diff_s, fact_s = mock_services
    
    mock_client = MagicMock()
    mock_response = MagicMock()
    
    # Structure a valid AIResearchReport json response mock
    mock_response.text = """
    {
      "title": "AI Analyst Report: Apple Inc.",
      "metadata": {
        "filing_type": "10-Q",
        "filing_date": "2026-04-01",
        "period_end": "2026-03-28",
        "fiscal_quarter": "Q2",
        "cik": "320193",
        "exchange": "NASDAQ"
      },
      "investment_snapshot": {
        "overall_assessment": "Positive",
        "financial_health": "Very stable financial health.",
        "liquidity": "Abundant short-term liquidity.",
        "profitability": "High operating profitability.",
        "leverage": "Conservative leverage position.",
        "biggest_strength": "Robust cash positioning.",
        "biggest_risk": "Supply chain concentration risks.",
        "metrics_to_watch_next_quarter": ["operating_cash_flow", "gross_margin"]
      },
      "executive_summary": {
        "title": "Executive Summary",
        "content": "Apple reported revenue of $100M [1] with Net Income of $20M [2].",
        "citations": [1, 2]
      },
      "business_overview": { "title": "Business Overview", "content": "Technology firm Apple Inc.", "citations": [] },
      "financial_highlights": { "title": "Financial Highlights", "content": "Revenue was high [1].", "citations": [1] },
      "balance_sheet": { "title": "Balance Sheet Analysis", "content": "Assets are $200M [4].", "citations": [4] },
      "income_statement": { "title": "Income Statement", "content": "Revenue of $100M [1].", "citations": [1] },
      "cash_flow": { "title": "Cash Flow Analysis", "content": "Cash is $50M [3].", "citations": [3] },
      "profitability": { "title": "Profitability", "content": "Margins are strong [7].", "citations": [7] },
      "risks": { "title": "Risks", "content": "No severe internal controls warnings.", "citations": [] },
      "recent_changes": { "title": "Recent Changes", "content": "Filings remain clean.", "citations": [] },
      "management_discussion": { "title": "Management Discussion", "content": "Management reported steady trends.", "citations": [] },
      "conclusion": { "title": "Conclusion", "content": "In conclusion, solid quarter.", "citations": [] },
      "citations": []
    }
    """
    mock_client.aio.models.generate_content = AsyncMock(return_value=mock_response)
    
    with patch("google.genai.Client", return_value=mock_client):
        service = AIResearchReportService(profile_s, dash_s, diff_s, fact_s, api_key="mock_key")
        assert service.is_available()
        
        report = await service.generate_report(320193)
        assert report.title == "AI Analyst Report: Apple Inc."
        assert len(report.citations) == len(MOCK_METRICS) + len(MOCK_RATIOS)
        # Ensure it populated the client citations correctly
        assert report.executive_summary.citations == [1, 2]


@pytest.mark.asyncio
async def test_report_service_gemini_fails_graceful_fallback(mock_services):
    profile_s, dash_s, diff_s, fact_s = mock_services
    
    mock_client = MagicMock()
    # Mocking generate_content throwing an API Exception
    mock_client.aio.models.generate_content = AsyncMock(side_effect=Exception("Gemini Service Error"))
    
    with patch("google.genai.Client", return_value=mock_client):
        service = AIResearchReportService(profile_s, dash_s, diff_s, fact_s, api_key="mock_key")
        assert service.is_available()
        
        # Should NOT fail, but fallback to deterministic report
        report = await service.generate_report(320193)
        assert report is not None
        assert "AI Research Report: Apple Inc." in report.title
        assert len(report.citations) > 0


def test_pdf_generation_service():
    report = AIResearchReport(
        title="AI Research Report: Apple Inc. (AAPL)",
        metadata=ReportMetadata(
            filing_type="10-Q",
            filing_date="2026-04-01",
            period_end="2026-03-28",
            fiscal_quarter="Q2",
            cik="320193",
            exchange="NASDAQ"
        ),
        investment_snapshot=InvestmentSnapshot(
            overall_assessment="Positive",
            financial_health="Strong balance sheet.",
            liquidity="Solid liquidity.",
            profitability="Stable profitability.",
            leverage="Moderate leverage.",
            biggest_strength="Cash reserves.",
            biggest_risk="Macroeconomic factors.",
            metrics_to_watch_next_quarter=["revenue", "gross_margin"]
        ),
        confidence=ConfidenceIndicator(
            data_coverage="100% of SEC Form 10-Q filings parsed.",
            confidence_level="High (Verified against SEC disclosures)",
            missing_information="None"
        ),
        executive_summary=ReportSection(title="Executive Summary", content="Apple reported $100M [1] revenue.", citations=[1]),
        business_overview=ReportSection(title="Business Overview", content="Overview content.", citations=[]),
        financial_highlights=ReportSection(title="Financial Highlights", content="Highlights content.", citations=[]),
        balance_sheet=ReportSection(title="Balance Sheet", content="Balance sheet content.", citations=[]),
        income_statement=ReportSection(title="Income Statement", content="Income statement content.", citations=[]),
        cash_flow=ReportSection(title="Cash Flow", content="Cash flow content.", citations=[]),
        profitability=ReportSection(title="Profitability", content="Profitability content.", citations=[]),
        risks=ReportSection(title="Risks", content="Risk content.", citations=[]),
        recent_changes=ReportSection(title="Recent Changes", content="Changes content.", citations=[]),
        management_discussion=ReportSection(title="Management Discussion", content="Management commentary.", citations=[]),
        conclusion=ReportSection(title="Conclusion", content="Conclusion summary.", citations=[]),
        citations=[
            ReportCitation(id=1, concept="Revenue", label="Revenue", value=100000000.0, unit="USD", period_end="2026-03-28", form="10-Q")
        ]
    )
    
    pdf_bytes = PDFService.generate_report_pdf(report, "Apple Inc.", "AAPL", "July 13, 2026")
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 0
    # PDF Magic header
    assert pdf_bytes.startswith(b"%PDF")


def test_report_endpoint_fallback(monkeypatch):
    # Set key to None to trigger fallback route testing
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    
    # Post query
    response = client.post("/companies/320193/research-report", json={"periods": 4})
    assert response.status_code == 200
    
    data = response.json()
    assert "title" in data
    assert "executive_summary" in data
    assert "citations" in data
    assert len(data["citations"]) > 0


def test_pdf_endpoint_success():
    report_dict = {
        "title": "AI Research Report: Apple Inc.",
        "metadata": {
            "filing_type": "10-Q",
            "filing_date": "2026-04-01",
            "period_end": "2026-03-28",
            "fiscal_quarter": "Q2",
            "cik": "320193",
            "exchange": "NASDAQ"
        },
        "investment_snapshot": {
            "overall_assessment": "Positive",
            "financial_health": "Very stable financial health.",
            "liquidity": "Abundant short-term liquidity.",
            "profitability": "High operating profitability.",
            "leverage": "Conservative leverage position.",
            "biggest_strength": "Robust cash positioning.",
            "biggest_risk": "Supply chain concentration risks.",
            "metrics_to_watch_next_quarter": ["operating_cash_flow", "gross_margin"]
        },
        "executive_summary": { "title": "Executive Summary", "content": "Summary content [1].", "citations": [1] },
        "business_overview": { "title": "Business Overview", "content": "Overview content.", "citations": [] },
        "financial_highlights": { "title": "Financial Highlights", "content": "Highlights content.", "citations": [] },
        "balance_sheet": { "title": "Balance Sheet", "content": "Balance sheet content.", "citations": [] },
        "income_statement": { "title": "Income Statement", "content": "Income statement content.", "citations": [] },
        "cash_flow": { "title": "Cash Flow", "content": "Cash flow content.", "citations": [] },
        "profitability": { "title": "Profitability", "content": "Profitability content.", "citations": [] },
        "risks": { "title": "Risks", "content": "Risk content.", "citations": [] },
        "recent_changes": { "title": "Recent Changes", "content": "Changes content.", "citations": [] },
        "management_discussion": { "title": "Management Discussion", "content": "Commentary.", "citations": [] },
        "conclusion": { "title": "Conclusion", "content": "Conclusion content.", "citations": [] },
        "citations": [
            { "id": 1, "concept": "Revenue", "label": "Revenue", "value": 100000000.0, "unit": "USD", "period_end": "2026-03-28", "form": "10-Q" }
        ]
    }
    
    response = client.post("/companies/320193/research-report/pdf", json=report_dict)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert len(response.content) > 0
    assert response.content.startswith(b"%PDF")
