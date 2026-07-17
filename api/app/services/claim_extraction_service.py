import os
import logging
from typing import List, Optional
from google import genai
from google.genai import types
from google.genai.errors import APIError
from dotenv import load_dotenv
from pathlib import Path

from app.models.claim_audit import ExtractedClaim, ExtractedClaimsList

logger = logging.getLogger(__name__)

# Load environment variables
base_dir = Path(__file__).resolve().parent.parent.parent
dotenv_path = base_dir / ".env"
load_dotenv(dotenv_path=dotenv_path)

class GeminiUnavailableError(Exception):
    """Raised when Gemini API is unconfigured or not available."""
    pass

class ClaimExtractionService:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        self.client = None
        if self.api_key:
            try:
                self.client = genai.Client(api_key=self.api_key)
            except Exception as e:
                logger.error(f"Failed to initialize Gemini client in ClaimExtractionService: {e}")
        else:
            logger.warning("GEMINI_API_KEY not found in environment for ClaimExtractionService.")

    def is_available(self) -> bool:
        return self.client is not None

    async def extract_claims(self, text: str) -> List[ExtractedClaim]:
        """
        Analyze unstructured text and extract structured financial claims using Gemini.
        Raises GeminiUnavailableError if Gemini is unavailable or API fails.
        """
        if not self.is_available():
            raise GeminiUnavailableError("Gemini API key is not configured or client is unavailable.")

        if not text or not text.strip():
            return []

        prompt = f"""You are a professional financial audit system. Your task is to analyze the unstructured equity research text below and extract all atomic financial claims.

For each claim:
1. Extract the exact sentence or quote as `original_text`.
2. Identify the target `company_name` (and `ticker` or `cik` if mentioned in the report or known).
3. Classify `claim_type` as one of:
   - `financial_metric`: Specific historical reported figures, margin numbers, ratios, or changes/trends in them (e.g. "Revenue grew 10% YoY to $5.2B").
   - `opinion`: Qualitative assessments, opinions, ratings, or claims about management quality, competitive position, market conditions, or product quality (e.g. "management has outstanding execution").
   - `forward_looking`: Guidance, forecast, target, projection, expectations, or future predictions (e.g. "we expect Q4 revenue to reach $10B").
4. If it is a `financial_metric` claim, extract:
   - `metric`: The normalized metric name (must map to one of: Revenue, NetIncome, GrossProfit, OperatingIncome, Assets, Liabilities, Equity, Debt, OperatingCashFlow).
   - `claimed_value`: The raw numerical value mentioned (e.g. 10.5, 45, 5200). Ignore unit scales when parsing this number (e.g. for "$10.5 billion", use 10.5). For percentage/margin changes, use the number itself (e.g. for "10%", use 10).
   - `unit`: The scale or currency (e.g. "billion", "million", "percent", "USD").
   - `direction`: "increase" or "decrease" if the claim states that the metric grew, rose, declined, fell, etc. Otherwise, None.
   - `start_period`: The comparative start period if a trend or comparison is made (e.g., "Q3 2022", "FY 2022", or None).
   - `end_period`: The target period of the claim (e.g., "Q3 2023", "FY 2023"). This is critical.
   - `comparison_type`: "YoY" for year-over-year changes, "QoQ" for quarter-over-quarter changes, or None.

CRITICAL CONSTRAINTS:
- Do NOT invent or hallucinate metrics, companies, or values that are not in the text.
- If a sentence does not contain any of the three claim types, do not extract it.
- Keep the breakdown atomic. If a sentence has multiple distinct claims (e.g. "Revenue grew to $10B and operating margin reached 35%"), extract them as separate claims.

Research Report Text to Audit:
---
{text}
---
"""

        try:
            response = await self.client.aio.models.generate_content(
                model='gemini-3.1-flash-lite',
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=ExtractedClaimsList,
                    temperature=0.1
                )
            )
            result_json = response.text
            claims_data = ExtractedClaimsList.model_validate_json(result_json)
            return claims_data.claims
        except APIError as e:
            logger.error(f"Gemini API Error during claim extraction: {e}")
            raise GeminiUnavailableError("Gemini API returned an error during extraction.") from e
        except Exception as e:
            logger.error(f"Unexpected error during claim extraction: {e}")
            raise GeminiUnavailableError("Failed to extract claims due to service error.") from e
