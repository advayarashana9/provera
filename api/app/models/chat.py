from pydantic import BaseModel
from typing import List, Optional, Union

class ChatRequest(BaseModel):
    question: str

class ChatCitation(BaseModel):
    id: int
    concept: str
    label: Optional[str] = None
    value: Union[int, float]
    unit: str
    period_end: str
    form: Optional[str] = None
    accession_number: Optional[str] = None
    source_url: Optional[str] = None

class ChatComparison(BaseModel):
    concept: str
    label: Optional[str] = None
    current_value: Union[int, float]
    prior_value: Union[int, float]
    unit: str
    current_period_end: str
    prior_period_end: str
    absolute_change: Union[int, float]
    percentage_change: Optional[float] = None

class ChatResponse(BaseModel):
    answer: str
    citations: List[ChatCitation]
    comparisons: List[ChatComparison]
    evidence_count: int
    insufficient_evidence: bool
