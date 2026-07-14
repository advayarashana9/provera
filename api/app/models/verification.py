from pydantic import BaseModel
from typing import List, Optional, Union

class VerificationEvidence(BaseModel):
    """
    Model representing a single fact used as evidence for a verification check.
    """
    namespace: str
    concept: str
    label: Optional[str] = None
    value: Union[int, float]
    unit: str
    end_date: str
    start_date: Optional[str] = None
    form: Optional[str] = None
    filed_date: Optional[str] = None
    accession_number: Optional[str] = None
    source_url: Optional[str] = None

class VerificationFinding(BaseModel):
    """
    Model representing a verification finding (pass, inconsistency, or review item).
    """
    check_id: str
    title: str
    category: str
    status: str
    severity: str
    confidence: float
    period_end: str
    form: Optional[str] = None
    unit: str
    reported_value: Optional[Union[int, float]] = None
    expected_value: Optional[Union[int, float]] = None
    difference: Optional[Union[int, float]] = None
    relative_difference: Optional[float] = None
    equation: Optional[str] = None
    explanation: str
    possible_explanations: List[str]
    evidence: List[VerificationEvidence]

class VerificationSummary(BaseModel):
    """
    Model representing the summary of all verification checks run for a company.
    """
    cik: int
    company_name: str
    checks_run: int
    checks_passed: int
    confirmed_inconsistencies: int
    review_items: int
    skipped_checks: int
    findings: List[VerificationFinding]
