import os
import time
import logging
from pathlib import Path
from dotenv import load_dotenv
import httpx
from app.services.cache_service import cache_service

logger = logging.getLogger(__name__)

# Load SEC_USER_AGENT from api/.env using python-dotenv
base_dir = Path(__file__).resolve().parent.parent.parent
dotenv_path = base_dir / ".env"
load_dotenv(dotenv_path=dotenv_path)

SEC_USER_AGENT = os.getenv("SEC_USER_AGENT")
SEC_COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"

class SECClient:
    def __init__(self):
        if not SEC_USER_AGENT:
            raise RuntimeError("SEC_USER_AGENT environment variable is not set.")
        
        self.base_url = "https://data.sec.gov"
        self.headers = {
            "User-Agent": SEC_USER_AGENT,
            "Accept-Encoding": "gzip, deflate"
        }
        self.timeout = 30.0

    async def _fetch_company_submissions(self, cik: int) -> dict:
        cik_str = str(cik).zfill(10)
        start_time = time.time()
        async with httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout) as client:
            response = await client.get(f"/submissions/CIK{cik_str}.json", headers=self.headers)
            response.raise_for_status()
            data = response.json()
            duration = time.time() - start_time
            logger.info(f"[TIMING] SEC download submissions for CIK {cik} took {duration:.4f}s")
            return data

    async def get_company_submissions(self, cik: int) -> dict:
        key = f"sec_submissions_{cik}"
        return await cache_service.get_or_set(
            key, 1800, self._fetch_company_submissions, cik
        )

    async def _fetch_company_facts(self, cik: int) -> dict:
        cik_str = str(cik).zfill(10)
        start_time = time.time()
        async with httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout) as client:
            response = await client.get(f"/api/xbrl/companyfacts/CIK{cik_str}.json", headers=self.headers)
            response.raise_for_status()
            data = response.json()
            duration = time.time() - start_time
            logger.info(f"[TIMING] SEC download facts for CIK {cik} took {duration:.4f}s")
            return data

    async def get_company_facts(self, cik: int) -> dict:
        key = f"sec_companyfacts_{cik}"
        return await cache_service.get_or_set(
            key, 1800, self._fetch_company_facts, cik
        )

    async def _fetch_company_tickers(self) -> dict:
        start_time = time.time()
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(SEC_COMPANY_TICKERS_URL, headers=self.headers)
            response.raise_for_status()
            data = response.json()
            duration = time.time() - start_time
            logger.info(f"[TIMING] SEC download tickers took {duration:.4f}s")
            return data

    async def get_company_tickers(self) -> dict:
        key = "sec_company_tickers"
        return await cache_service.get_or_set(
            key, 86400, self._fetch_company_tickers
        )
