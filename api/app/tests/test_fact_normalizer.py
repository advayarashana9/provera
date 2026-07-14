import pytest
from unittest.mock import AsyncMock, MagicMock
from copy import deepcopy
from app.services.fact_normalizer import FactNormalizerService

# Sample raw SEC company facts payload
MOCK_FACTS = {
    "cik": 320193,
    "entityName": "Apple Inc.",
    "facts": {
        "us-gaap": {
            "AccountsPayableCurrent": {
                "label": "Accounts Payable Current",
                "description": "Carrying value as of the balance sheet date...",
                "units": {
                    "USD": [
                        {
                            "start": "2020-09-27",
                            "end": "2021-09-25",
                            "val": 54763000000,
                            "accn": "0000320193-21-000105",
                            "fy": 2021,
                            "fp": "FY",
                            "form": "10-K",
                            "filed": "2021-10-29",
                            "frame": "CY2021"
                        },
                        {
                            "start": "2021-09-26",
                            "end": "2022-09-24",
                            "val": 64115000000,
                            "accn": "0000320193-22-000108",
                            "fy": 2022,
                            "fp": "FY",
                            "form": "10-K",
                            "filed": "2022-10-28",
                            "frame": "CY2022"
                        }
                    ]
                }
            },
            "Assets": {
                "label": "Assets",
                "description": "Sum of all assets",
                "units": {
                    "USD": [
                        {
                            "start": "2021-09-26",
                            "end": "2022-09-24",
                            "val": 352755000000,
                            "accn": "0000320193-22-000108",
                            "fy": 2022,
                            "fp": "FY",
                            "form": "10-K",
                            "filed": "2022-10-28"
                        }
                    ]
                }
            }
        },
        "dei": {
            "EntityCommonStockSharesOutstanding": {
                "label": "Entity Common Stock, Shares Outstanding",
                "description": "Outstanding shares",
                "units": {
                    "shares": [
                        {
                            "end": "2022-10-21",
                            "val": 15943425000,
                            "accn": "0000320193-22-000108",
                            "fy": 2022,
                            "fp": "FY",
                            "form": "10-K",
                            "filed": "2022-10-28"
                        }
                    ]
                }
            }
        }
    }
}

@pytest.fixture
def mock_sec_client():
    """
    Fixture returning a mock SECClient that outputs a copy of standard facts data.
    """
    client = MagicMock()
    client.get_company_facts = AsyncMock(side_effect=lambda cik: deepcopy(MOCK_FACTS))
    return client

@pytest.mark.asyncio
async def test_flattening_multiple_namespaces_and_units(mock_sec_client):
    """
    Verify parsing of different namespaces (us-gaap, dei) and different units (USD, shares).
    """
    service = FactNormalizerService(sec_client=mock_sec_client)
    res = await service.get_company_facts(320193)
    
    assert res.cik == 320193
    assert res.company_name == "Apple Inc."
    assert res.count == 4  # 2 AccountsPayableCurrent + 1 Assets + 1 SharesOutstanding
    
    namespaces = {f.namespace for f in res.facts}
    units = {f.unit for f in res.facts}
    
    assert "us-gaap" in namespaces
    assert "dei" in namespaces
    assert "USD" in units
    assert "shares" in units

@pytest.mark.asyncio
async def test_metadata_and_url_generation(mock_sec_client):
    """
    Verify metadata mapping and accurate generation of SEC Archives source URLs.
    """
    service = FactNormalizerService(sec_client=mock_sec_client)
    res = await service.get_company_facts(320193)
    
    # Check details of AccountsPayableCurrent (FY 2022)
    ap_fact = next(f for f in res.facts if f.concept == "AccountsPayableCurrent" and f.fiscal_year == 2022)
    assert ap_fact.label == "Accounts Payable Current"
    assert ap_fact.description == "Carrying value as of the balance sheet date..."
    assert ap_fact.value == 64115000000
    assert ap_fact.source_url == "https://www.sec.gov/Archives/edgar/data/320193/000032019322000108/"

@pytest.mark.asyncio
async def test_filtering_and_lowercase_support(mock_sec_client):
    """
    Verify form, unit, and concept filters operate case-insensitively.
    """
    service = FactNormalizerService(sec_client=mock_sec_client)
    
    # 1. Lowercase form filter
    res_form = await service.get_company_facts(320193, forms=["10-k"])
    assert res_form.count == 4  # All are 10-K
    
    # 2. Lowercase unit filter
    res_unit = await service.get_company_facts(320193, units=["shares"])
    assert res_unit.count == 1
    assert res_unit.facts[0].concept == "EntityCommonStockSharesOutstanding"
    
    # 3. Lowercase concept filter
    res_concept = await service.get_company_facts(320193, concepts=["assetS"])
    assert res_concept.count == 1
    assert res_concept.facts[0].concept == "Assets"

@pytest.mark.asyncio
async def test_sorting_newest_filed_first(mock_sec_client):
    """
    Verify facts are sorted from newest filed date to oldest filed date.
    """
    service = FactNormalizerService(sec_client=mock_sec_client)
    res = await service.get_company_facts(320193)
    
    filed_dates = [f.filed_date for f in res.facts if f.filed_date]
    # Check that filed dates are descending
    assert filed_dates == sorted(filed_dates, reverse=True)
    # Newest date 2022-10-28 should come before 2021-10-29
    assert filed_dates[0] == "2022-10-28"
    assert filed_dates[-1] == "2021-10-29"

@pytest.mark.asyncio
async def test_skipping_malformed_and_nonnumeric(mock_sec_client):
    """
    Verify malformed records and non-numeric value entries are skipped cleanly.
    """
    bad_data = deepcopy(MOCK_FACTS)
    
    # 1. Add non-numeric value that cannot be float-parsed
    bad_data["facts"]["us-gaap"]["Assets"]["units"]["USD"].append({
        "start": "2021-09-26",
        "end": "2022-09-24",
        "val": "NOT_A_NUMBER",
        "form": "10-K",
        "filed": "2022-10-28"
    })
    
    # 2. Add malformed fact missing the required 'end' date field
    bad_data["facts"]["us-gaap"]["Assets"]["units"]["USD"].append({
        "start": "2021-09-26",
        "val": 12345,
        "form": "10-K",
        "filed": "2022-10-28"
    })
    
    mock_sec_client.get_company_facts = AsyncMock(return_value=bad_data)
    
    service = FactNormalizerService(sec_client=mock_sec_client)
    res = await service.get_company_facts(320193)
    
    # Count should remain 4, skipping the 2 invalid items
    assert res.count == 4

@pytest.mark.asyncio
async def test_missing_optional_fields(mock_sec_client):
    """
    Verify that facts lacking optional values (like start_date, fiscal_year) parse correctly.
    """
    minimal_data = {
        "cik": 320193,
        "entityName": "Apple Inc.",
        "facts": {
            "us-gaap": {
                "MinimalConcept": {
                    "units": {
                        "USD": [
                            {
                                # Only the bare essentials: end date and numeric val
                                "end": "2022-09-24",
                                "val": 100
                            }
                        ]
                    }
                }
            }
        }
    }
    mock_sec_client.get_company_facts = AsyncMock(return_value=minimal_data)
    
    service = FactNormalizerService(sec_client=mock_sec_client)
    res = await service.get_company_facts(320193)
    
    assert res.count == 1
    f = res.facts[0]
    assert f.end_date == "2022-09-24"
    assert f.value == 100
    assert f.start_date is None
    assert f.filed_date is None
    assert f.fiscal_year is None

@pytest.mark.asyncio
async def test_limit_enforcement(mock_sec_client):
    """
    Verify limits are capped.
    """
    service = FactNormalizerService(sec_client=mock_sec_client)
    res = await service.get_company_facts(320193, limit=2)
    assert res.count == 2
    assert len(res.facts) == 2

@pytest.mark.asyncio
async def test_no_mutation_of_source_data(mock_sec_client):
    """
    Verify that executing normalizations does not mutate raw SEC data.
    """
    source_copy = deepcopy(MOCK_FACTS)
    mock_sec_client.get_company_facts = AsyncMock(return_value=source_copy)
    
    service = FactNormalizerService(sec_client=mock_sec_client)
    await service.get_company_facts(320193)
    
    assert source_copy == MOCK_FACTS

@pytest.mark.asyncio
async def test_concept_specific_endpoint_response(mock_sec_client):
    """
    Verify the output of the concept-specific endpoint lookup.
    """
    service = FactNormalizerService(sec_client=mock_sec_client)
    
    # Test lookup of us-gaap / AccountsPayableCurrent
    res = await service.get_concept_facts(320193, "us-gaap", "AccountsPayableCurrent")
    
    assert res.cik == 320193
    assert res.company_name == "Apple Inc."
    assert res.namespace == "us-gaap"
    assert res.concept == "AccountsPayableCurrent"
    assert res.label == "Accounts Payable Current"
    assert res.description == "Carrying value as of the balance sheet date..."
    assert res.count == 2
    assert len(res.facts) == 2
    
    # Test case-insensitivity on concept lookup parameters
    res_ci = await service.get_concept_facts(320193, "US-GAAP", "accountspayablecurrent")
    assert res_ci.count == 2
    assert res_ci.namespace == "us-gaap"  # Normalized to match mock keys
    assert res_ci.concept == "AccountsPayableCurrent"
