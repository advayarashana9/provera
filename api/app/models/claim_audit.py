from pydantic import BaseModel, Field
from typing import List, Optional, Union, Dict, Any

class AuditRequest(BaseModel):
    """
    Request model for document auditing.
    """
    text: str
    company_name: Optional[str] = None
    ticker: Optional[str] = None
    cik: Optional[str] = None

class ExtractedClaim(BaseModel):
    """
    Represents an atomic financial claim extracted from unstructured text.
    """
    original_text: str = Field(..., description="The exact sentence or quote containing the claim")
    company_name: Optional[str] = Field(None, description="The name of the company the claim refers to")
    ticker: Optional[str] = Field(None, description="The ticker symbol if mentioned or known")
    cik: Optional[str] = Field(None, description="The SEC CIK if known")
    claim_type: str = Field(..., description="The nature of the claim: financial_metric, opinion, forward_looking")
    metric: str = Field(..., description="The normalized metric name (e.g. Revenue, NetIncome, GrossProfit, Assets, Liabilities, Equity, Debt, OperatingCashFlow)")
    claimed_value: Optional[float] = Field(None, description="The specific numeric value of the claim if present")
    unit: Optional[str] = Field(None, description="The scale/currency unit, e.g. billion, million, percent, USD")
    direction: Optional[str] = Field(None, description="The direction of change (increase, decrease) if applicable")
    start_period: Optional[str] = Field(None, description="The start of the comparison period (e.g. Q3 2022, FY 2022)")
    end_period: Optional[str] = Field(None, description="The target period (e.g. Q3 2023, FY 2023)")
    comparison_type: Optional[str] = Field(None, description="Type of comparative change: YoY, QoQ, none")

class ExtractedClaimsList(BaseModel):
    """
    Container for extracted claims used with structured output from Gemini.
    """
    claims: List[ExtractedClaim]

class ClaimEvidence(BaseModel):
    """
    Individual fact from the SEC EDGAR filing matching the claim's metric and period.
    """
    concept: str
    value: Union[int, float]
    unit: str
    end_date: str
    start_date: Optional[str] = None
    form: Optional[str] = None
    filed_date: Optional[str] = None
    accession_number: Optional[str] = None
    source_url: Optional[str] = None
    explanation: Optional[str] = None
    raw_value: Optional[float] = None
    normalized_value: Optional[float] = None
    formatted_value: Optional[str] = None

class ClaimCalculation(BaseModel):
    """
    Steps taken deterministically to calculate the claim's metric.
    """
    formula: str
    inputs: Dict[str, Any]
    result: float

class ClaimAuditResult(BaseModel):
    """
    The verdict and evidence collected for an individual claim.
    """
    claim: ExtractedClaim
    verdict: str  # supported, contradicted, partially_supported, outdated, insufficient_evidence, opinion, forward_looking, requires_human_review
    confidence: str  # high, medium, low
    short_explanation: str
    is_outdated: bool = False
    evidence: List[ClaimEvidence] = []
    calculations: List[ClaimCalculation] = []
    limitations: List[str] = []
    source_urls: List[str] = []
    # Evidence resolution pipeline tracking (for "Why this verdict?" checklist)
    evidence_resolution_status: Optional[str] = None
    # cache_match | live_companyfacts_match | filing_xbrl_match |
    # extension_concept_match | no_confident_match | retrieval_error
    resolution_stage_details: List[str] = []
    # Human-readable per-stage results, e.g.:
    # ["✓ Company identified", "✓ Fiscal period matched", "✕ Metric not mappable"]
    score_breakdown: Optional[Dict[str, int]] = None

class DocumentAuditResponse(BaseModel):
    """
    The full audit response containing results for all extracted claims.
    """
    claims: List[ClaimAuditResult]
    summary: Dict[str, int]
