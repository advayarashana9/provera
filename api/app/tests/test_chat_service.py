from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.chat_service import ChatService
from app.models.financial_fact import NormalizedFinancialFact
from app.models.chat import ChatRequest, ChatResponse, ChatCitation, ChatComparison

client = TestClient(app)

# Helper to generate dummy facts
def make_fact(concept, value, year=None, end_date="2023-09-30", start_date=None, label=None, namespace="us-gaap", unit="USD", form="10-K", accession="000-1"):
    return NormalizedFinancialFact(
        namespace=namespace,
        concept=concept,
        value=value,
        unit=unit,
        start_date=start_date,
        end_date=end_date,
        filed_date="2023-10-15",
        form=form,
        fiscal_year=year,
        fiscal_period="FY" if form == "10-K" else "Q3",
        accession_number=accession,
        source_url=f"https://www.sec.gov/Archives/edgar/data/123/{accession.replace('-', '')}/"
    )

# =====================================================================
# ChatService Logic Tests
# =====================================================================

def test_evidence_deduplication():
    service = ChatService()
    
    # 1. Identical concept, value, unit, end date, accession number (exact duplicates)
    facts = [
        make_fact("Revenues", 5000.0, 2023, end_date="2023-09-30", accession="acc-1"),
        make_fact("Revenues", 5000.0, 2023, end_date="2023-09-30", accession="acc-1"), # exact duplicate
    ]
    res = service.filter_relevant_facts(facts, "What is revenue?")
    assert len(res) == 1

    # 2. Repeated comparative facts from multiple filings for same period (avoid duplicates from older filings)
    facts_multi = [
        NormalizedFinancialFact(
            namespace="us-gaap", concept="Revenues", value=5000.0, unit="USD",
            end_date="2023-09-30", filed_date="2023-10-15", form="10-K", accession_number="acc-new"
        ),
        NormalizedFinancialFact(
            namespace="us-gaap", concept="Revenues", value=5000.0, unit="USD",
            end_date="2023-09-30", filed_date="2023-09-15", form="10-K", accession_number="acc-old"
        ),
    ]
    res_multi = service.filter_relevant_facts(facts_multi, "What is revenue?")
    assert len(res_multi) == 1
    assert res_multi[0].accession_number == "acc-new"

def test_evidence_count_limits():
    service = ChatService()
    
    # Create 25 distinct facts
    large_facts = [
        make_fact(f"Concept_{i}", float(i), 2023, end_date=f"2023-09-{i:02d}")
        for i in range(1, 26)
    ]
    
    # Default query (not trend related) should limit to default maximum of 12
    res_default = service.filter_relevant_facts(large_facts, "What is the list of concepts?")
    assert len(res_default) <= 12
    
    # Trend query should limit to hard maximum of 20
    trend_facts = []
    # Create 15 concepts, each with 2 periods (total 30 facts)
    for i in range(1, 16):
        trend_facts.append(make_fact(f"RevenueTrend_{i}", 100.0 + i, 2023, end_date="2023-09-30", start_date="2023-01-01"))
        trend_facts.append(make_fact(f"RevenueTrend_{i}", 90.0 + i, 2022, end_date="2022-09-30", start_date="2022-01-01"))
        
    res_trend = service.filter_relevant_facts(trend_facts, "Show increased trend in RevenueTrend concepts.")
    assert len(res_trend) <= 20

def test_exact_concept_ranking():
    service = ChatService()
    
    facts = [
        make_fact("OtherLiabilities", 10.0, 2023),
        make_fact("Liabilities", 500.0, 2023), # Exact concept match for query "Liabilities"
    ]
    
    res = service.filter_relevant_facts(facts, "What are the Liabilities?")
    assert len(res) == 2
    assert res[0].concept == "Liabilities"

def test_recent_period_ranking():
    service = ChatService()
    
    facts = [
        make_fact("Revenues", 4000.0, 2021, end_date="2021-09-30"),
        make_fact("Revenues", 5000.0, 2023, end_date="2023-09-30"), # More recent
        make_fact("Revenues", 4500.0, 2022, end_date="2022-09-30"),
    ]
    
    res = service.filter_relevant_facts(facts, "What is the revenue history?")
    assert len(res) == 3
    assert res[0].end_date == "2023-09-30"
    assert res[1].end_date == "2022-09-30"
    assert res[2].end_date == "2021-09-30"

def test_deterministic_comparisons():
    service = ChatService()
    
    facts = [
        make_fact("Revenues", 5000.0, 2023, end_date="2023-09-30", start_date="2023-01-01"),
        make_fact("Revenues", 4000.0, 2022, end_date="2022-09-30", start_date="2022-01-01"),
    ]
    
    comparisons = service.calculate_comparisons(facts)
    assert len(comparisons) == 1
    comp = comparisons[0]
    assert comp.concept == "Revenues"
    assert comp.current_value == 5000.0
    assert comp.prior_value == 4000.0
    assert comp.absolute_change == 1000.0
    assert comp.percentage_change == pytest.approx(0.25)

def test_no_comparison_across_incompatible_units():
    service = ChatService()
    
    facts = [
        make_fact("Assets", 5000.0, 2023, end_date="2023-09-30", unit="USD"),
        make_fact("Assets", 5000.0, 2022, end_date="2022-09-30", unit="EUR"),
    ]
    
    comparisons = service.calculate_comparisons(facts)
    assert len(comparisons) == 0

def test_no_mixing_instant_and_duration_facts():
    service = ChatService()
    
    facts = [
        make_fact("CashAndCashEquivalents", 100.0, 2023, end_date="2023-09-30", start_date="2023-01-01"), # duration
        make_fact("CashAndCashEquivalents", 80.0, 2022, end_date="2022-09-30", start_date=None), # instant
    ]
    
    comparisons = service.calculate_comparisons(facts)
    assert len(comparisons) == 0

def test_no_unsupported_causal_language_in_fallback_output():
    # If Gemini is unavailable, fallback answer must not invent cause
    with patch("app.services.chat_service.ChatService.is_available", return_value=False):
        mock_res = MagicMock()
        mock_res.company_name = "Apple Inc."
        mock_res.facts = []
        with patch("app.services.fact_normalizer.FactNormalizerService.get_company_facts", AsyncMock(return_value=mock_res)):
            response = client.post("/companies/320193/ask", json={"question": "Why did revenue drop?"})
            assert response.status_code == 200
            data = response.json()
            assert "insufficient evidence" in data["answer"].lower()
            assert "do not establish its cause" in data["answer"].lower()
            assert data["insufficient_evidence"] is True

@pytest.mark.asyncio
async def test_citation_ids_match_returned_citations():
    mock_normalizer = MagicMock()
    res_obj = MagicMock()
    res_obj.company_name = "Apple Inc."
    res_obj.facts = [
        make_fact("Revenues", 5000.0, 2023, end_date="2023-09-30")
    ]
    mock_normalizer.get_company_facts = AsyncMock(return_value=res_obj)
    
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = "Apple reported Revenue of 5000 USD [1]."
    mock_client.aio.models.generate_content = AsyncMock(return_value=mock_response)
    
    with patch("google.genai.Client", return_value=mock_client):
        service = ChatService(fact_normalizer=mock_normalizer)
        with patch.object(service, 'is_available', return_value=True):
            service.client = mock_client
            
            res = await service.ask_question(320193, "What is revenue?")
            
            assert res.evidence_count == 1
            assert len(res.citations) == 1
            assert res.citations[0].id == 1
            assert res.citations[0].concept == "Revenues"

@pytest.mark.asyncio
async def test_insufficient_evidence_behavior():
    mock_normalizer = MagicMock()
    res_obj = MagicMock()
    res_obj.company_name = "Apple Inc."
    res_obj.facts = []
    mock_normalizer.get_company_facts = AsyncMock(return_value=res_obj)
    
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = "Insufficient evidence in the filing data exists to answer this question."
    mock_client.aio.models.generate_content = AsyncMock(return_value=mock_response)
    
    with patch("google.genai.Client", return_value=mock_client):
        service = ChatService(fact_normalizer=mock_normalizer)
        with patch.object(service, 'is_available', return_value=True):
            service.client = mock_client
            
            res = await service.ask_question(320193, "Show me cash reserves.")
            
            assert res.evidence_count == 0
            assert res.insufficient_evidence is True
            assert "insufficient evidence" in res.answer.lower()

# =====================================================================
# API Router Endpoint Tests
# =====================================================================

def test_ask_endpoint_empty_query():
    response = client.post("/companies/320193/ask", json={"question": ""})
    assert response.status_code == 400
    assert "empty" in response.json()["detail"].lower()

def test_ask_endpoint_success():
    mock_answer = ChatResponse(
        answer="Mocked chat answer citing [1].",
        citations=[
            ChatCitation(
                id=1,
                concept="Revenues",
                label="Revenue",
                value=5000.0,
                unit="USD",
                period_end="2023-09-30",
                form="10-K",
                accession_number="acc-1",
                source_url="http://sec.gov"
            )
        ],
        comparisons=[
            ChatComparison(
                concept="Revenues",
                label="Revenue",
                current_value=5000.0,
                prior_value=4000.0,
                unit="USD",
                current_period_end="2023-09-30",
                prior_period_end="2022-09-30",
                absolute_change=1000.0,
                percentage_change=0.25
            )
        ],
        evidence_count=1,
        insufficient_evidence=False
    )
    
    with patch("app.services.chat_service.ChatService.ask_question", return_value=mock_answer):
        response = client.post("/companies/320193/ask", json={"question": "What is the revenue?"})
        assert response.status_code == 200
        data = response.json()
        assert "Mocked chat answer" in data["answer"]
        assert data["evidence_count"] == 1
        assert len(data["citations"]) == 1
        assert data["citations"][0]["concept"] == "Revenues"
        assert len(data["comparisons"]) == 1
        assert data["comparisons"][0]["absolute_change"] == 1000.0

# =====================================================================
# XBRL Synonym Feature Tests
# =====================================================================

def test_detect_available_metrics_revenue_synonym():
    """detect_available_metrics must recognise all known revenue concept names."""
    service = ChatService()
    revenue_synonyms = [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "Revenues",
        "SalesRevenueNet",
        "OperatingRevenue",
        "TotalRevenue",
        "NetSales",
    ]
    for concept in revenue_synonyms:
        facts = [make_fact(concept, 1_000_000)]
        result = service.detect_available_metrics(facts)
        assert "revenue" in result, (
            f"Expected 'revenue' family to be detected for concept '{concept}', got: {result}"
        )
        assert result["revenue"] == concept

def test_detect_available_metrics_multiple_families():
    """detect_available_metrics should find multiple families at once."""
    service = ChatService()
    facts = [
        make_fact("NetIncomeLoss", 500_000),
        make_fact("Assets", 10_000_000),
        make_fact("LiabilitiesCurrent", 1_000_000),
        make_fact("NetCashProvidedByUsedInOperatingActivities", 800_000),
    ]
    result = service.detect_available_metrics(facts)
    assert "net_income" in result
    assert "assets" in result
    assert "current_liabilities" in result
    assert "operating_cash_flow" in result

def test_detect_available_metrics_unknown_concept_ignored():
    """detect_available_metrics must not hallucinate families for unknown concepts."""
    service = ChatService()
    facts = [make_fact("SomeObscureConceptXYZ", 999)]
    result = service.detect_available_metrics(facts)
    assert result == {}, f"Expected empty result, got: {result}"

def test_synonyms_for_query_revenue():
    """_synonyms_for_query must return all revenue synonyms when query contains 'revenue'."""
    service = ChatService()
    synonyms = service._synonyms_for_query("what is the revenue trend?")
    # All known revenue concepts must be in the returned set (normalised)
    assert "revenuefromcontractwithcustomerexcludingassessedtax" in synonyms
    assert "revenues" in synonyms
    assert "salesrevenuenet" in synonyms
    assert "netsales" in synonyms

def test_synonyms_for_query_gross_margin():
    """Gross margin query must pull revenue AND cost-of-revenue AND gross profit synonyms."""
    service = ChatService()
    synonyms = service._synonyms_for_query("did gross margin decline this quarter?")
    assert "grossprofit" in synonyms
    assert "costofrevenue" in synonyms
    assert "revenuefromcontractwithcustomerexcludingassessedtax" in synonyms

def test_synonyms_for_query_empty_on_unrelated():
    """A purely narrative question should not boost any synonym concepts."""
    service = ChatService()
    synonyms = service._synonyms_for_query("what does management say about future outlook?")
    # No financial metric synonyms should be triggered by a pure narrative question
    # (the set may not be perfectly empty if very broad trigger words match, but revenue/
    # net income synonyms should NOT be there)
    assert "revenuefromcontractwithcustomerexcludingassessedtax" not in synonyms
    assert "netincomeloss" not in synonyms

def test_filter_relevant_facts_finds_unusual_revenue_concept():
    """
    RevenueFromContractWithCustomerExcludingAssessedTax is the most common Apple/MSFT
    revenue concept. It must score highly when the query asks about revenue.
    """
    service = ChatService()
    facts = [
        # The unusual (but correct) XBRL concept name
        make_fact("RevenueFromContractWithCustomerExcludingAssessedTax", 90_000_000_000,
                  end_date="2023-09-30", accession="acc-1"),
        # A completely unrelated concept that should score lower
        make_fact("DeferredTaxAssetsGross", 5_000_000,
                  end_date="2023-09-30", accession="acc-2"),
    ]
    result = service.filter_relevant_facts(facts, "What was the revenue this quarter?")
    # The unusual revenue concept must be retrieved
    concepts_found = [f.concept for f in result]
    assert "RevenueFromContractWithCustomerExcludingAssessedTax" in concepts_found
    # And it must rank first (highest relevance)
    assert result[0].concept == "RevenueFromContractWithCustomerExcludingAssessedTax"

def test_filter_relevant_facts_net_income_synonym():
    """ProfitLoss is a valid Net Income synonym and must be found on net income queries."""
    service = ChatService()
    facts = [
        make_fact("ProfitLoss", 25_000_000_000, end_date="2023-09-30"),
        make_fact("DeferredCompensationLiabilityClassifiedNoncurrent", 100_000, end_date="2023-09-30"),
    ]
    result = service.filter_relevant_facts(facts, "What was the net income or profit?")
    concepts_found = [f.concept for f in result]
    assert "ProfitLoss" in concepts_found
    assert result[0].concept == "ProfitLoss"

