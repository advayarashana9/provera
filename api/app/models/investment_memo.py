from pydantic import BaseModel
from typing import List, Optional
from app.models.research_report import ReportSection, ReportCitation, ConfidenceIndicator

class InvestmentMemo(BaseModel):
    title: str
    confidence: Optional[ConfidenceIndicator] = None
    executive_summary: ReportSection
    business_overview: ReportSection
    financial_strength: ReportSection
    growth_drivers: ReportSection
    key_risks: ReportSection
    filing_changes: ReportSection
    competitive_position: ReportSection
    overall_assessment: ReportSection
    citations: List[ReportCitation] = []

class InvestmentMemoRequest(BaseModel):
    peers: List[int] = []
    periods: int = 4
