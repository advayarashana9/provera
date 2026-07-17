import logging
from typing import Optional
from app.services.company_search import CompanySearchService

logger = logging.getLogger(__name__)

class ClaimResolutionService:
    def __init__(self, company_search: Optional[CompanySearchService] = None):
        self.company_search = company_search or CompanySearchService()

    async def resolve_cik(self, ticker: Optional[str], company_name: Optional[str]) -> Optional[int]:
        """
        Resolve a company ticker or name to an official SEC CIK using CompanySearchService.
        """
        # 1. Try ticker exact match first
        if ticker:
            ticker_clean = ticker.strip().upper()
            try:
                results = await self.company_search.search(ticker_clean, limit=5)
                # Look for exact ticker match first
                for res in results:
                    if res["ticker"] == ticker_clean:
                        logger.info(f"Resolved ticker {ticker_clean} to CIK {res['cik']} (exact match)")
                        return res["cik"]
                # Otherwise take first prefix/other match if any
                if results:
                    logger.info(f"Resolved ticker {ticker_clean} to CIK {results[0]['cik']} (best match)")
                    return results[0]["cik"]
            except Exception as e:
                logger.error(f"Error during ticker resolution for {ticker_clean}: {e}")

        # 2. Try company name match second
        if company_name:
            name_clean = company_name.strip()
            try:
                results = await self.company_search.search(name_clean, limit=5)
                if results:
                    logger.info(f"Resolved company name '{name_clean}' to CIK {results[0]['cik']}")
                    return results[0]["cik"]
            except Exception as e:
                logger.error(f"Error during company name resolution for {name_clean}: {e}")

        return None
