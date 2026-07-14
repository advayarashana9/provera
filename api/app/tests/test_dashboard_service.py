import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from copy import deepcopy

from app.models.company import FilingSummary
from app.models.financial_fact import NormalizedFinancialFact
from app.services.dashboard_service import FinancialDashboardService

def make_filing(accession, form="10-K", report_date="2023-09-30", filing_date="2023-10-15"):
    return FilingSummary(
        accession_number=accession,
        filing_date=filing_date,
        report_date=report_date,
        acceptance_datetime="2023-10-15T16:00:00",
        form=form,
        file_number="001-12345",
        primary_document="form10k.htm",
        primary_document_description="Form 10-K",
        sec_url=f"https://www.sec.gov/Archives/edgar/data/123/{accession.replace('-', '')}/form10k.htm"
    )

def make_fact(concept, value, end_date="2023-09-30", start_date=None, unit="USD", accession="000-1", form="10-K"):
    return NormalizedFinancialFact(
        namespace="us-gaap",
        concept=concept,
        value=value,
        unit=unit,
        start_date=start_date,
        end_date=end_date,
        filed_date="2023-10-15",
        form=form,
        fiscal_year=2023,
        fiscal_period="FY",
        accession_number=accession,
        source_url="http://sec.gov"
    )

@pytest.mark.asyncio
async def test_alternative_concept_selection():
    service = FinancialDashboardService()
    
    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("acc-latest", form="10-K", report_date="2023-09-30")
    ]
    
    mock_facts = MagicMock()
    mock_facts.company_name = "Mock Inc."
    # Use SalesRevenueNet as alternative concept for revenue
    mock_facts.facts = [
        make_fact("SalesRevenueNet", 500000.0, end_date="2023-09-30", start_date="2022-10-01", accession="acc-latest")
    ]
    
    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=mock_facts)):
            res = await service.get_dashboard(12345, periods=4)
            # Find Revenue metric
            rev_m = next(m for m in res.metrics if m.key == "revenue")
            assert rev_m.value == 500000.0
            assert rev_m.concept == "SalesRevenueNet"

@pytest.mark.asyncio
async def test_instant_metric_period_selection():
    service = FinancialDashboardService()
    
    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("acc-latest", form="10-Q", report_date="2023-06-30")
    ]
    
    mock_facts = MagicMock()
    mock_facts.company_name = "Mock Inc."
    mock_facts.facts = [
        # Match (end_date matches report_date within 4 days)
        make_fact("Assets", 999.0, end_date="2023-06-29", start_date=None, accession="acc-latest", form="10-Q"),
        # Mismatch (outside 4 days tolerance)
        make_fact("Assets", 500.0, end_date="2023-06-15", start_date=None, accession="acc-latest", form="10-Q")
    ]
    
    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=mock_facts)):
            res = await service.get_dashboard(12345, periods=4)
            assets_m = next(m for m in res.metrics if m.key == "assets")
            assert assets_m.value == 999.0

@pytest.mark.asyncio
async def test_quarterly_duration_selection_and_derivation():
    service = FinancialDashboardService()
    
    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("acc-q2", form="10-Q", report_date="2023-06-30")
    ]
    
    mock_facts = MagicMock()
    mock_facts.company_name = "Mock Inc."
    
    # We only have YTD (6 month) and Q1 (3 month) facts. Q2 value should be derived as 600 - 250 = 350.
    mock_facts.facts = [
        # Q2 YTD (6 months)
        make_fact("Revenues", 600.0, end_date="2023-06-30", start_date="2023-01-01", accession="acc-q2", form="10-Q"),
        # Q1 YTD (3 months)
        make_fact("Revenues", 250.0, end_date="2023-03-31", start_date="2023-01-01", accession="acc-q1", form="10-Q")
    ]
    
    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=mock_facts)):
            res = await service.get_dashboard(12345, periods=4)
            rev_m = next(m for m in res.metrics if m.key == "revenue")
            assert rev_m.value == 350.0 # Derived Q2
            assert any("Derived quarterly value for Revenue" in w for w in res.warnings)

@pytest.mark.asyncio
async def test_annual_and_quarterly_facts_not_mixed():
    service = FinancialDashboardService()
    
    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("acc-q1", form="10-Q", report_date="2023-03-31"),
        make_filing("acc-fy", form="10-K", report_date="2023-09-30")
    ]
    
    mock_facts = MagicMock()
    mock_facts.company_name = "Mock Inc."
    mock_facts.facts = [
        make_fact("Revenues", 100.0, end_date="2023-03-31", start_date="2023-01-01", accession="acc-q1", form="10-Q"),
        make_fact("Revenues", 450.0, end_date="2023-09-30", start_date="2022-10-01", accession="acc-fy", form="10-K")
      ]
      
    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=mock_facts)):
            res = await service.get_dashboard(12345, periods=4)
            
            q_series = next(s for s in res.series if s.key == "revenue_quarterly")
            a_series = next(s for s in res.series if s.key == "revenue_annual")
            
            # Quarterly series should only have the 3-month point
            assert len(q_series.points) == 1
            assert q_series.points[0].value == 100.0
            
            # Annual series should only have the 12-month point
            assert len(a_series.points) == 1
            assert a_series.points[0].value == 450.0

@pytest.mark.asyncio
async def test_duplicate_comparative_facts_removed_latest_accession():
    service = FinancialDashboardService()
    
    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("acc-newer", form="10-Q", report_date="2023-06-30"),
        make_filing("acc-older", form="10-Q", report_date="2023-03-31")
    ]
    
    mock_facts = MagicMock()
    mock_facts.company_name = "Mock Inc."
    mock_facts.facts = [
        # Original fact in older filing
        make_fact("Assets", 100.0, end_date="2023-03-31", start_date=None, accession="acc-older", form="10-Q"),
        # Restated / duplicate fact inside newer filing
        make_fact("Assets", 110.0, end_date="2023-03-31", start_date=None, accession="acc-newer", form="10-Q")
    ]
    
    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=mock_facts)):
            res = await service.get_dashboard(12345, periods=4)
            # When looking at trend points for 2023-03-31, we should deduplicate and pick the newer accession
            q_series = next(s for s in res.series if s.key == "assets_quarterly")
            p_older = next(p for p in q_series.points if p.period_end == "2023-03-31")
            assert p_older.value == 110.0

@pytest.mark.asyncio
async def test_deterministic_change_calculations():
    service = FinancialDashboardService()
    
    mock_recent = MagicMock()
    # YoY Q2 comparison
    mock_recent.filings = [
        make_filing("acc-latest", form="10-Q", report_date="2023-06-30"),
        make_filing("acc-prior", form="10-Q", report_date="2022-06-30")
    ]
    
    mock_facts = MagicMock()
    mock_facts.company_name = "Mock Inc."
    mock_facts.facts = [
        make_fact("Assets", 150.0, end_date="2023-06-30", start_date=None, accession="acc-latest", form="10-Q"),
        make_fact("Assets", 100.0, end_date="2022-06-30", start_date=None, accession="acc-prior", form="10-Q")
    ]
    
    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=mock_facts)):
            res = await service.get_dashboard(12345, periods=4)
            assets_m = next(m for m in res.metrics if m.key == "assets")
            assert assets_m.value == 150.0
            assert assets_m.prior_value == 100.0
            assert assets_m.absolute_change == 50.0
            assert assets_m.percentage_change == 0.5
            assert assets_m.status == "increased"

@pytest.mark.asyncio
async def test_negative_and_sign_changing_percentages_return_null():
    service = FinancialDashboardService()
    
    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("acc-latest", form="10-Q", report_date="2023-06-30"),
        make_filing("acc-prior", form="10-Q", report_date="2022-06-30")
    ]
    
    mock_facts = MagicMock()
    mock_facts.company_name = "Mock Inc."
    mock_facts.facts = [
        # Case: prior is negative
        make_fact("NetIncomeLoss", -50.0, end_date="2023-06-30", start_date="2023-04-01", accession="acc-latest", form="10-Q"),
        make_fact("NetIncomeLoss", -100.0, end_date="2022-06-30", start_date="2022-04-01", accession="acc-prior", form="10-Q"),
        # Case: sign change (positive to negative)
        make_fact("Revenues", -10.0, end_date="2023-06-30", start_date="2023-04-01", accession="acc-latest", form="10-Q"),
        make_fact("Revenues", 50.0, end_date="2022-06-30", start_date="2022-04-01", accession="acc-prior", form="10-Q")
    ]
    
    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=mock_facts)):
            res = await service.get_dashboard(12345, periods=4)
            
            ni_m = next(m for m in res.metrics if m.key == "net_income")
            # prior was -100.0 (negative) -> percentage change must be None
            assert ni_m.percentage_change is None
            
            rev_m = next(m for m in res.metrics if m.key == "revenue")
            # crosses signs (50.0 to -10.0) -> percentage change must be None
            assert rev_m.percentage_change is None

@pytest.mark.asyncio
async def test_ratio_calculations():
    service = FinancialDashboardService()
    
    mock_recent = MagicMock()
    # YoY 10-K comparison
    mock_recent.filings = [
        make_filing("acc-latest", form="10-K", report_date="2023-09-30"),
        make_filing("acc-prior", form="10-K", report_date="2022-09-30")
    ]
    
    mock_facts = MagicMock()
    mock_facts.company_name = "Mock Inc."
    mock_facts.facts = [
        make_fact("Revenues", 1000.0, end_date="2023-09-30", start_date="2022-10-01", accession="acc-latest", form="10-K"),
        make_fact("Revenues", 800.0, end_date="2022-09-30", start_date="2021-10-01", accession="acc-prior", form="10-K"),
        
        make_fact("GrossProfit", 600.0, end_date="2023-09-30", start_date="2022-10-01", accession="acc-latest", form="10-K"),
        make_fact("GrossProfit", 400.0, end_date="2022-09-30", start_date="2021-10-01", accession="acc-prior", form="10-K"),
        
        make_fact("NetIncomeLoss", 200.0, end_date="2023-09-30", start_date="2022-10-01", accession="acc-latest", form="10-K"),
        make_fact("NetIncomeLoss", 100.0, end_date="2022-09-30", start_date="2021-10-01", accession="acc-prior", form="10-K"),
        
        make_fact("Assets", 500.0, end_date="2023-09-30", start_date=None, accession="acc-latest", form="10-K"),
        make_fact("Assets", 300.0, end_date="2022-09-30", start_date=None, accession="acc-prior", form="10-K")
    ]
    
    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=mock_facts)):
            res = await service.get_dashboard(12345, periods=4)
            
            gm_ratio = next(r for r in res.ratios if r.key == "gross_margin")
            # GM = GP / Rev -> 600 / 1000 = 0.6
            assert gm_ratio.value == 0.6
            # Prior GM = 400 / 800 = 0.5
            assert gm_ratio.prior_value == 0.5
            assert gm_ratio.absolute_change == pytest.approx(0.1)
            
            roa_ratio = next(r for r in res.ratios if r.key == "return_on_assets")
            # ROA = Net Income / Average Assets
            # Average Assets = (500 + 300) / 2 = 400
            # ROA = 200 / 400 = 0.5
            assert roa_ratio.value == 0.5

@pytest.mark.asyncio
async def test_incompatible_ratio_inputs_return_unavailable():
    service = FinancialDashboardService()
    
    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("acc-latest", form="10-Q", report_date="2023-06-30")
    ]
    
    mock_facts = MagicMock()
    mock_facts.company_name = "Mock Inc."
    # GP is present, but Revenue is missing
    mock_facts.facts = [
        make_fact("GrossProfit", 600.0, end_date="2023-06-30", start_date="2023-04-01", accession="acc-latest", form="10-Q")
    ]
    
    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=mock_facts)):
            res = await service.get_dashboard(12345, periods=4)
            gm_ratio = next(r for r in res.ratios if r.key == "gross_margin")
            assert gm_ratio.value is None
            assert gm_ratio.status == "unavailable"

@pytest.mark.asyncio
async def test_chronological_series_sorting():
    service = FinancialDashboardService()
    
    mock_recent = MagicMock()
    # Out of order dates in submissions
    mock_recent.filings = [
        make_filing("acc-2", form="10-Q", report_date="2023-06-30"),
        make_filing("acc-1", form="10-Q", report_date="2023-03-31")
    ]
    
    mock_facts = MagicMock()
    mock_facts.company_name = "Mock Inc."
    mock_facts.facts = [
        make_fact("Assets", 200.0, end_date="2023-06-30", start_date=None, accession="acc-2", form="10-Q"),
        make_fact("Assets", 100.0, end_date="2023-03-31", start_date=None, accession="acc-1", form="10-Q")
    ]
    
    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=mock_facts)):
            res = await service.get_dashboard(12345, periods=4)
            assets_series = next(s for s in res.series if s.key == "assets_quarterly")
            # Points must be chronologically sorted (2023-03-31 first, then 2023-06-30)
            assert len(assets_series.points) == 2
            assert assets_series.points[0].period_end == "2023-03-31"
            assert assets_series.points[1].period_end == "2023-06-30"

@pytest.mark.asyncio
async def test_missing_facts_handled_safely():
    service = FinancialDashboardService()
    
    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("acc-latest", form="10-Q", report_date="2023-06-30")
    ]
    
    mock_facts = MagicMock()
    mock_facts.company_name = "Mock Inc."
    mock_facts.facts = [] # No facts
    
    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=mock_facts)):
            res = await service.get_dashboard(12345, periods=4)
            assert res.company_name == "Mock Inc."
            assert any("No financial facts available" in w for w in res.warnings)

@pytest.mark.asyncio
async def test_no_source_data_mutation():
    service = FinancialDashboardService()
    
    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("acc-latest", form="10-Q", report_date="2023-06-30")
    ]
    
    mock_facts = MagicMock()
    mock_facts.company_name = "Mock Inc."
    
    orig_facts = [
        make_fact("Assets", 100.0, end_date="2023-06-30", start_date=None, accession="acc-latest", form="10-Q")
    ]
    # Deepcopy to compare after run
    mock_facts.facts = deepcopy(orig_facts)
    
    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=mock_facts)):
            await service.get_dashboard(12345, periods=4)
            # The original list/items should not be mutated
            assert len(mock_facts.facts) == len(orig_facts)
            assert mock_facts.facts[0].value == 100.0
            assert mock_facts.facts[0].concept == "Assets"
