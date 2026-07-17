import logging
from fastapi import APIRouter, HTTPException

from app.models.claim_audit import (
    AuditRequest,
    ExtractedClaim,
    ClaimAuditResult,
    DocumentAuditResponse,
)
from app.services.document_audit_service import DocumentAuditService
from app.services.claim_extraction_service import GeminiUnavailableError

logger = logging.getLogger(__name__)

router = APIRouter()
audit_service = DocumentAuditService()

@router.post("/audits", response_model=DocumentAuditResponse)
async def audit_document(req: AuditRequest):
    """
    Audit an entire equity research document.
    """
    try:
        return await audit_service.audit_document(req.text, default_cik=req.cik)
    except GeminiUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.exception("Error during audits route processing")
        raise HTTPException(status_code=500, detail=f"Audits failed: {str(e)}")

@router.post("/claims/verify", response_model=ClaimAuditResult)
async def verify_claim(claim: ExtractedClaim):
    """
    Verify a single structured financial claim.
    """
    try:
        return await audit_service.verify_single_claim(claim)
    except Exception as e:
        logger.exception("Error during claims/verify route processing")
        raise HTTPException(status_code=500, detail=f"Claims verification failed: {str(e)}")
