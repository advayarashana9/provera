from pydantic import BaseModel
from typing import List, Optional

class CompanyOverview(BaseModel):
    """
    Model representing normalized company overview details.
    """
    cik: int
    name: str
    tickers: List[str]
    exchanges: List[str]
    sic: Optional[str] = None
    sic_description: Optional[str] = None
    fiscal_year_end: Optional[str] = None
    state_of_incorporation: Optional[str] = None
    entity_type: Optional[str] = None
    website: Optional[str] = None
    investor_website: Optional[str] = None
    phone: Optional[str] = None

class FilingSummary(BaseModel):
    """
    Model representing a summarized SEC filing entry.
    """
    accession_number: str
    filing_date: str
    report_date: Optional[str] = None
    acceptance_datetime: Optional[str] = None
    form: str
    file_number: Optional[str] = None
    primary_document: str
    primary_document_description: Optional[str] = None
    sec_url: str

class RecentFilingsResponse(BaseModel):
    """
    Model representing the recent filings response envelope.
    """
    cik: int
    company_name: str
    filings: List[FilingSummary]
    count: int
