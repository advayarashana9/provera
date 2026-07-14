import pytest
from unittest.mock import AsyncMock, MagicMock
from app.services.company_search import CompanySearchService

# Mock data resembling SEC's company_tickers.json format
MOCK_TICKERS = {
    "0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."},
    "1": {"cik_str": 789019, "ticker": "MSFT", "title": "MICROSOFT CORP"},
    "2": {"cik_str": 1418091, "ticker": "AAP", "title": "Advance Auto Parts Inc"},
    "3": {"cik_str": 1000000, "ticker": "A", "title": "Agilent Technologies, Inc."},
    "4": {"cik_str": 1234567, "ticker": "APPL", "title": "Appleseed Corp"}
}

@pytest.fixture(autouse=True)
def clear_cache():
    """
    Clear the global cache before each test to ensure tests are isolated
    and mock setup works.
    """
    import app.services.company_search
    app.services.company_search._companies_cache = None

@pytest.fixture
def mock_sec_client():
    client = MagicMock()
    client.get_company_tickers = AsyncMock(return_value=MOCK_TICKERS)
    return client

@pytest.mark.asyncio
async def test_exact_ticker_match_aapl(mock_sec_client):
    service = CompanySearchService(sec_client=mock_sec_client)
    results = await service.search("AAPL")
    
    assert len(results) >= 1
    assert results[0]["ticker"] == "AAPL"
    assert results[0]["cik"] == 320193
    assert results[0]["name"] == "Apple Inc."

@pytest.mark.asyncio
async def test_lowercase_ticker_match_aapl(mock_sec_client):
    service = CompanySearchService(sec_client=mock_sec_client)
    results = await service.search("aapl")
    
    assert len(results) >= 1
    assert results[0]["ticker"] == "AAPL"

@pytest.mark.asyncio
async def test_company_name_search_apple(mock_sec_client):
    service = CompanySearchService(sec_client=mock_sec_client)
    results = await service.search("Apple")
    
    tickers = [r["ticker"] for r in results]
    assert "AAPL" in tickers
    assert "APPL" in tickers

@pytest.mark.asyncio
async def test_blank_query_rejection(mock_sec_client):
    service = CompanySearchService(sec_client=mock_sec_client)
    
    with pytest.raises(ValueError) as exc:
        await service.search("")
    assert "blank" in str(exc.value)
    
    with pytest.raises(ValueError) as exc:
        await service.search("   ")
    assert "blank" in str(exc.value)

@pytest.mark.asyncio
async def test_limit_enforcement(mock_sec_client):
    service = CompanySearchService(sec_client=mock_sec_client)
    results = await service.search("a", limit=2)
    assert len(results) <= 2

@pytest.mark.asyncio
async def test_exact_ticker_ranked_first(mock_sec_client):
    service = CompanySearchService(sec_client=mock_sec_client)
    results = await service.search("AAP")
    
    assert len(results) >= 2
    assert results[0]["ticker"] == "AAP"
    assert results[1]["ticker"] == "AAPL"

@pytest.mark.asyncio
async def test_cache_mechanism(mock_sec_client):
    service = CompanySearchService(sec_client=mock_sec_client)
    await service.search("AAPL")
    await service.search("MSFT")
    
    mock_sec_client.get_company_tickers.assert_called_once()
