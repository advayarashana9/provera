from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.routes.companies import router as companies_router
from app.routes.audits import router as audits_router

app = FastAPI(
    title="Provera API",
    description="Financial verification and SEC filing analysis API.",
    version="0.1.0",
)

app.add_middleware(
    GZipMiddleware,
    minimum_size=1000
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://provera-sandy.vercel.app",
        "https://provera-e2cv3xcyc-advayarashana9s-projects.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(companies_router, prefix="/companies")
app.include_router(audits_router)



@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/ai/status")
async def get_ai_status():
    from app.services.explanation_service import ExplanationService

    service = ExplanationService()
    return {
        "configured": service.is_available(),
        "provider": "Google Gemini",
    }
