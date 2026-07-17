import pytest
from unittest.mock import AsyncMock, MagicMock
from app.models.claim_audit import (
    ExtractedClaim,
    ClaimAuditResult,
    DocumentAuditResponse,
    ClaimEvidence,
    ClaimCalculation,
)
from app.models.financial_fact import CompanyFactsResponse, NormalizedFinancialFact
from app.services.claim_extraction_service import ClaimExtractionService, GeminiUnavailableError
from app.services.claim_resolution_service import ClaimResolutionService
from app.services.claim_verification_service import ClaimVerificationService
from app.services.document_audit_service import DocumentAuditService

@pytest.fixture
def mock_facts_response() -> CompanyFactsResponse:
    """
    Returns a mocked CompanyFactsResponse with 2022 and 2023 facts for test assertions.
    """
    facts = [
        # 2023 FY Revenue (383.285 Billion)
        NormalizedFinancialFact(
            namespace="us-gaap",
            concept="RevenueFromContractWithCustomerExcludingAssessedTax",
            label="Revenue",
            unit="USD",
            value=383285000000.0,
            end_date="2023-09-30",
            start_date="2022-10-01",
            form="10-K",
            filed_date="2023-10-31",
            fiscal_year=2023,
            fiscal_period="FY",
            accession_number="0000320193-23-000106",
            source_url="https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/"
        ),
        # 2022 FY Revenue (394.328 Billion)
        NormalizedFinancialFact(
            namespace="us-gaap",
            concept="RevenueFromContractWithCustomerExcludingAssessedTax",
            label="Revenue",
            unit="USD",
            value=394328000000.0,
            end_date="2022-09-24",
            start_date="2021-09-26",
            form="10-K",
            filed_date="2022-10-27",
            fiscal_year=2022,
            fiscal_period="FY",
            accession_number="0000320193-22-000108",
            source_url="https://www.sec.gov/Archives/edgar/data/320193/000032019322000108/"
        ),
        # 2023 FY Net Income (96.995 Billion)
        NormalizedFinancialFact(
            namespace="us-gaap",
            concept="NetIncomeLoss",
            label="Net Income",
            unit="USD",
            value=96995000000.0,
            end_date="2023-09-30",
            start_date="2022-10-01",
            form="10-K",
            filed_date="2023-10-31",
            fiscal_year=2023,
            fiscal_period="FY",
            accession_number="0000320193-23-000106",
            source_url="https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/"
        ),
        # 2023 FY Gross Profit (169.148 Billion)
        NormalizedFinancialFact(
            namespace="us-gaap",
            concept="GrossProfit",
            label="Gross Profit",
            unit="USD",
            value=169148000000.0,
            end_date="2023-09-30",
            start_date="2022-10-01",
            form="10-K",
            filed_date="2023-10-31",
            fiscal_year=2023,
            fiscal_period="FY",
            accession_number="0000320193-23-000106",
            source_url="https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/"
        ),
    ]
    return CompanyFactsResponse(
        cik=320193,
        company_name="Apple Inc.",
        facts=facts,
        count=len(facts)
    )

def test_direct_value_supported(mock_facts_response):
    """
    Test that a claim matching the direct reported value exactly (or within tolerance) is marked supported.
    """
    claim = ExtractedClaim(
        original_text="Apple reported FY 2023 net income of $96.995 billion.",
        company_name="Apple Inc.",
        ticker="AAPL",
        cik="320193",
        claim_type="financial_metric",
        metric="NetIncome",
        claimed_value=96.995,
        unit="billion",
        end_period="FY 2023"
    )
    service = ClaimVerificationService()
    result = service.verify_claim(claim, mock_facts_response)
    
    assert result.verdict == "supported"
    assert result.confidence == "high"
    assert len(result.evidence) == 1
    assert result.evidence[0].concept == "NetIncomeLoss"
    assert result.evidence[0].value == 96995000000.0
    # Preserves source URL
    assert result.evidence[0].source_url == "https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/"
    assert "https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/" in result.source_urls

def test_incorrect_value_contradicted(mock_facts_response):
    """
    Test that a claim with incorrect reported value is marked contradicted.
    """
    claim = ExtractedClaim(
        original_text="Apple reported FY 2023 net income of $120 billion.",
        company_name="Apple Inc.",
        ticker="AAPL",
        cik="320193",
        claim_type="financial_metric",
        metric="NetIncome",
        claimed_value=120.0,
        unit="billion",
        end_period="FY 2023"
    )
    service = ClaimVerificationService()
    result = service.verify_claim(claim, mock_facts_response)
    
    assert result.verdict == "contradicted"
    assert result.confidence == "high"
    assert len(result.evidence) == 1
    assert result.evidence[0].value == 96995000000.0

def test_partially_supported_direction_vs_value(mock_facts_response):
    """
    Test that correct direction but wrong percentage matches partially_supported.
    Claim says: Revenue decreased by 10% YoY.
    Actual calculation: (383285000000 - 394328000000) / 394328000000 = -2.8%
    It did decrease, but not by 10%.
    """
    claim = ExtractedClaim(
        original_text="Apple revenue decreased by 10% YoY in FY 2023.",
        company_name="Apple Inc.",
        ticker="AAPL",
        cik="320193",
        claim_type="financial_metric",
        metric="Revenue",
        claimed_value=10.0,
        unit="percent",
        direction="decrease",
        end_period="FY 2023",
        comparison_type="YoY"
    )
    service = ClaimVerificationService()
    result = service.verify_claim(claim, mock_facts_response)
    
    assert result.verdict == "partially_supported"
    assert result.confidence == "high"
    assert len(result.calculations) == 1
    assert result.calculations[0].result == pytest.approx(-2.80046, abs=0.001)

def test_old_fact_outdated(mock_facts_response):
    """
    Test that a claim referencing an old period (e.g. FY 2020) relative to max available (2023) is outdated.
    """
    claim = ExtractedClaim(
        original_text="Apple reported FY 2020 revenue of $274 billion.",
        company_name="Apple Inc.",
        ticker="AAPL",
        cik="320193",
        claim_type="financial_metric",
        metric="Revenue",
        claimed_value=274.0,
        unit="billion",
        end_period="FY 2020"
    )
    service = ClaimVerificationService()
    result = service.verify_claim(claim, mock_facts_response)
    
    assert result.verdict == "insufficient_evidence"
    assert result.confidence == "medium"
    assert result.is_outdated is True
    assert len(result.evidence) == 0

def test_missing_concept_insufficient_evidence(mock_facts_response):
    """
    Test that a claim for a missing concept (e.g., Accounts Receivable) is marked insufficient_evidence.
    """
    claim = ExtractedClaim(
        original_text="Apple reported FY 2023 accounts receivable of $15 billion.",
        company_name="Apple Inc.",
        ticker="AAPL",
        cik="320193",
        claim_type="financial_metric",
        metric="Receivables",
        claimed_value=15.0,
        unit="billion",
        end_period="FY 2023"
    )
    service = ClaimVerificationService()
    result = service.verify_claim(claim, mock_facts_response)
    
    assert result.verdict == "insufficient_evidence"
    assert result.confidence == "medium"

def test_opinion_classification():
    """
    Test that qualitative statements are classified as opinion.
    """
    claim = ExtractedClaim(
        original_text="The company's execution and leadership are best in class.",
        company_name="Apple Inc.",
        ticker="AAPL",
        claim_type="opinion",
        metric="None"
    )
    service = ClaimVerificationService()
    result = service.verify_claim(claim, None)
    
    assert result.verdict == "opinion"
    assert result.confidence == "high"

def test_forward_looking_classification():
    """
    Test that forecasts are classified as forward_looking.
    """
    claim = ExtractedClaim(
        original_text="We expect next year's revenues to grow by 15%.",
        company_name="Apple Inc.",
        ticker="AAPL",
        claim_type="forward_looking",
        metric="Revenue"
    )
    service = ClaimVerificationService()
    result = service.verify_claim(claim, None)
    
    assert result.verdict == "forward_looking"
    assert result.confidence == "high"

def test_ambiguous_period_requires_review(mock_facts_response):
    """
    Test that ambiguous periods (like 'over the last few years' or blank) return requires_human_review.
    """
    claim = ExtractedClaim(
        original_text="Revenues grew substantially over the last few years.",
        company_name="Apple Inc.",
        ticker="AAPL",
        cik="320193",
        claim_type="financial_metric",
        metric="Revenue",
        end_period="the last few years"
    )
    service = ClaimVerificationService()
    result = service.verify_claim(claim, mock_facts_response)
    
    assert result.verdict == "requires_human_review"
    assert result.confidence == "medium"

def test_deterministic_percentage_calculation(mock_facts_response):
    """
    Test the Gross Margin calculation: GrossProfit (169.148B) / Revenue (383.285B) = 44.13%.
    """
    claim = ExtractedClaim(
        original_text="Gross margin was 44.13% in FY 2023.",
        company_name="Apple Inc.",
        ticker="AAPL",
        cik="320193",
        claim_type="financial_metric",
        metric="GrossMargin",
        claimed_value=44.13,
        unit="percent",
        end_period="FY 2023"
    )
    service = ClaimVerificationService()
    result = service.verify_claim(claim, mock_facts_response)
    
    assert result.verdict == "supported"
    assert len(result.calculations) == 1
    assert result.calculations[0].formula == "gross_profit / revenue"
    assert result.calculations[0].result == pytest.approx(0.4413, abs=0.001)

@pytest.mark.asyncio
async def test_gemini_unavailable_fallback():
    """
    Test that DocumentAuditService fails gracefully and raises/bubbles GeminiUnavailableError
    when Gemini is unconfigured or encounters an API error.
    """
    mock_extraction = MagicMock(spec=ClaimExtractionService)
    # Simulate extraction service raising GeminiUnavailableError
    mock_extraction.extract_claims = AsyncMock(side_effect=GeminiUnavailableError("Gemini rate limit hit"))
    
    service = DocumentAuditService(
        extraction_service=mock_extraction,
        resolution_service=MagicMock(spec=ClaimResolutionService),
        verification_service=MagicMock(spec=ClaimVerificationService)
    )
    
    with pytest.raises(GeminiUnavailableError):
        await service.audit_document("Some unstructured financial research report.")
