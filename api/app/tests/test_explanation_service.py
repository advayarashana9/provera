from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.explanation_service import (
    ExplanationService,
    GeminiExplanation,
    GeminiUnavailableError,
    GeminiRateLimitError,
    GeminiAPIError
)
from app.models.verification import VerificationFinding, VerificationEvidence, VerificationSummary

client = TestClient(app)

VALID_FINDING_DICT = {
    "check_id": "BS_EQUITY",
    "title": "Balance Sheet Consistency",
    "category": "Balance Sheet",
    "status": "confirmed_inconsistency",
    "severity": "high",
    "confidence": 0.95,
    "period_end": "2023-12-31",
    "unit": "USD",
    "explanation": "Deterministic explanation",
    "possible_explanations": ["Deterministic explanation 1"],
    "evidence": [
        {
            "namespace": "us-gaap",
            "concept": "Assets",
            "value": 100.0,
            "unit": "USD",
            "end_date": "2023-12-31"
        }
    ]
}

INVALID_FINDING_DICT = {
    "check_id": "BS_EQUITY",
    "title": "Balance Sheet Consistency",
    "category": "Balance Sheet",
    "status": "confirmed_inconsistency",
    "severity": "high",
    "confidence": 0.95,
    "period_end": "2023-12-31",
    "unit": "USD",
    "explanation": "Deterministic explanation",
    "possible_explanations": ["Deterministic explanation 1"],
    "evidence": []  # No evidence!
}

# =====================================================================
# ExplanationService Unit Tests
# =====================================================================

@pytest.mark.asyncio
async def test_explanation_service_no_key(monkeypatch):
    # Ensure GEMINI_API_KEY is not in the environment for this test
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    service = ExplanationService(api_key=None)
    assert not service.is_available()
    
    finding = VerificationFinding(**VALID_FINDING_DICT)
    result = await service.explain_finding(finding)
    assert result.explanation == "Deterministic explanation"
    assert result.possible_explanations == ["Deterministic explanation 1"]

@pytest.mark.asyncio
async def test_explanation_service_success():
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = '{"explanation": "Gemini explanation details", "possible_explanations": ["Reason A", "Reason B"]}'
    
    mock_client.aio.models.generate_content = AsyncMock(return_value=mock_response)
    
    with patch("google.genai.Client", return_value=mock_client):
        service = ExplanationService(api_key="mock_key")
        assert service.is_available()
        
        finding = VerificationFinding(**VALID_FINDING_DICT)
        result = await service.explain_finding(finding)
        
        assert result.explanation == "Gemini explanation details"
        assert result.possible_explanations == ["Reason A", "Reason B"]
        
        mock_client.aio.models.generate_content.assert_called_once()
        call_kwargs = mock_client.aio.models.generate_content.call_args[1]
        assert call_kwargs["config"].response_schema == GeminiExplanation

@pytest.mark.asyncio
async def test_explanation_service_api_error_fallback():
    mock_client = MagicMock()
    mock_client.aio.models.generate_content = AsyncMock(side_effect=Exception("API error"))
    
    with patch("google.genai.Client", return_value=mock_client):
        service = ExplanationService(api_key="mock_key")
        assert service.is_available()
        
        finding = VerificationFinding(**VALID_FINDING_DICT)
        
        # In explain_finding, failure falls back gracefully
        result = await service.explain_finding(finding)
        assert result.explanation == "Deterministic explanation"
        assert result.possible_explanations == ["Deterministic explanation 1"]

@pytest.mark.asyncio
async def test_explanation_service_multiple_findings():
    mock_client = MagicMock()
    mock_response1 = MagicMock()
    mock_response1.text = '{"explanation": "Expl 1", "possible_explanations": ["A"]}'
    mock_response2 = MagicMock()
    mock_response2.text = '{"explanation": "Expl 2", "possible_explanations": ["B"]}'
    
    mock_client.aio.models.generate_content = AsyncMock(side_effect=[mock_response1, mock_response2])
    
    with patch("google.genai.Client", return_value=mock_client):
        service = ExplanationService(api_key="mock_key")
        
        finding1 = VerificationFinding(**VALID_FINDING_DICT)
        finding2 = VerificationFinding(**VALID_FINDING_DICT)
        
        results = await service.explain_findings([finding1, finding2])
        
        assert results[0].explanation == "Expl 1"
        assert results[0].possible_explanations == ["A"]
        assert results[1].explanation == "Expl 2"
        assert results[1].possible_explanations == ["B"]

# =====================================================================
# API Route Endpoint Tests
# =====================================================================

def test_ai_status_configured():
    with patch("app.services.explanation_service.ExplanationService.is_available", return_value=True):
        response = client.get("/ai/status")
        assert response.status_code == 200
        assert response.json() == {"configured": True, "provider": "Google Gemini"}

def test_ai_status_unconfigured():
    with patch("app.services.explanation_service.ExplanationService.is_available", return_value=False):
        response = client.get("/ai/status")
        assert response.status_code == 200
        assert response.json() == {"configured": False, "provider": "Google Gemini"}

def test_explain_endpoint_success():
    mock_explanation = GeminiExplanation(explanation="Gemini explanation", possible_explanations=["Reason 1"])
    with patch("app.services.explanation_service.ExplanationService.generate_explanation", return_value=mock_explanation):
        response = client.post("/companies/320193/findings/explain", json=VALID_FINDING_DICT)
        assert response.status_code == 200
        assert response.json() == {"explanation": "Gemini explanation", "possible_explanations": ["Reason 1"]}

def test_explain_endpoint_missing_evidence():
    response = client.post("/companies/320193/findings/explain", json=INVALID_FINDING_DICT)
    assert response.status_code == 400
    assert "must contain at least one evidence fact" in response.json()["detail"].lower()

def test_explain_endpoint_unavailable():
    with patch("app.services.explanation_service.ExplanationService.generate_explanation", side_effect=GeminiUnavailableError("API key missing")):
        response = client.post("/companies/320193/findings/explain", json=VALID_FINDING_DICT)
        assert response.status_code == 503
        assert "unavailable" in response.json()["detail"].lower()

def test_explain_endpoint_rate_limit():
    with patch("app.services.explanation_service.ExplanationService.generate_explanation", side_effect=GeminiRateLimitError("Rate limit exceeded")):
        response = client.post("/companies/320193/findings/explain", json=VALID_FINDING_DICT)
        assert response.status_code == 429
        assert "rate limit" in response.json()["detail"].lower()

def test_explain_endpoint_provider_error():
    with patch("app.services.explanation_service.ExplanationService.generate_explanation", side_effect=GeminiAPIError("API error")):
        response = client.post("/companies/320193/findings/explain", json=VALID_FINDING_DICT)
        assert response.status_code == 502
        assert "api returned an error" in response.json()["detail"].lower()

def test_verify_endpoint_works_without_gemini():
    mock_summary = VerificationSummary(
        cik=320193,
        company_name="Apple Inc.",
        checks_run=5,
        checks_passed=5,
        confirmed_inconsistencies=0,
        review_items=0,
        skipped_checks=0,
        findings=[]
    )
    with patch("app.routes.companies.verification_engine.verify_company", return_value=mock_summary):
        # Even if Gemini is unconfigured, verification endpoint works normally
        with patch("app.services.explanation_service.ExplanationService.is_available", return_value=False):
            response = client.get("/companies/320193/verify")
            assert response.status_code == 200
            data = response.json()
            assert data["cik"] == 320193
            assert data["checks_run"] == 5
