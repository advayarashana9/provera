from pydantic import BaseModel
from typing import List, Optional, Union

class NormalizedFinancialFact(BaseModel):
    """
    Model representing a single normalized XBRL financial fact.
    """
    namespace: str
    concept: str
    label: Optional[str] = None
    description: Optional[str] = None
    unit: str
    value: Union[int, float]
    start_date: Optional[str] = None
    end_date: str
    filed_date: Optional[str] = None
    form: Optional[str] = None
    fiscal_year: Optional[int] = None
    fiscal_period: Optional[str] = None
    accession_number: Optional[str] = None
    raw_value: Optional[float] = None
    normalized_value: Optional[float] = None
    formatted_value: Optional[str] = None
    frame: Optional[str] = None
    source_url: Optional[str] = None

class CompanyFactsResponse(BaseModel):
    """
    Model representing the collection of all normalized facts for a company.
    """
    cik: int
    company_name: str
    facts: List[NormalizedFinancialFact]
    count: int

class ConceptFactsResponse(BaseModel):
    """
    Model representing facts for a specific namespace/concept query for a company.
    """
    cik: int
    company_name: str
    namespace: str
    concept: str
    label: Optional[str] = None
    description: Optional[str] = None
    facts: List[NormalizedFinancialFact]
    count: int
