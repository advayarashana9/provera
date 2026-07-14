from app.services.sec_client import SECClient

# In-memory cache for normalized company tickers list
_companies_cache = None

class CompanySearchService:
    def __init__(self, sec_client: SECClient = None):
        self.sec_client = sec_client or SECClient()

    async def _get_companies(self) -> list:
        """
        Load and normalize SEC company tickers. Uses an in-memory cache to prevent redownloads.
        """
        global _companies_cache
        if _companies_cache is None:
            raw_data = await self.sec_client.get_company_tickers()
            companies = []
            for item in raw_data.values():
                companies.append({
                    "cik": int(item["cik_str"]),
                    "ticker": str(item["ticker"]).upper(),
                    "name": str(item["title"])
                })
            _companies_cache = companies
        return _companies_cache

    async def search(self, query: str, limit: int = 10) -> list:
        """
        Search companies case-insensitively across ticker and name.
        Ranks exact ticker matches first, ticker prefix matches second, and name/other matches third.
        """
        if not query or not query.strip():
            raise ValueError("Query cannot be blank")

        normalized_q = query.strip().upper()
        lower_q = query.strip().lower()

        companies = await self._get_companies()

        exact_ticker_matches = []
        prefix_ticker_matches = []
        name_matches = []

        seen = set()

        # 1. Exact ticker matches
        for item in companies:
            if item["ticker"] == normalized_q:
                exact_ticker_matches.append(item)
                seen.add(item["cik"])

        # 2. Ticker prefix matches (excluding exact)
        for item in companies:
            if item["cik"] in seen:
                continue
            if item["ticker"].startswith(normalized_q):
                prefix_ticker_matches.append(item)
                seen.add(item["cik"])

        # 3. Company name (and other case-insensitive ticker substring) matches
        for item in companies:
            if item["cik"] in seen:
                continue
            if (lower_q in item["name"].lower()) or (normalized_q in item["ticker"]):
                name_matches.append(item)
                seen.add(item["cik"])

        results = exact_ticker_matches + prefix_ticker_matches + name_matches
        return results[:limit]
