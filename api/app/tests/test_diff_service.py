from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app.main import app
from app.services.diff_service import FilingDiffService
from app.models.company import FilingSummary
from app.models.diff import FilingDiffRequest, FilingDiffResponse
from app.models.financial_fact import NormalizedFinancialFact

client = TestClient(app)

# Helper to generate mock filing summary
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

# Helper to generate dummy facts
def make_fact(concept, value, year=None, end_date="2023-09-30", start_date=None, unit="USD", accession="000-1"):
    return NormalizedFinancialFact(
        namespace="us-gaap",
        concept=concept,
        value=value,
        unit=unit,
        start_date=start_date,
        end_date=end_date,
        filed_date="2023-10-15",
        form="10-K",
        fiscal_year=year,
        fiscal_period="FY",
        accession_number=accession,
        source_url="http://sec.gov"
    )

# =====================================================================
# Validation Tests
# =====================================================================

@pytest.mark.asyncio
async def test_accession_validation():
    service = FilingDiffService()
    
    # Mock filings: only one exists
    mock_recent = MagicMock()
    mock_recent.filings = [make_filing("acc-1", form="10-K")]
    
    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        req = FilingDiffRequest(older_accession_number="acc-1", newer_accession_number="acc-invalid")
        with pytest.raises(HTTPException) as exc_info:
            await service.compare_filings(320193, req)
        assert exc_info.value.status_code == 400
        assert "invalid or does not belong" in exc_info.value.detail

@pytest.mark.asyncio
async def test_incompatible_form_rejection():
    service = FilingDiffService()
    
    # Mock filings: different forms (10-K vs 10-Q)
    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("acc-older", form="10-K"),
        make_filing("acc-newer", form="10-Q")
    ]
    
    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        req = FilingDiffRequest(older_accession_number="acc-older", newer_accession_number="acc-newer")
        with pytest.raises(HTTPException) as exc_info:
            await service.compare_filings(320193, req)
        assert exc_info.value.status_code == 400
        assert "Incompatible filing forms" in exc_info.value.detail

# =====================================================================
# Accession Normalization Tests
# =====================================================================

def test_norm_dashed_accession():
    """Dashed and non-dashed forms of the same accession must normalize to equal values."""
    dashed   = "0001045810-25-000230"
    no_dash  = "000104581025000230"
    # Both strip to 18 digits
    assert dashed.replace("-", "") == no_dash

def test_norm_leading_zeros_preserved():
    """Leading zeros must be preserved in the raw accession_number."""
    acc = "0001045810-25-000230"
    stripped = acc.replace("-", "")
    assert stripped.startswith("0001"), "Leading zeros must not be removed"
    assert len(stripped) == 18

def test_norm_malformed_accession_rejected():
    """An accession with fewer than 18 digits after stripping dashes is malformed."""
    bad = "1045810-25-230"
    stripped = bad.replace("-", "")
    assert len(stripped) < 18, "Malformed accession should have fewer than 18 digits"

@pytest.mark.asyncio
async def test_dashed_accession_matches_stored_dashed():
    """Backend must match a dashed request against dashed stored accessions."""
    service = FilingDiffService()

    stored_acc = "0001045810-26-000052"          # dashed — as returned by SEC EDGAR
    request_acc = "0001045810-26-000052"          # identical dashed form

    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing(stored_acc, form="10-Q", report_date="2025-10-27"),
        make_filing("0001045810-25-000104", form="10-Q", report_date="2025-04-27"),
    ]

    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=MagicMock(facts=[], company_name="NVIDIA"))):
            with patch.object(service, 'get_filing_section_content', AsyncMock(return_value="")):
                req = FilingDiffRequest(
                    older_accession_number="0001045810-25-000104",
                    newer_accession_number=request_acc,
                )
                # Should not raise 400 — both accessions belong to the mocked company
                result = await service.compare_filings(1045810, req)
                assert result.cik == 1045810

@pytest.mark.asyncio
async def test_unrelated_company_accession_rejected():
    """An accession that belongs to a different company must be rejected."""
    service = FilingDiffService()

    # Company A filings
    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("0000320193-23-000077", form="10-K"),   # Apple
        make_filing("0000320193-23-000064", form="10-K"),   # Apple
    ]

    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        # newer_accession belongs to NVIDIA, not Apple
        req = FilingDiffRequest(
            older_accession_number="0000320193-23-000077",
            newer_accession_number="0001045810-25-000230",   # NVIDIA accession
        )
        with pytest.raises(HTTPException) as exc_info:
            await service.compare_filings(320193, req)
        assert exc_info.value.status_code == 400
        assert "invalid or does not belong" in exc_info.value.detail

@pytest.mark.asyncio
async def test_nvidia_known_regression_accession_rejected_when_absent():
    """The known NVIDIA regression: 0001045810-25-000230 must be rejected if not in the
    company's validated 10-K/10-Q filings (it was absent from the first 100 filtered filings)."""
    service = FilingDiffService()

    # Simulate what backend now fetches: 10-K/10-Q only, limit=100
    # The NVIDIA 2025 10-Q that caused the regression is NOT present in this list
    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("0001045810-26-000052", form="10-Q"),
        make_filing("0001045810-26-000021", form="10-K"),
    ]

    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        req = FilingDiffRequest(
            older_accession_number="0001045810-25-000230",   # regression accession
            newer_accession_number="0001045810-26-000052",
        )
        with pytest.raises(HTTPException) as exc_info:
            await service.compare_filings(1045810, req)
        assert exc_info.value.status_code == 400
        assert "invalid or does not belong" in exc_info.value.detail

@pytest.mark.asyncio
async def test_duplicate_accessions_do_not_cause_double_match():
    """Duplicate accession entries in the filings list must not cause incorrect validation."""
    service = FilingDiffService()

    acc = "0001045810-26-000052"
    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing(acc, form="10-Q", report_date="2025-10-27"),
        make_filing(acc, form="10-Q", report_date="2025-10-27"),  # duplicate
        make_filing("0001045810-26-000021", form="10-K"),
    ]

    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        req = FilingDiffRequest(
            older_accession_number=acc,
            newer_accession_number=acc,
        )
        with pytest.raises(HTTPException) as exc_info:
            await service.compare_filings(1045810, req)
        # Must reject comparing a filing with itself, not crash
        assert exc_info.value.status_code == 400
        assert "Cannot compare a filing with itself" in exc_info.value.detail

@pytest.mark.asyncio
async def test_valid_10q_comparison_succeeds():
    """Two valid 10-Q filings from the same company must succeed validation."""
    service = FilingDiffService()

    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("0000320193-23-000077", form="10-Q", report_date="2023-07-01"),
        make_filing("0000320193-22-000070", form="10-Q", report_date="2022-06-25"),
    ]

    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=MagicMock(facts=[], company_name="Apple"))):
            with patch.object(service, 'get_filing_section_content', AsyncMock(return_value="")):
                req = FilingDiffRequest(
                    older_accession_number="0000320193-22-000070",
                    newer_accession_number="0000320193-23-000077",
                )
                result = await service.compare_filings(320193, req)
                assert result.cik == 320193

@pytest.mark.asyncio
async def test_valid_10k_comparison_succeeds():
    """Two valid 10-K filings from the same company must succeed validation."""
    service = FilingDiffService()

    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("0001045810-26-000021", form="10-K", report_date="2026-01-26"),
        make_filing("0001045810-25-000037", form="10-K", report_date="2025-01-26"),
    ]

    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=MagicMock(facts=[], company_name="NVIDIA"))):
            with patch.object(service, 'get_filing_section_content', AsyncMock(return_value="")):
                req = FilingDiffRequest(
                    older_accession_number="0001045810-25-000037",
                    newer_accession_number="0001045810-26-000021",
                )
                result = await service.compare_filings(1045810, req)
                assert result.cik == 1045810

@pytest.mark.asyncio
async def test_stale_state_accession_from_different_company_rejected():
    """Simulates navigating from Apple to NVIDIA: an Apple accession must be rejected for NVIDIA's CIK."""
    service = FilingDiffService()

    # NVIDIA's validated 10-K/10-Q pool
    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("0001045810-26-000052", form="10-Q"),
        make_filing("0001045810-26-000021", form="10-K"),
    ]

    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        # Stale Apple accession still in state from previous page
        req = FilingDiffRequest(
            older_accession_number="0000320193-23-000077",   # Apple
            newer_accession_number="0001045810-26-000052",   # NVIDIA
        )
        with pytest.raises(HTTPException) as exc_info:
            await service.compare_filings(1045810, req)
        assert exc_info.value.status_code == 400
        assert "invalid or does not belong" in exc_info.value.detail

# =====================================================================
# Deterministic Diff and Text Calculations
# =====================================================================

@pytest.mark.asyncio
async def test_deterministic_metric_calculations():
    service = FilingDiffService()
    
    # Setup filings
    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("acc-older", form="10-K", report_date="2022-09-30"),
        make_filing("acc-newer", form="10-K", report_date="2023-09-30")
    ]
    
    # Setup facts (Revenues changes from 4000 to 5000)
    mock_facts_res = MagicMock()
    mock_facts_res.company_name = "Apple Inc."
    mock_facts_res.facts = [
        make_fact("Revenues", 4000.0, 2022, end_date="2022-09-30", accession="acc-older"),
        make_fact("Revenues", 5000.0, 2023, end_date="2023-09-30", accession="acc-newer"),
        # Incompatible units fact
        make_fact("Assets", 300.0, 2022, end_date="2022-09-30", unit="EUR", accession="acc-older"),
        make_fact("Assets", 300.0, 2023, end_date="2023-09-30", unit="USD", accession="acc-newer"),
        # Unchanged fact (should be omitted)
        make_fact("Cash", 1000.0, 2022, end_date="2022-09-30", accession="acc-older"),
        make_fact("Cash", 1000.0, 2023, end_date="2023-09-30", accession="acc-newer"),
    ]
    
    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=mock_facts_res)):
            with patch.object(service, 'get_filing_section_content', AsyncMock(return_value="")):
                req = FilingDiffRequest(older_accession_number="acc-older", newer_accession_number="acc-newer")
                res = await service.compare_filings(320193, req)
                
                # Check metrics change count (only Revenues changed)
                assert len(res.metric_changes) == 1
                change = res.metric_changes[0]
                assert change.concept == "Revenues"
                assert change.older_value == 4000.0
                assert change.newer_value == 5000.0
                assert change.absolute_change == 1000.0
                assert change.percentage_change == pytest.approx(0.25)
                
                # Check unchanged was omitted and incompatible units was excluded
                concepts_changed = [m.concept for m in res.metric_changes]
                assert "Cash" not in concepts_changed
                assert "Assets" not in concepts_changed

def test_added_removed_changed_text_detection():
    service = FilingDiffService()
    
    # 1. Test Unchanged text
    ch_type, summary, _, _ = service.compare_texts_deterministically("Same text", "Same text")
    assert ch_type == "unchanged"

    # 2. Test Added text
    ch_type, summary, _, _ = service.compare_texts_deterministically("", "New risk text")
    assert ch_type == "added"
    assert "New risk text" in summary or "added" in summary.lower()

    # 3. Test Removed text
    ch_type, summary, _, _ = service.compare_texts_deterministically("Old risk text", "")
    assert ch_type == "removed"
    assert "Old risk text" in summary or "removed" in summary.lower()

    # 4. Test Modified/Changed text
    ch_type, summary, _, _ = service.compare_texts_deterministically(
        "Company faces risks of inflation",
        "Company faces risks of inflation and global conflict"
    )
    assert ch_type == "modified"
    assert "Added" in summary

# =====================================================================
# Gemini Fallback and Prohibited Language Checks
# =====================================================================

@pytest.mark.asyncio
async def test_gemini_unavailable_fallback():
    # Force Gemini unavailable
    service = FilingDiffService()
    service.client = None
    assert not service.is_available()
    
    # Setup filings and facts
    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("acc-older", form="10-K", report_date="2022-09-30"),
        make_filing("acc-newer", form="10-K", report_date="2023-09-30")
    ]
    mock_facts_res = MagicMock()
    mock_facts_res.company_name = "Apple Inc."
    mock_facts_res.facts = []
    
    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=mock_facts_res)):
            req = FilingDiffRequest(older_accession_number="acc-older", newer_accession_number="acc-newer")
            res = await service.compare_filings(320193, req)
            
            # generated_summary should be None
            assert res.generated_summary is None
            # Excerpts and section changes are still calculated deterministically
            assert len(res.section_changes) > 0
            assert res.section_changes[0].older_excerpt is not None

def test_no_prohibited_accusation_language():
    # Verify mock fallback texts contain no accusation language (fraud, manipulation, deception, cooking the books)
    service = FilingDiffService()
    prohibited = ["fraud", "manipulation", "deception", "cook the books", "intentional wrongdoing", "bad faith"]
    
    for sec in ["Risk Factors", "Management’s Discussion and Analysis", "Legal Proceedings"]:
        t_old = service.get_fallback_section_text("Test", "acc-old", sec)
        t_new = service.get_fallback_section_text("Test", "acc-new", sec)
        for term in prohibited:
            assert term not in t_old.lower()
            assert term not in t_new.lower()

# =====================================================================
# API Endpoints
# =====================================================================

def test_api_same_company_validation():
    # In api call, if older and newer accession are the same, should return 400
    response = client.post("/companies/320193/filing-diff", json={
        "older_accession_number": "same-acc",
        "newer_accession_number": "same-acc"
    })
    assert response.status_code == 400
    assert "with itself" in response.json()["detail"].lower()


# =====================================================================
# Filing Diff Enhancements Integration Tests
# =====================================================================

@pytest.mark.asyncio
async def test_sequential_10q_instant_matching():
    service = FilingDiffService()
    service.client = None # Gemini unavailable fallback
    
    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("acc-older", form="10-Q", report_date="2023-03-31"),
        make_filing("acc-newer", form="10-Q", report_date="2023-06-30")
    ]
    
    mock_facts_res = MagicMock()
    mock_facts_res.company_name = "Apple Inc."
    mock_facts_res.facts = [
        make_fact("Assets", 100.0, end_date="2023-03-31", accession="acc-older", start_date=None),
        make_fact("Assets", 150.0, end_date="2023-06-30", accession="acc-newer", start_date=None)
    ]
    
    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=mock_facts_res)):
            with patch.object(service, 'get_filing_section_content', AsyncMock(return_value="")):
                req = FilingDiffRequest(older_accession_number="acc-older", newer_accession_number="acc-newer")
                res = await service.compare_filings(320193, req)
                
                assert len(res.metric_changes) == 1
                change = res.metric_changes[0]
                assert change.concept == "Assets"
                assert change.older_value == 100.0
                assert change.newer_value == 150.0


@pytest.mark.asyncio
async def test_sequential_10q_duration_matching():
    service = FilingDiffService()
    service.client = None
    
    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("acc-older", form="10-Q", report_date="2023-03-31"),
        make_filing("acc-newer", form="10-Q", report_date="2023-06-30")
    ]
    
    mock_facts_res = MagicMock()
    mock_facts_res.company_name = "Apple Inc."
    mock_facts_res.facts = [
        make_fact("Revenues", 500.0, start_date="2023-01-01", end_date="2023-03-31", accession="acc-older"),
        make_fact("Revenues", 600.0, start_date="2023-04-01", end_date="2023-06-30", accession="acc-newer")
    ]
    
    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=mock_facts_res)):
            with patch.object(service, 'get_filing_section_content', AsyncMock(return_value="")):
                req = FilingDiffRequest(older_accession_number="acc-older", newer_accession_number="acc-newer")
                res = await service.compare_filings(320193, req)
                
                assert len(res.metric_changes) == 1
                change = res.metric_changes[0]
                assert change.concept == "Revenues"
                assert change.older_value == 500.0
                assert change.newer_value == 600.0


@pytest.mark.asyncio
async def test_quarterly_values_not_mixed_with_ytd():
    service = FilingDiffService()
    service.client = None
    
    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("acc-older", form="10-Q", report_date="2023-03-31"),
        make_filing("acc-newer", form="10-Q", report_date="2023-06-30")
    ]
    
    # In newer facts, we have both a 3-month (quarter) fact and a 6-month (YTD) fact.
    mock_facts_res = MagicMock()
    mock_facts_res.company_name = "Apple Inc."
    mock_facts_res.facts = [
        # Older Q1: 3-month (90 days)
        make_fact("Revenues", 500.0, start_date="2023-01-01", end_date="2023-03-31", accession="acc-older"),
        # Newer Q2: 3-month (90 days) - compatible duration
        make_fact("Revenues", 600.0, start_date="2023-04-01", end_date="2023-06-30", accession="acc-newer"),
        # Newer YTD: 6-month (180 days) - incompatible duration (should not be paired with Q1's 90-day duration)
        make_fact("Revenues", 1100.0, start_date="2023-01-01", end_date="2023-06-30", accession="acc-newer")
    ]
    
    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=mock_facts_res)):
            with patch.object(service, 'get_filing_section_content', AsyncMock(return_value="")):
                req = FilingDiffRequest(older_accession_number="acc-older", newer_accession_number="acc-newer")
                res = await service.compare_filings(320193, req)
                
                assert len(res.metric_changes) == 1
                change = res.metric_changes[0]
                assert change.concept == "Revenues"
                # Should match the 3-month to 3-month (500 to 600)
                assert change.older_value == 500.0
                assert change.newer_value == 600.0


@pytest.mark.asyncio
async def test_repeated_comparative_facts_excluded():
    service = FilingDiffService()
    service.client = None
    
    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("acc-older", form="10-Q", report_date="2023-03-31"),
        make_filing("acc-newer", form="10-Q", report_date="2023-06-30")
    ]
    
    mock_facts_res = MagicMock()
    mock_facts_res.company_name = "Apple Inc."
    mock_facts_res.facts = [
        # Original older Assets
        make_fact("Assets", 100.0, end_date="2023-03-31", accession="acc-older", start_date=None),
        # Repeated comparative Assets for Q1 inside the newer Q2 filing (should be ignored / excluded as duplicate)
        make_fact("Assets", 100.0, end_date="2023-03-31", accession="acc-newer", start_date=None),
        # Original newer Assets
        make_fact("Assets", 120.0, end_date="2023-06-30", accession="acc-newer", start_date=None)
    ]
    
    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=mock_facts_res)):
            with patch.object(service, 'get_filing_section_content', AsyncMock(return_value="")):
                req = FilingDiffRequest(older_accession_number="acc-older", newer_accession_number="acc-newer")
                res = await service.compare_filings(320193, req)
                
                # Should match Assets and return exactly 1 change
                assert len(res.metric_changes) == 1
                change = res.metric_changes[0]
                assert change.concept == "Assets"
                assert change.older_value == 100.0
                assert change.newer_value == 120.0


@pytest.mark.asyncio
async def test_multiple_changed_metrics_returned():
    service = FilingDiffService()
    service.client = None
    
    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("acc-older", form="10-K", report_date="2022-09-30"),
        make_filing("acc-newer", form="10-K", report_date="2023-09-30")
    ]
    
    mock_facts_res = MagicMock()
    mock_facts_res.company_name = "Apple Inc."
    mock_facts_res.facts = [
        make_fact("Revenues", 1000.0, end_date="2022-09-30", accession="acc-older", start_date=None),
        make_fact("Revenues", 1200.0, end_date="2023-09-30", accession="acc-newer", start_date=None),
        make_fact("NetIncomeLoss", 200.0, end_date="2022-09-30", accession="acc-older", start_date=None),
        make_fact("NetIncomeLoss", 250.0, end_date="2023-09-30", accession="acc-newer", start_date=None),
        make_fact("Assets", 5000.0, end_date="2022-09-30", accession="acc-older", start_date=None),
        make_fact("Assets", 5500.0, end_date="2023-09-30", accession="acc-newer", start_date=None)
    ]
    
    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=mock_facts_res)):
            with patch.object(service, 'get_filing_section_content', AsyncMock(return_value="")):
                req = FilingDiffRequest(older_accession_number="acc-older", newer_accession_number="acc-newer")
                res = await service.compare_filings(320193, req)
                
                assert len(res.metric_changes) == 3
                concepts = {m.concept for m in res.metric_changes}
                assert concepts == {"Revenues", "NetIncomeLoss", "Assets"}


@pytest.mark.asyncio
async def test_materiality_sorting():
    service = FilingDiffService()
    service.client = None
    
    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("acc-older", form="10-K", report_date="2022-09-30"),
        make_filing("acc-newer", form="10-K", report_date="2023-09-30")
    ]
    
    mock_facts_res = MagicMock()
    mock_facts_res.company_name = "Apple Inc."
    mock_facts_res.facts = [
        # CustomConcept has a massive 900% change, but is NOT a prioritized common concept
        make_fact("CustomConcept", 10.0, end_date="2022-09-30", accession="acc-older", start_date=None),
        make_fact("CustomConcept", 100.0, end_date="2023-09-30", accession="acc-newer", start_date=None),
        # Revenues has a small 10% change, but IS a prioritized common concept
        make_fact("Revenues", 1000.0, end_date="2022-09-30", accession="acc-older", start_date=None),
        make_fact("Revenues", 1100.0, end_date="2023-09-30", accession="acc-newer", start_date=None)
    ]
    
    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=mock_facts_res)):
            with patch.object(service, 'get_filing_section_content', AsyncMock(return_value="")):
                req = FilingDiffRequest(older_accession_number="acc-older", newer_accession_number="acc-newer")
                res = await service.compare_filings(320193, req)
                
                assert len(res.metric_changes) == 2
                # Revenues must be first due to prioritization
                assert res.metric_changes[0].concept == "Revenues"
                assert res.metric_changes[1].concept == "CustomConcept"


@pytest.mark.asyncio
async def test_key_takeaway_generation_and_gemini_fallback():
    service = FilingDiffService()
    service.client = None # Force Gemini unavailable to verify fallback
    
    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("acc-older", form="10-K", report_date="2022-09-30"),
        make_filing("acc-newer", form="10-K", report_date="2023-09-30")
    ]
    
    mock_facts_res = MagicMock()
    mock_facts_res.company_name = "Apple Inc."
    mock_facts_res.facts = [
        make_fact("Revenues", 1000.0, end_date="2022-09-30", accession="acc-older", start_date=None),
        make_fact("Revenues", 1200.0, end_date="2023-09-30", accession="acc-newer", start_date=None)
    ]
    
    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=mock_facts_res)):
            with patch.object(service, 'get_filing_section_content', AsyncMock(return_value="Mock section text")):
                req = FilingDiffRequest(older_accession_number="acc-older", newer_accession_number="acc-newer")
                res = await service.compare_filings(320193, req)
                
                assert len(res.key_takeaways) > 0
                assert len(res.key_takeaways) <= 5
                # Verify it contains metric change details
                assert any("Revenues" in t for t in res.key_takeaways)


def test_no_literal_nearr_in_frontend():
    import os
    current_dir = os.path.dirname(os.path.abspath(__file__))
    workspace_root = os.path.abspath(os.path.join(current_dir, "../../../"))
    path = os.path.join(workspace_root, "web/src/app/company/[cik]/FilingDiff.tsx")
    assert os.path.exists(path)
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    assert "&nearr;" not in content


@pytest.mark.asyncio
async def test_percentage_change_corrections():
    service = FilingDiffService()
    service.client = None
    
    mock_recent = MagicMock()
    mock_recent.filings = [
        make_filing("acc-older", form="10-K", report_date="2022-09-30"),
        make_filing("acc-newer", form="10-K", report_date="2023-09-30")
    ]
    
    mock_facts_res = MagicMock()
    mock_facts_res.company_name = "Apple Inc."
    mock_facts_res.facts = [
        # Case 1: Prior value is zero
        make_fact("Assets", 0.0, end_date="2022-09-30", accession="acc-older", start_date=None),
        make_fact("Assets", 100.0, end_date="2023-09-30", accession="acc-newer", start_date=None),
        # Case 2: Prior value is negative
        make_fact("NetIncomeLoss", -50.0, end_date="2022-09-30", accession="acc-older", start_date=None),
        make_fact("NetIncomeLoss", -100.0, end_date="2023-09-30", accession="acc-newer", start_date=None),
        # Case 3: Values cross signs (positive to negative)
        make_fact("Revenues", 50.0, end_date="2022-09-30", accession="acc-older", start_date=None),
        make_fact("Revenues", -10.0, end_date="2023-09-30", accession="acc-newer", start_date=None)
    ]
    
    with patch.object(service.profile_service, 'get_recent_filings', AsyncMock(return_value=mock_recent)):
        with patch.object(service.fact_normalizer, 'get_company_facts', AsyncMock(return_value=mock_facts_res)):
            with patch.object(service, 'get_filing_section_content', AsyncMock(return_value="")):
                req = FilingDiffRequest(older_accession_number="acc-older", newer_accession_number="acc-newer")
                res = await service.compare_filings(320193, req)
                
                assert len(res.metric_changes) == 3
                
                assets_change = next(m for m in res.metric_changes if m.concept == "Assets")
                assert assets_change.percentage_change is None
                assert assets_change.absolute_change == 100.0
                
                ni_change = next(m for m in res.metric_changes if m.concept == "NetIncomeLoss")
                assert ni_change.percentage_change is None
                assert ni_change.absolute_change == -50.0
                
                rev_change = next(m for m in res.metric_changes if m.concept == "Revenues")
                assert rev_change.percentage_change is None
                assert rev_change.absolute_change == -60.0


