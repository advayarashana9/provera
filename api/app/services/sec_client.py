import os
from pathlib import Path
from dotenv import load_dotenv
import httpx

# Load SEC_USER_AGENT from api/.env using python-dotenv
# The .env file is located at the api folder level, which is parent of parent of this file's parent.
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

    async def get_company_submissions(self, cik: int) -> dict:
        """
        Fetch company submissions JSON for a zero-padded 10-digit CIK.
        """
        cik_str = str(cik).zfill(10)
        async with httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout) as client:
            response = await client.get(f"/submissions/CIK{cik_str}.json", headers=self.headers)
            response.raise_for_status()
            return response.json()

    async def get_company_facts(self, cik: int) -> dict:
        """
        Fetch company facts JSON for a zero-padded 10-digit CIK.
        """
        cik_str = str(cik).zfill(10)
        async with httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout) as client:
            response = await client.get(f"/api/xbrl/companyfacts/CIK{cik_str}.json", headers=self.headers)
            response.raise_for_status()
            return response.json()

    async def get_company_tickers(self) -> dict:
        """
        Fetch the list of all company tickers from SEC.
        """
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(SEC_COMPANY_TICKERS_URL, headers=self.headers)
            response.raise_for_status()
            return response.json()

