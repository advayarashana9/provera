import os
import time
import asyncio
import logging
from pathlib import Path
from typing import Optional
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

# Bounded retry configuration
_MAX_RETRIES = 3
_RETRY_BASE_DELAY = 1.0  # seconds; doubled each attempt


class SECRetrievalError(Exception):
    """
    Raised when all retry attempts to the SEC have been exhausted or a
    non-retryable HTTP error was returned.  Should NOT be classified as
    Insufficient Evidence — it is a temporary network/service failure.
    """
    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


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

    async def _fetch_with_retry(self, url: str, is_full_url: bool = False) -> dict:
        """
        Perform an HTTP GET with bounded exponential-backoff retries.

        Rules:
        - HTTP 4xx (client error): do NOT retry — the resource doesn't exist.
        - HTTP 5xx / network error / timeout: retry up to _MAX_RETRIES times.
        - On exhaustion: raise SECRetrievalError.
        """
        last_exc: Optional[Exception] = None
        delay = _RETRY_BASE_DELAY

        for attempt in range(1, _MAX_RETRIES + 1):
            try:
                request_url = url if is_full_url else f"{self.base_url}{url}"

                async with httpx.AsyncClient(
                    timeout=self.timeout
                ) as client:
                    start = time.time()
                    response = await client.get(
                        request_url,
                        headers=self.headers,
                    )
                    duration = time.time() - start
                    logger.info(
                        f"[SEC FETCH] GET {url} → {response.status_code} "
                        f"({duration:.3f}s, attempt {attempt})"
                    )

                    if response.status_code < 400:
                        return response.json()

                    # 4xx — do not retry
                    if 400 <= response.status_code < 500:
                        raise SECRetrievalError(
                            f"SEC returned HTTP {response.status_code} for {url}",
                            status_code=response.status_code,
                        )

                    # 5xx — fall through to retry logic
                    last_exc = SECRetrievalError(
                        f"SEC returned HTTP {response.status_code} for {url}",
                        status_code=response.status_code,
                    )

            except httpx.TimeoutException as exc:
                logger.warning(f"[SEC FETCH] Timeout on attempt {attempt} for {url}: {exc}")
                last_exc = exc
            except httpx.NetworkError as exc:
                logger.warning(f"[SEC FETCH] Network error on attempt {attempt} for {url}: {exc}")
                last_exc = exc
            except SECRetrievalError:
                raise  # 4xx — propagate immediately without retry
            except Exception as exc:
                logger.warning(f"[SEC FETCH] Unexpected error on attempt {attempt} for {url}: {exc}")
                last_exc = exc

            if attempt < _MAX_RETRIES:
                logger.info(f"[SEC FETCH] Retrying in {delay:.1f}s (attempt {attempt}/{_MAX_RETRIES})")
                await asyncio.sleep(delay)
                delay *= 2

        raise SECRetrievalError(
            f"SEC request failed after {_MAX_RETRIES} attempts: {url}. Last error: {last_exc}"
        )

    # ── Company Submissions ────────────────────────────────────────────────────

    async def _fetch_company_submissions(self, cik: int) -> dict:
        cik_str = str(cik).zfill(10)
        url = f"/submissions/CIK{cik_str}.json"
        data = await self._fetch_with_retry(url)
        logger.info(f"[SEC] Fetched submissions for CIK {cik}")
        return data

    async def get_company_submissions(self, cik: int) -> dict:
        key = f"sec_submissions_{cik}"
        return await cache_service.get_or_set(
            key, 1800, self._fetch_company_submissions, cik
        )

    # ── Company Facts ──────────────────────────────────────────────────────────

    async def _fetch_company_facts(self, cik: int) -> dict:
        cik_str = str(cik).zfill(10)
        url = f"/api/xbrl/companyfacts/CIK{cik_str}.json"
        data = await self._fetch_with_retry(url)
        logger.info(f"[SEC] Fetched company facts for CIK {cik}")
        return data

    async def get_company_facts(self, cik: int) -> dict:
        key = f"sec_companyfacts_{cik}"
        return await cache_service.get_or_set(
            key, 1800, self._fetch_company_facts, cik
        )

    async def refresh_company_facts(self, cik: int) -> dict:
        """
        Force-refresh companyfacts from SEC, bypassing and updating the cache.
        Used by the evidence resolver when the cached data does not produce a
        confident match.
        """
        key = f"sec_companyfacts_{cik}"
        data = await self._fetch_company_facts(cik)
        cache_service.set_sync(key, data, 1800)
        return data

    # ── Company Tickers ────────────────────────────────────────────────────────

    async def _fetch_company_tickers(self) -> dict:
        data = await self._fetch_with_retry(SEC_COMPANY_TICKERS_URL, is_full_url=True)
        logger.info("[SEC] Fetched company tickers list")
        return data

    async def get_company_tickers(self) -> dict:
        key = "sec_company_tickers"
        return await cache_service.get_or_set(
            key, 86400, self._fetch_company_tickers
        )

    async def get_filing_file(self, cik: int, accession_no: str, filename: str) -> str:
        """
        Download a file (like index.json, _pre.xml, _cal.xml) from a filing's directory.
        """
        cik_str = str(cik)
        accn_no_dashes = accession_no.replace("-", "")
        url = f"https://www.sec.gov/Archives/edgar/data/{cik_str}/{accn_no_dashes}/{filename}"
        key = f"sec_filing_file_{cik}_{accession_no}_{filename}"
        
        async def fetcher():
            logger.info(f"[SEC FETCH FILING FILE] Fetching {url}")
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(url, headers=self.headers)
                if response.status_code == 200:
                    return response.text
                else:
                    raise SECRetrievalError(
                        f"Failed to fetch filing file {filename} from SEC: HTTP {response.status_code}",
                        status_code=response.status_code
                    )
        
        return await cache_service.get_or_set(key, 86400, fetcher)
