from pydantic import BaseModel
from typing import List, Optional, Union
from app.models.company import FilingSummary

class FilingDiffRequest(BaseModel):
    older_accession_number: str
    newer_accession_number: str

class FilingSectionChange(BaseModel):
    section: str
    change_type: str  # "added", "removed", "modified", "unchanged"
    summary: str
    older_excerpt: Optional[str] = None
    newer_excerpt: Optional[str] = None
    older_source_url: Optional[str] = None
    newer_source_url: Optional[str] = None
    confidence: float

class FinancialMetricChange(BaseModel):
    concept: str
    label: Optional[str] = None
    older_value: Union[int, float]
    newer_value: Union[int, float]
    unit: str
    absolute_change: Union[int, float]
    percentage_change: Optional[float] = None
    older_period_end: str
    newer_period_end: str

class FilingDiffResponse(BaseModel):
    cik: int
    company_name: str
    older_filing: FilingSummary
    newer_filing: FilingSummary
    metric_changes: List[FinancialMetricChange]
    section_changes: List[FilingSectionChange]
    generated_summary: Optional[str] = None
    key_takeaways: List[str] = []
    similarity_percentage: float = 0.0
    largest_financial_change: Optional[float] = None


