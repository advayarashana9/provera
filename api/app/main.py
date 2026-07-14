from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes.companies import router as companies_router

app = FastAPI(
    title="FilingLens API",
    description="Financial verification and SEC filing analysis API.",
    version="0.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://filinglens-sandy.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(companies_router, prefix="/companies")

@app.get("/health")
async def health():
    return {"status": "healthy"}

@app.get("/ai/status")
async def get_ai_status():
    from app.services.explanation_service import ExplanationService
    service = ExplanationService()
    return {
        "configured": service.is_available(),
        "provider": "Google Gemini"
    }
