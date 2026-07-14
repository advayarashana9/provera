from pydantic import BaseModel
from typing import List, Optional, Union

class DashboardMetric(BaseModel):
    key: str
    concept: str
    label: str
    value: Optional[Union[int, float]] = None
    prior_value: Optional[Union[int, float]] = None
    unit: Optional[str] = None
    period_end: Optional[str] = None
    prior_period_end: Optional[str] = None
    absolute_change: Optional[Union[int, float]] = None
    percentage_change: Optional[float] = None
    source_url: Optional[str] = None
    accession_number: Optional[str] = None
    filed_date: Optional[str] = None
    status: str

class DashboardSeriesPoint(BaseModel):
    value: Union[int, float]
    period_end: str
    fiscal_year: Optional[int] = None
    fiscal_period: Optional[str] = None
    form: Optional[str] = None
    accession_number: Optional[str] = None
    source_url: Optional[str] = None

class DashboardSeries(BaseModel):
    key: str
    label: str
    unit: str
    points: List[DashboardSeriesPoint]

class FinancialRatio(BaseModel):
    key: str
    label: str
    value: Optional[float] = None
    prior_value: Optional[float] = None
    absolute_change: Optional[float] = None
    status: str
    formula: str
    period_end: Optional[str] = None

class AIInsightPanel(BaseModel):
    biggest_strength: str
    biggest_risk: str
    biggest_change: str
    most_important_metric: str
    watch_next_quarter: str

class HealthScoreBreakdown(BaseModel):
    overall: int
    growth: int
    profitability: int
    liquidity: int
    leverage: int
    stability: int

class QuarterHighlight(BaseModel):
    metric: str
    change: str
    filing: str
    explanation: str

class FinancialDashboardResponse(BaseModel):
    cik: int
    company_name: str
    ticker: Optional[str] = None
    latest_period_end: Optional[str] = None
    latest_form: Optional[str] = None
    metrics: List[DashboardMetric]
    ratios: List[FinancialRatio]
    series: List[DashboardSeries]
    warnings: List[str]
    ai_insights: Optional[AIInsightPanel] = None
    health_score: Optional[HealthScoreBreakdown] = None
    timeline: List[QuarterHighlight] = []

class PeerComparisonResponse(BaseModel):
    base_cik: int
    companies: List[FinancialDashboardResponse]

