import pytest
from unittest.mock import AsyncMock, MagicMock
from copy import deepcopy
from app.services.verification_engine import VerificationEngine

MOCK_BASE_FACTS = {
    "cik": 320193,
    "entityName": "Apple Inc.",
    "facts": {
        "us-gaap": {},
        "dei": {}
    }
}

def make_mock_client(facts_payload):
    client = MagicMock()
    client.get_company_facts = AsyncMock(return_value=deepcopy(facts_payload))
    return client

@pytest.mark.asyncio
async def test_balance_sheet_equation_passes():
    payload = deepcopy(MOCK_BASE_FACTS)
    payload["facts"]["us-gaap"] = {
        "Assets": {
            "units": {
                "USD": [{"end": "2022-09-24", "val": 100, "form": "10-K", "accn": "000-1"}]
            }
        },
        "LiabilitiesAndStockholdersEquity": {
            "units": {
                "USD": [{"end": "2022-09-24", "val": 100, "form": "10-K", "accn": "000-1"}]
            }
        }
    }
    client = make_mock_client(payload)
    engine = VerificationEngine(sec_client=client)
    res = await engine.verify_company(320193, limit_periods=1)
    
    assert res.checks_run == 1
    assert res.checks_passed == 1
    assert res.confirmed_inconsistencies == 0
    assert len(res.findings) == 0

@pytest.mark.asyncio
async def test_balance_sheet_equation_confirmed_inconsistency():
    payload = deepcopy(MOCK_BASE_FACTS)
    payload["facts"]["us-gaap"] = {
        "Assets": {
            "units": {
                "USD": [{"end": "2022-09-24", "val": 100, "form": "10-K", "accn": "000-1"}]
            }
        },
        "LiabilitiesAndStockholdersEquity": {
            "units": {
                "USD": [{"end": "2022-09-24", "val": 90, "form": "10-K", "accn": "000-1"}]
            }
        }
    }
    client = make_mock_client(payload)
    engine = VerificationEngine(sec_client=client)
    res = await engine.verify_company(320193, limit_periods=1)
    
    assert res.checks_run == 1
    assert res.checks_passed == 0
    assert res.confirmed_inconsistencies == 1
    assert len(res.findings) == 1
    
    f = res.findings[0]
    assert f.check_id == "BS_EQUITY"
    assert f.status == "confirmed_inconsistency"
    assert f.severity == "high"
    assert f.confidence >= 0.9
    assert f.difference == 10
    assert f.relative_difference == pytest.approx(0.1111, rel=1e-3)

@pytest.mark.asyncio
async def test_alternative_liabilities_plus_equity_equation():
    payload = deepcopy(MOCK_BASE_FACTS)
    payload["facts"]["us-gaap"] = {
        "Assets": {
            "units": {
                "USD": [{"end": "2022-09-24", "val": 100, "form": "10-K", "accn": "000-1"}]
            }
        },
        "Liabilities": {
            "units": {
                "USD": [{"end": "2022-09-24", "val": 60, "form": "10-K", "accn": "000-1"}]
            }
        },
        "StockholdersEquity": {
            "units": {
                "USD": [{"end": "2022-09-24", "val": 40, "form": "10-K", "accn": "000-1"}]
            }
        }
    }
    client = make_mock_client(payload)
    engine = VerificationEngine(sec_client=client)
    res = await engine.verify_company(320193, limit_periods=1)
    
    assert res.checks_passed == 1
    assert res.confirmed_inconsistencies == 0

@pytest.mark.asyncio
async def test_gross_profit_passes():
    payload = deepcopy(MOCK_BASE_FACTS)
    payload["facts"]["us-gaap"] = {
        "GrossProfit": {
            "units": {
                "USD": [{"start": "2021-09-26", "end": "2022-09-24", "val": 50, "form": "10-K", "accn": "000-1"}]
            }
        },
        "Revenues": {
            "units": {
                "USD": [{"start": "2021-09-26", "end": "2022-09-24", "val": 120, "form": "10-K", "accn": "000-1"}]
            }
        },
        "CostOfRevenue": {
            "units": {
                "USD": [{"start": "2021-09-26", "end": "2022-09-24", "val": 70, "form": "10-K", "accn": "000-1"}]
            }
        }
    }
    client = make_mock_client(payload)
    engine = VerificationEngine(sec_client=client)
    res = await engine.verify_company(320193, limit_periods=1)
    
    # BS check is skipped, but GP check runs and passes
    assert res.checks_run == 1
    assert res.checks_passed == 1

@pytest.mark.asyncio
async def test_gross_profit_inconsistency():
    payload = deepcopy(MOCK_BASE_FACTS)
    payload["facts"]["us-gaap"] = {
        "GrossProfit": {
            "units": {
                "USD": [{"start": "2021-09-26", "end": "2022-09-24", "val": 50, "form": "10-K", "accn": "000-1"}]
            }
        },
        "Revenues": {
            "units": {
                "USD": [{"start": "2021-09-26", "end": "2022-09-24", "val": 120, "form": "10-K", "accn": "000-1"}]
            }
        },
        "CostOfRevenue": {
            "units": {
                "USD": [{"start": "2021-09-26", "end": "2022-09-24", "val": 60, "form": "10-K", "accn": "000-1"}]
            }
        }
    }
    client = make_mock_client(payload)
    engine = VerificationEngine(sec_client=client)
    res = await engine.verify_company(320193, limit_periods=1)
    
    assert res.checks_run == 1
    assert res.confirmed_inconsistencies == 1
    assert len(res.findings) == 1
    assert res.findings[0].check_id == "GROSS_PROFIT"
    assert res.findings[0].status == "confirmed_inconsistency"

@pytest.mark.asyncio
async def test_alternative_revenue_and_cost_concepts():
    payload = deepcopy(MOCK_BASE_FACTS)
    payload["facts"]["us-gaap"] = {
        "GrossProfit": {
            "units": {
                "USD": [{"start": "2021-09-26", "end": "2022-09-24", "val": 60, "form": "10-K", "accn": "000-1"}]
            }
        },
        "RevenueFromContractWithCustomerExcludingAssessedTax": {
            "units": {
                "USD": [{"start": "2021-09-26", "end": "2022-09-24", "val": 100, "form": "10-K", "accn": "000-1"}]
            }
        },
        "CostOfGoodsSold": {
            "units": {
                "USD": [{"start": "2021-09-26", "end": "2022-09-24", "val": 40, "form": "10-K", "accn": "000-1"}]
            }
        }
    }
    client = make_mock_client(payload)
    engine = VerificationEngine(sec_client=client)
    res = await engine.verify_company(320193, limit_periods=1)
    
    assert res.checks_passed == 1
    assert res.confirmed_inconsistencies == 0

@pytest.mark.asyncio
async def test_operating_income_passes():
    payload = deepcopy(MOCK_BASE_FACTS)
    payload["facts"]["us-gaap"] = {
        "OperatingIncomeLoss": {
            "units": {
                "USD": [{"start": "2021-09-26", "end": "2022-09-24", "val": 20, "form": "10-K", "accn": "000-1"}]
            }
        },
        "GrossProfit": {
            "units": {
                "USD": [{"start": "2021-09-26", "end": "2022-09-24", "val": 60, "form": "10-K", "accn": "000-1"}]
            }
        },
        "OperatingExpenses": {
            "units": {
                "USD": [{"start": "2021-09-26", "end": "2022-09-24", "val": 40, "form": "10-K", "accn": "000-1"}]
            }
        }
    }
    client = make_mock_client(payload)
    engine = VerificationEngine(sec_client=client)
    res = await engine.verify_company(320193, limit_periods=1)
    
    assert res.checks_run == 1
    assert res.checks_passed == 1

@pytest.mark.asyncio
async def test_cash_comparison_passes():
    payload = deepcopy(MOCK_BASE_FACTS)
    payload["facts"]["us-gaap"] = {
        "CashAndCashEquivalentsAtCarryingValue": {
            "units": {
                "USD": [{"end": "2022-09-24", "val": 100, "form": "10-K", "accn": "000-1"}]
            }
        },
        "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents": {
            "units": {
                "USD": [{"end": "2022-09-24", "val": 100, "form": "10-K", "accn": "000-1"}]
            }
        }
    }
    client = make_mock_client(payload)
    engine = VerificationEngine(sec_client=client)
    res = await engine.verify_company(320193, limit_periods=1)
    
    assert res.checks_run == 1
    assert res.checks_passed == 1

@pytest.mark.asyncio
async def test_restricted_cash_ambiguity_becomes_review_item():
    payload = deepcopy(MOCK_BASE_FACTS)
    payload["facts"]["us-gaap"] = {
        "CashAndCashEquivalentsAtCarryingValue": {
            "units": {
                "USD": [{"end": "2022-09-24", "val": 100, "form": "10-K", "accn": "000-1"}]
            }
        },
        "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents": {
            "units": {
                "USD": [{"end": "2022-09-24", "val": 95, "form": "10-K", "accn": "000-1"}]
            }
        }
    }
    client = make_mock_client(payload)
    engine = VerificationEngine(sec_client=client)
    res = await engine.verify_company(320193, limit_periods=1)
    
    assert res.checks_run == 1
    assert res.checks_passed == 0
    assert res.review_items == 1
    assert len(res.findings) == 1
    
    f = res.findings[0]
    assert f.check_id == "CASH_CONSISTENCY"
    assert f.status == "review_item"
    assert f.confidence < 0.9

@pytest.mark.asyncio
async def test_net_income_duplicate_consistency():
    payload = deepcopy(MOCK_BASE_FACTS)
    payload["facts"]["us-gaap"] = {
        "NetIncomeLoss": {
            "units": {
                "USD": [
                    {"start": "2021-09-26", "end": "2022-09-24", "val": 50, "form": "10-K", "accn": "000-1", "fy": 2022, "fp": "FY"},
                    {"start": "2021-09-26", "end": "2022-09-24", "val": 45, "form": "10-K", "accn": "000-1", "fy": 2022, "fp": "FY"}
                ]
            }
        }
    }
    client = make_mock_client(payload)
    engine = VerificationEngine(sec_client=client)
    res = await engine.verify_company(320193, limit_periods=1)
    
    assert res.checks_run == 1
    assert res.confirmed_inconsistencies == 1
    assert len(res.findings) == 1
    assert res.findings[0].check_id == "NET_INCOME_DUPLICATE"

@pytest.mark.asyncio
async def test_incompatible_periods_and_units_are_skipped():
    payload = deepcopy(MOCK_BASE_FACTS)
    payload["facts"]["us-gaap"] = {
        "Assets": {
            "units": {
                "USD": [{"end": "2022-09-24", "val": 100, "form": "10-K", "accn": "000-1"}]
            }
        },
        "LiabilitiesAndStockholdersEquity": {
            "units": {
                "shares": [{"end": "2022-09-24", "val": 100, "form": "10-K", "accn": "000-1"}]
            }
        }
    }
    client = make_mock_client(payload)
    engine = VerificationEngine(sec_client=client)
    res = await engine.verify_company(320193, limit_periods=1)
    
    # Mismatched units: check is skipped (no compatible assets + liab_eq group found)
    assert res.checks_run == 0
    assert res.skipped_checks >= 1

@pytest.mark.asyncio
async def test_quarterly_and_annual_facts_are_not_mixed():
    payload = deepcopy(MOCK_BASE_FACTS)
    # 10-K and 10-Q report under different form/accession, so they are grouped separately.
    payload["facts"]["us-gaap"] = {
        "Assets": {
            "units": {
                "USD": [{"end": "2022-09-24", "val": 100, "form": "10-K", "accn": "000-1"}]
            }
        },
        "LiabilitiesAndStockholdersEquity": {
            "units": {
                "USD": [{"end": "2022-09-24", "val": 90, "form": "10-Q", "accn": "000-2"}]
            }
        }
    }
    client = make_mock_client(payload)
    engine = VerificationEngine(sec_client=client)
    res = await engine.verify_company(320193, limit_periods=1)
    
    # They should not be combined to make a finding. Each group is missing the other side, so both skipped.
    assert res.checks_run == 0

@pytest.mark.asyncio
async def test_tolerance_handling():
    payload = deepcopy(MOCK_BASE_FACTS)
    payload["facts"]["us-gaap"] = {
        "Assets": {
            "units": {
                "USD": [{"end": "2022-09-24", "val": 1000000, "form": "10-K", "accn": "000-1"}]
            }
        },
        "LiabilitiesAndStockholdersEquity": {
            "units": {
                "USD": [{"end": "2022-09-24", "val": 1000050, "form": "10-K", "accn": "000-1"}]
            }
        }
    }
    client = make_mock_client(payload)
    engine = VerificationEngine(sec_client=client)
    res = await engine.verify_company(320193, limit_periods=1)
    
    # Difference (50) is within absolute tolerance (max(1, 1000050 * 0.0001) = 100.005) -> passes!
    assert res.checks_run == 1
    assert res.checks_passed == 1
    assert res.confirmed_inconsistencies == 0

@pytest.mark.asyncio
async def test_missing_and_malformed_facts_skipped_safely():
    payload = deepcopy(MOCK_BASE_FACTS)
    payload["facts"]["us-gaap"] = {
        "Assets": {
            "units": {
                "USD": [
                    {"end": "2022-09-24", "val": "MALFORMED_NONNUMERIC", "form": "10-K", "accn": "000-1"},
                    {"val": 100, "form": "10-K", "accn": "000-1"} # Missing end date
                ]
            }
        }
    }
    client = make_mock_client(payload)
    engine = VerificationEngine(sec_client=client)
    res = await engine.verify_company(320193, limit_periods=1)
    
    # Should not compile any check due to invalid facts being filtered out
    assert res.checks_run == 0

@pytest.mark.asyncio
async def test_prohibited_accusation_language():
    payload = deepcopy(MOCK_BASE_FACTS)
    payload["facts"]["us-gaap"] = {
        "Assets": {
            "units": {
                "USD": [{"end": "2022-09-24", "val": 100, "form": "10-K", "accn": "000-1"}]
            }
        },
        "LiabilitiesAndStockholdersEquity": {
            "units": {
                "USD": [{"end": "2022-09-24", "val": 90, "form": "10-K", "accn": "000-1"}]
            }
        }
    }
    client = make_mock_client(payload)
    engine = VerificationEngine(sec_client=client)
    res = await engine.verify_company(320193, limit_periods=1)
    
    assert len(res.findings) > 0
    prohibited = ["fraud", "fraudulent", "manipulation", "misconduct"]
    for f in res.findings:
        text = f.explanation.lower()
        for exp in f.possible_explanations:
            text += " " + exp.lower()
        for word in prohibited:
            assert word not in text

@pytest.mark.asyncio
async def test_no_mutation_of_source_data():
    payload = deepcopy(MOCK_BASE_FACTS)
    payload["facts"]["us-gaap"] = {
        "Assets": {
            "units": {
                "USD": [{"end": "2022-09-24", "val": 100, "form": "10-K", "accn": "000-1"}]
            }
        }
    }
    payload_copy = deepcopy(payload)
    client = make_mock_client(payload)
    engine = VerificationEngine(sec_client=client)
    await engine.verify_company(320193, limit_periods=1)
    
    assert payload == payload_copy

@pytest.mark.asyncio
async def test_newest_period_sorting():
    payload = deepcopy(MOCK_BASE_FACTS)
    payload["facts"]["us-gaap"] = {
        "Assets": {
            "units": {
                "USD": [
                    {"end": "2021-09-25", "val": 100, "form": "10-K", "accn": "000-1"},
                    {"end": "2022-09-24", "val": 100, "form": "10-K", "accn": "000-2"}
                ]
            }
        },
        "LiabilitiesAndStockholdersEquity": {
            "units": {
                "USD": [
                    {"end": "2021-09-25", "val": 90, "form": "10-K", "accn": "000-1"},
                    {"end": "2022-09-24", "val": 80, "form": "10-K", "accn": "000-2"}
                ]
            }
        }
    }
    client = make_mock_client(payload)
    engine = VerificationEngine(sec_client=client)
    res = await engine.verify_company(320193, limit_periods=2)
    
    assert len(res.findings) == 2
    # Newest period 2022-09-24 should be sorted first!
    assert res.findings[0].period_end == "2022-09-24"
    assert res.findings[1].period_end == "2021-09-25"
