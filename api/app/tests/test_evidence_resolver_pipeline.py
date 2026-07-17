import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime

from app.models.claim_audit import ExtractedClaim
from app.models.financial_fact import NormalizedFinancialFact, CompanyFactsResponse
from app.services.evidence_resolver import (
    EvidenceResolver,
    MIN_CONFIDENCE_SCORE,
    STATUS_CACHE_MATCH,
    STATUS_LIVE_CF_MATCH,
    STATUS_FILING_XBRL_MATCH,
    STATUS_EXTENSION_MATCH,
    STATUS_RETRIEVAL_ERROR,
    STATUS_NO_MATCH,
)
from app.services.sec_client import SECClient, SECRetrievalError
from app.services.fact_normalizer import FactNormalizerService

@pytest.fixture
def mock_sec_client():
    client = MagicMock(spec=SECClient)
    client.refresh_company_facts = AsyncMock(return_value="{}")
    client.get_company_submissions = AsyncMock(return_value={
        "filings": {
            "recent": {
                "form": ["10-K", "10-Q"],
                "accessionNumber": ["000101-22-1234", "000101-22-5678"],
                "periodOfReport": ["2022-12-31", "2022-09-30"],
                "filingDate": ["2023-02-15", "2022-11-10"]
            }
        }
    })
    client.get_filing_file = AsyncMock()
    return client

@pytest.fixture
def mock_fact_normalizer():
    normalizer = MagicMock(spec=FactNormalizerService)
    return normalizer

@pytest.mark.asyncio
async def test_stage_a_cache_match(mock_sec_client, mock_fact_normalizer):
    # Setup cache facts
    facts_list = [
        NormalizedFinancialFact(
            namespace="us-gaap",
            concept="Revenues",
            label="Revenues",
            unit="USD",
            value=100000000.0,
            start_date="2022-01-01",
            end_date="2022-12-31",
            filed_date="2023-02-15",
            form="10-K",
            fiscal_year=2022,
            fiscal_period="FY",
            accession_number="000101-22-1234",
            source_url="https://sec.gov/"
        )
    ]
    cached_facts = CompanyFactsResponse(
        cik=12345,
        company_name="Test Corp",
        facts=facts_list,
        count=len(facts_list)
    )
    
    resolver = EvidenceResolver(sec_client=mock_sec_client, fact_normalizer=mock_fact_normalizer)
    
    claim = ExtractedClaim(
        original_text="Revenues of 100M in FY2022",
        company_name="Test Corp",
        ticker="TEST",
        cik="12345",
        claim_type="financial",
        metric="revenue",
        claimed_value=100.0,
        unit="million",
        direction="equal",
        start_period="2022-01-01",
        end_period="FY22"
    )
    
    result = await resolver.resolve(
        claim=claim,
        cached_facts=cached_facts,
        metric_key="revenue",
        year=2022,
        period="FY"
    )
    
    assert result.fact is not None
    assert result.resolution_status == STATUS_CACHE_MATCH
    assert result.confidence_score >= MIN_CONFIDENCE_SCORE
    assert result.score_breakdown is not None
    assert result.score_breakdown["company_match"] == 10

@pytest.mark.asyncio
async def test_stage_b_live_companyfacts_match(mock_sec_client, mock_fact_normalizer):
    # Setup cache to empty (Stage A miss)
    cached_facts = CompanyFactsResponse(cik=12345, company_name="Test Corp", facts=[], count=0)
    
    # Setup live facts
    live_facts = CompanyFactsResponse(
        cik=12345,
        company_name="Test Corp",
        facts=[
            NormalizedFinancialFact(
                namespace="us-gaap",
                concept="Revenues",
                label="Revenues",
                unit="USD",
                value=200000000.0,
                start_date="2022-01-01",
                end_date="2022-12-31",
                filed_date="2023-02-15",
                form="10-K",
                fiscal_year=2022,
                fiscal_period="FY",
                accession_number="000101-22-1234",
                source_url="https://sec.gov/"
            )
        ],
        count=1
    )
    mock_fact_normalizer.get_company_facts = AsyncMock(return_value=live_facts)
    
    resolver = EvidenceResolver(sec_client=mock_sec_client, fact_normalizer=mock_fact_normalizer)
    
    claim = ExtractedClaim(
        original_text="Revenues of 200M in FY2022",
        company_name="Test Corp",
        ticker="TEST",
        cik="12345",
        claim_type="financial",
        metric="revenue",
        claimed_value=200.0,
        unit="million",
        direction="equal",
        start_period="2022-01-01",
        end_period="FY22"
    )
    
    result = await resolver.resolve(
        claim=claim,
        cached_facts=cached_facts,
        metric_key="revenue",
        year=2022,
        period="FY"
    )
    
    assert result.fact is not None
    assert result.resolution_status == STATUS_LIVE_CF_MATCH
    assert result.confidence_score >= MIN_CONFIDENCE_SCORE

@pytest.mark.asyncio
async def test_stage_c_filing_xbrl_fallback(mock_sec_client, mock_fact_normalizer):
    # Setup cache and live facts to miss
    cached_facts = CompanyFactsResponse(cik=12345, company_name="Test Corp", facts=[], count=0)
    mock_fact_normalizer.get_company_facts = AsyncMock(return_value=CompanyFactsResponse(cik=12345, company_name="Test Corp", facts=[], count=0))
    
    # Mock linkbases index.json and XBRL instance xml
    index_json = '{"directory": {"item": [{"name": "test_pre.xml"}, {"name": "test_htm.xml"}]}}'
    instance_xml = """<xbrl xmlns="http://www.xbrl.org/2003/instance" xmlns:us-gaap="http://fasb.org/us-gaap/2022">
        <context id="ctx_FY22">
            <entity><identifier scheme="http://www.sec.gov/CIK">0000012345</identifier></entity>
            <period>
                <startDate>2022-01-01</startDate>
                <endDate>2022-12-31</endDate>
            </period>
        </context>
        <unit id="u_USD"><measure>iso4217:USD</measure></unit>
        <us-gaap:Revenues contextRef="ctx_FY22" unitRef="u_USD">150000000</us-gaap:Revenues>
    </xbrl>"""
    
    async def mock_get_filing_file(cik, accession, filename):
        if filename == "index.json":
            return index_json
        if filename.endswith(".xml") or filename.endswith(".htm"):
            return instance_xml
        return ""
        
    mock_sec_client.get_filing_file.side_effect = mock_get_filing_file
    
    resolver = EvidenceResolver(sec_client=mock_sec_client, fact_normalizer=mock_fact_normalizer)
    
    claim = ExtractedClaim(
        original_text="Revenues of 150M in FY2022",
        company_name="Test Corp",
        ticker="TEST",
        cik="12345",
        claim_type="financial",
        metric="revenue",
        claimed_value=150.0,
        unit="million",
        direction="equal",
        start_period="2022-01-01",
        end_period="FY22"
    )
    
    result = await resolver.resolve(
        claim=claim,
        cached_facts=cached_facts,
        metric_key="revenue",
        year=2022,
        period="FY"
    )
    
    assert result.fact is not None
    assert result.resolution_status == STATUS_FILING_XBRL_MATCH
    assert result.fact.concept == "Revenues"
    assert result.fact.value == 150000000.0

@pytest.mark.asyncio
async def test_stage_d_extension_concept_match(mock_sec_client, mock_fact_normalizer):
    # Setup cache and live facts to miss standard concepts
    cached_facts = CompanyFactsResponse(cik=12345, company_name="Test Corp", facts=[], count=0)
    
    # Live facts contain an extension concept for revenue
    live_facts = CompanyFactsResponse(
        cik=12345,
        company_name="Test Corp",
        facts=[
            NormalizedFinancialFact(
                namespace="custom_ns",
                concept="RevenuesFromContractWithCustomerExcludingProductRevenues",
                label="Revenues from contract",
                unit="USD",
                value=50000000.0,
                start_date="2022-01-01",
                end_date="2022-12-31",
                filed_date="2023-02-15",
                form="10-K",
                fiscal_year=2022,
                fiscal_period="FY",
                accession_number="000101-22-1234",
                source_url="https://sec.gov/"
            )
        ],
        count=1
    )
    mock_fact_normalizer.get_company_facts = AsyncMock(return_value=live_facts)
    
    # Mock presentation/calculation linkbases
    index_json = '{"directory": {"item": [{"name": "test_pre.xml"}, {"name": "test_cal.xml"}]}}'
    pre_xml = """<linkbase xmlns="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink">
        <presentationLink xlink:role="http://www.xbrl.org/role/StatementOfIncome">
            <loc xlink:href="#custom_ns_RevenuesFromContractWithCustomerExcludingProductRevenues" xlink:label="loc_rev"/>
            <loc xlink:href="#us-gaap_SalesRevenueNet" xlink:label="loc_sales"/>
            <presentationArc xlink:from="loc_sales" xlink:to="loc_rev" xlink:type="arc"/>
        </presentationLink>
    </linkbase>"""
    
    async def mock_get_filing_file(cik, accession, filename):
        if filename == "index.json":
            return index_json
        if filename.endswith("_pre.xml"):
            return pre_xml
        return ""
        
    mock_sec_client.get_filing_file.side_effect = mock_get_filing_file
    
    resolver = EvidenceResolver(sec_client=mock_sec_client, fact_normalizer=mock_fact_normalizer)
    
    claim = ExtractedClaim(
        original_text="Revenues of 50M in FY2022",
        company_name="Test Corp",
        ticker="TEST",
        cik="12345",
        claim_type="financial",
        metric="revenue",
        claimed_value=50.0,
        unit="million",
        direction="equal",
        start_period="2022-01-01",
        end_period="FY22"
    )
    
    result = await resolver.resolve(
        claim=claim,
        cached_facts=cached_facts,
        metric_key="revenue",
        year=2022,
        period="FY"
    )
    
    assert result.fact is not None
    assert result.resolution_status == STATUS_EXTENSION_MATCH
    assert result.fact.concept == "RevenuesFromContractWithCustomerExcludingProductRevenues"

@pytest.mark.asyncio
async def test_sec_retrieval_failure_distinct_status(mock_sec_client, mock_fact_normalizer):
    cached_facts = CompanyFactsResponse(cik=12345, company_name="Test Corp", facts=[], count=0)
    
    # Throw SECRetrievalError on live fetch
    mock_sec_client.refresh_company_facts.side_effect = SECRetrievalError("Rate limit exceeded")
    
    resolver = EvidenceResolver(sec_client=mock_sec_client, fact_normalizer=mock_fact_normalizer)
    
    claim = ExtractedClaim(
        original_text="Revenues of 100M",
        company_name="Test Corp",
        cik="12345",
        claim_type="financial",
        metric="revenue",
        claimed_value=100.0,
        unit="million",
        end_period="FY22"
    )
    
    result = await resolver.resolve(
        claim=claim,
        cached_facts=cached_facts,
        metric_key="revenue",
        year=2022,
        period="FY"
    )
    
    assert result.resolution_status == STATUS_RETRIEVAL_ERROR
    assert "Rate limit exceeded" in result.error_message
