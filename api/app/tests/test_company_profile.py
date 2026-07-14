import pytest
from unittest.mock import AsyncMock, MagicMock
from copy import deepcopy
from app.services.company_profile import CompanyProfileService

# Sample raw SEC submissions response payload
MOCK_SUBMISSIONS = {
    "cik": "320193",
    "name": "Apple Inc.",
    "tickers": ["AAPL"],
    "exchanges": ["NASDAQ"],
    "sic": "3571",
    "sicDescription": "Electronic Computers",
    "fiscalYearEnd": "0928",
    "stateOfIncorporation": "CA",
    "entityType": "operating",
    "website": "www.apple.com",
    "investorWebsite": "investor.apple.com",
    "phone": "408-996-1010",
    "filings": {
        "recent": {
            "accessionNumber": ["0000320193-23-000106", "0000320193-23-000001"],
            "filingDate": ["2023-11-03", "2023-05-04"],
            "reportDate": ["2023-09-30", "2023-04-01"],
            "acceptanceDateTime": ["2023-11-02T18:08:27.000Z", "2023-05-03T17:00:00.000Z"],
            "form": ["10-K", "10-Q"],
            "fileNumber": ["001-36743", "001-36743"],
            "primaryDocument": ["aapl-20230930.htm", "aapl-20230401.htm"],
            "primaryDocDescription": ["10-K", "10-Q"]
        }
    }
}

@pytest.fixture
def mock_sec_client():
    """
    Fixture returning a mock SECClient populated with standard submissions data.
    """
    client = MagicMock()
    # Return a deepcopy to ensure mutation tests are accurate
    client.get_company_submissions = AsyncMock(side_effect=lambda cik: deepcopy(MOCK_SUBMISSIONS))
    return client

@pytest.mark.asyncio
async def test_company_overview_normalization(mock_sec_client):
    """
    Test standard overview field extraction and normalization.
    """
    service = CompanyProfileService(sec_client=mock_sec_client)
    overview = await service.get_overview(320193)
    
    assert overview.cik == 320193
    assert overview.name == "Apple Inc."
    assert overview.tickers == ["AAPL"]
    assert overview.exchanges == ["NASDAQ"]
    assert overview.sic == "3571"
    assert overview.sic_description == "Electronic Computers"
    assert overview.fiscal_year_end == "0928"
    assert overview.state_of_incorporation == "CA"
    assert overview.entity_type == "operating"
    assert overview.website == "www.apple.com"
    assert overview.investor_website == "investor.apple.com"
    assert overview.phone == "408-996-1010"

@pytest.mark.asyncio
async def test_missing_optional_overview_fields(mock_sec_client):
    """
    Test that missing optional overview fields map to default values/None without errors.
    """
    partial_submissions = {
        "cik": "320193",
        "name": "Apple Inc."
        # tickers, exchanges, and other fields are missing
    }
    mock_sec_client.get_company_submissions = AsyncMock(return_value=partial_submissions)
    
    service = CompanyProfileService(sec_client=mock_sec_client)
    overview = await service.get_overview(320193)
    
    assert overview.cik == 320193
    assert overview.name == "Apple Inc."
    assert overview.tickers == []
    assert overview.exchanges == []
    assert overview.sic is None
    assert overview.sic_description is None
    assert overview.website is None

@pytest.mark.asyncio
async def test_recent_filing_normalization_and_url(mock_sec_client):
    """
    Test normalization of recent filings and proper construction of SEC EDGAR URLs.
    """
    service = CompanyProfileService(sec_client=mock_sec_client)
    response = await service.get_recent_filings(320193)
    
    assert response.cik == 320193
    assert response.company_name == "Apple Inc."
    assert response.count == 2
    assert len(response.filings) == 2
    
    # Check first filing details
    f = response.filings[0]
    assert f.accession_number == "0000320193-23-000106"
    assert f.filing_date == "2023-11-03"
    assert f.report_date == "2023-09-30"
    assert f.acceptance_datetime == "2023-11-02T18:08:27.000Z"
    assert f.form == "10-K"
    assert f.file_number == "001-36743"
    assert f.primary_document == "aapl-20230930.htm"
    assert f.primary_document_description == "10-K"
    assert f.sec_url == "https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm"

@pytest.mark.asyncio
async def test_form_filtering(mock_sec_client):
    """
    Test filtering by forms (case-insensitively).
    """
    service = CompanyProfileService(sec_client=mock_sec_client)
    
    # 1. Exact match filter
    res_1 = await service.get_recent_filings(320193, forms=["10-K"])
    assert res_1.count == 1
    assert res_1.filings[0].form == "10-K"
    
    # 2. Case-insensitive filter
    res_2 = await service.get_recent_filings(320193, forms=["10-q"])
    assert res_2.count == 1
    assert res_2.filings[0].form == "10-Q"
    
    # 3. Multiple forms filter
    res_3 = await service.get_recent_filings(320193, forms=["10-k", "10-q"])
    assert res_3.count == 2

@pytest.mark.asyncio
async def test_limit_enforcement(mock_sec_client):
    """
    Test that limit capping works correctly.
    """
    service = CompanyProfileService(sec_client=mock_sec_client)
    res = await service.get_recent_filings(320193, limit=1)
    assert res.count == 1
    assert len(res.filings) == 1

@pytest.mark.asyncio
async def test_safe_handling_of_uneven_recent_filing_arrays(mock_sec_client):
    """
    Test that mismatching array lengths are handled safely (using minimum size of required fields).
    """
    uneven_submissions = {
        "cik": "320193",
        "name": "Apple Inc.",
        "filings": {
            "recent": {
                # accessionNumber has 2 items, others have 1 item
                "accessionNumber": ["0000320193-23-000106", "0000320193-23-000001"],
                "filingDate": ["2023-11-03"],
                "form": ["10-K"],
                "primaryDocument": ["aapl-20230930.htm"],
                # Missing optional lists entirely
                "reportDate": [],
                "acceptanceDateTime": []
            }
        }
    }
    mock_sec_client.get_company_submissions = AsyncMock(return_value=uneven_submissions)
    
    service = CompanyProfileService(sec_client=mock_sec_client)
    res = await service.get_recent_filings(320193)
    
    # Minimum length of essential lists is 1 (filingDate, form, primaryDocument are length 1)
    assert res.count == 1
    assert len(res.filings) == 1
    assert res.filings[0].accession_number == "0000320193-23-000106"
    assert res.filings[0].report_date is None
    assert res.filings[0].acceptance_datetime is None

@pytest.mark.asyncio
async def test_no_mutation_of_source_sec_data(mock_sec_client):
    """
    Test that original SEC client source data is not mutated by profile parsing services.
    """
    source_copy = deepcopy(MOCK_SUBMISSIONS)
    mock_sec_client.get_company_submissions = AsyncMock(return_value=source_copy)
    
    service = CompanyProfileService(sec_client=mock_sec_client)
    await service.get_overview(320193)
    await service.get_recent_filings(320193)
    
    # Source data should be completely unchanged
    assert source_copy == MOCK_SUBMISSIONS
