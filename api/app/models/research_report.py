from pydantic import BaseModel
from typing import List, Optional

class ReportCitation(BaseModel):
    id: int
    concept: str
    label: Optional[str] = None
    value: float
    unit: str
    period_end: str
    form: str
    source_url: Optional[str] = None

class ReportSection(BaseModel):
    title: str
    content: str
    citations: List[int] = []

class InvestmentSnapshot(BaseModel):
    overall_assessment: str  # Positive, Neutral, Cautious
    financial_health: str
    liquidity: str
    profitability: str
    leverage: str
    biggest_strength: str
    biggest_risk: str
    metrics_to_watch_next_quarter: List[str]

class ReportMetadata(BaseModel):
    filing_type: str
    filing_date: str
    period_end: str
    fiscal_quarter: str
    cik: str
    exchange: str

class KeyMetricEntry(BaseModel):
    key: str
    label: str
    value: str
    change_percentage: Optional[float] = None
    status: Optional[str] = None  # increased, decreased, stable, N/A

class ConfidenceIndicator(BaseModel):
    data_coverage: str
    confidence_level: str
    missing_information: str

class AIResearchReport(BaseModel):
    title: str
    metadata: ReportMetadata
    investment_snapshot: InvestmentSnapshot
    confidence: Optional[ConfidenceIndicator] = None
    key_metrics: List[KeyMetricEntry] = []
    executive_summary: ReportSection
    business_overview: ReportSection
    financial_highlights: ReportSection
    balance_sheet: ReportSection
    income_statement: ReportSection
    cash_flow: ReportSection
    profitability: ReportSection
    risks: ReportSection
    recent_changes: ReportSection
    management_discussion: ReportSection
    conclusion: ReportSection
    citations: List[ReportCitation] = []

class ResearchReportRequest(BaseModel):
    periods: int = 4
