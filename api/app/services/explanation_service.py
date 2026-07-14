import os
import logging
import asyncio
from typing import List, Optional
from pydantic import BaseModel
from google import genai
from google.genai import types
from google.genai.errors import APIError
from dotenv import load_dotenv
from pathlib import Path

from app.models.verification import VerificationFinding

logger = logging.getLogger(__name__)

# Load api/.env to ensure GEMINI_API_KEY is in environment
base_dir = Path(__file__).resolve().parent.parent.parent
dotenv_path = base_dir / ".env"
load_dotenv(dotenv_path=dotenv_path)

class GeminiUnavailableError(Exception):
    """Raised when Gemini API is unconfigured or not available."""
    pass

class GeminiRateLimitError(Exception):
    """Raised when Gemini API rate limits are hit."""
    pass

class GeminiAPIError(Exception):
    """Raised when Gemini API returns an error other than rate limit."""
    pass

class GeminiExplanation(BaseModel):
    explanation: str
    possible_explanations: List[str]

class ExplanationService:
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize the ExplanationService. Uses GEMINI_API_KEY from environment if not provided.
        """
        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        self.client = None
        if self.api_key:
            try:
                self.client = genai.Client(api_key=self.api_key)
            except Exception as e:
                logger.error(f"Failed to initialize Gemini client: {e}")
        else:
            logger.warning("GEMINI_API_KEY not found in environment. Gemini explanations will be disabled.")

    def is_available(self) -> bool:
        """
        Return whether the Gemini client is initialized and available.
        """
        return self.client is not None

    async def generate_explanation(self, finding: VerificationFinding) -> GeminiExplanation:
        """
        Generate explanations for a verification finding from the Gemini API.
        Raises GeminiUnavailableError, GeminiRateLimitError, or GeminiAPIError on failures.
        """
        if not self.is_available():
            raise GeminiUnavailableError("Gemini API key is not configured or client is unavailable.")

        # Build prompt evidence string
        evidence_str = ""
        for i, ev in enumerate(finding.evidence):
            evidence_str += (
                f"- Fact {i+1}: Namespace={ev.namespace}, Concept={ev.concept}, Value={ev.value} {ev.unit}, "
                f"Date={ev.end_date} (Start={ev.start_date or 'N/A'}), Form={ev.form or 'N/A'}\n"
            )

        prompt = f"""You are a professional financial systems and XBRL auditor analyzing SEC filing data discrepancy findings.
We ran a deterministic verification check and identified a potential discrepancy.

Check Details:
- Check ID: {finding.check_id}
- Title: {finding.title}
- Category: {finding.category}
- Status: {finding.status}
- Severity: {finding.severity}
- Period End: {finding.period_end}
- Equation: {finding.equation or 'N/A'}
- Reported Value: {finding.reported_value if finding.reported_value is not None else 'N/A'} {finding.unit}
- Expected Value: {finding.expected_value if finding.expected_value is not None else 'N/A'} {finding.unit}
- Difference: {finding.difference if finding.difference is not None else 'N/A'} {finding.unit}
- Relative Difference: {finding.relative_difference if finding.relative_difference is not None else 'N/A'}

Deterministic base explanation:
{finding.explanation}

Evidence facts collected from the filing:
{evidence_str}

Please generate:
1. A concise, clear explanation (a few sentences) explaining the check and why this mismatch might occur in filing systems.
2. A list of 2 to 4 possible technical explanations for the discrepancy (e.g., context conflicts, custom tag usage, rounding, restricted cash presentation, continuing operations vs discontinued operations context).

CRITICAL ARCHITECTURAL CONSTRAINTS:
1. Do NOT perform any financial calculations or mathematical calculations of your own. Accept all values, differences, and expected values exactly as provided in the finding.
2. Do NOT suggest or accuse the company or filers of any intentional wrongdoing, fraud, manipulation, deception, cooking the books, or bad faith. Keep it strictly objective, professional, and focused on filing mechanics, presentation rules, and XBRL tagging differences.
3. You must respond with a JSON object matching the schema.
"""

        try:
            # Call Gemini async API
            response = await self.client.aio.models.generate_content(
                model='gemini-3.1-flash-lite',
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=GeminiExplanation,
                    temperature=0.2
                )
            )
            
            # Parse response text
            result_json = response.text
            explanation_data = GeminiExplanation.model_validate_json(result_json)
            return explanation_data
            
        except APIError as e:
            # Detect rate limits
            if e.code == 429 or "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e).upper():
                raise GeminiRateLimitError("Gemini API rate limit exceeded.") from e
            else:
                raise GeminiAPIError("Gemini API returned an error.") from e
        except Exception as e:
            # Fall back to a general unavailable error for network, connection, or deserialization failures
            raise GeminiUnavailableError("Failed to communicate with Gemini API or parse its response.") from e

    async def explain_finding(self, finding: VerificationFinding) -> VerificationFinding:
        """
        Query Gemini to explain a specific VerificationFinding discrepancy.
        Modifies finding.explanation and finding.possible_explanations in-place and returns it.
        Gracefully falls back to deterministic finding on error.
        """
        try:
            explanation_data = await self.generate_explanation(finding)
            finding.explanation = explanation_data.explanation
            finding.possible_explanations = explanation_data.possible_explanations
        except Exception as e:
            logger.error(
                f"Gemini API call failed for finding {finding.check_id}: {e}. "
                "Falling back to deterministic explanation."
            )
            # Fall back to deterministic explanation (unmodified)

        return finding

    async def explain_findings(self, findings: List[VerificationFinding]) -> List[VerificationFinding]:
        """
        Explain a list of VerificationFindings in parallel.
        """
        if not self.is_available() or not findings:
            return findings

        # Run explanation concurrently for all findings
        tasks = [self.explain_finding(finding) for finding in findings]
        return list(await asyncio.gather(*tasks))
