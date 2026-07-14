from typing import List, Optional
from app.services.sec_client import SECClient
from app.models.company import CompanyOverview, FilingSummary, RecentFilingsResponse

class CompanyProfileService:
    def __init__(self, sec_client: Optional[SECClient] = None):
        """
        Initialize the profile service with a given SEC client.
        """
        self.sec_client = sec_client or SECClient()

    async def get_overview(self, cik: int) -> CompanyOverview:
        """
        Fetch and normalize company overview fields from the SEC submissions.
        """
        raw_data = await self.sec_client.get_company_submissions(cik)
        
        # Extract fields with safe defaults or fallback to None
        tickers = raw_data.get("tickers", [])
        if not isinstance(tickers, list):
            tickers = []
            
        exchanges = raw_data.get("exchanges", [])
        if not isinstance(exchanges, list):
            exchanges = []

        return CompanyOverview(
            cik=int(raw_data.get("cik")),
            name=str(raw_data.get("name", "")),
            tickers=[str(t) for t in tickers],
            exchanges=[str(e) for e in exchanges],
            sic=raw_data.get("sic"),
            sic_description=raw_data.get("sicDescription"),
            fiscal_year_end=raw_data.get("fiscalYearEnd"),
            state_of_incorporation=raw_data.get("stateOfIncorporation"),
            entity_type=raw_data.get("entityType"),
            website=raw_data.get("website"),
            investor_website=raw_data.get("investorWebsite"),
            phone=raw_data.get("phone")
        )

    async def get_recent_filings(
        self,
        cik: int,
        forms: Optional[List[str]] = None,
        limit: int = 20
    ) -> RecentFilingsResponse:
        """
        Fetch and parse recent filings, applying optional form filtering and limit capping.
        """
        # Enforce limit bounds
        limit = max(1, min(100, limit))
        
        raw_data = await self.sec_client.get_company_submissions(cik)
        company_name = str(raw_data.get("name", ""))
        
        filings_section = raw_data.get("filings", {})
        recent = filings_section.get("recent", {})
        
        # Extract lists safely
        accession_numbers = recent.get("accessionNumber", [])
        filing_dates = recent.get("filingDate", [])
        forms_list = recent.get("form", [])
        primary_documents = recent.get("primaryDocument", [])
        
        report_dates = recent.get("reportDate", [])
        acceptance_datetimes = recent.get("acceptanceDateTime", [])
        file_numbers = recent.get("fileNumber", [])
        primary_doc_descriptions = recent.get("primaryDocDescription", [])
        
        # Find minimum length of essential lists to prevent IndexErrors
        num_filings = min(
            len(accession_numbers),
            len(filing_dates),
            len(forms_list),
            len(primary_documents)
        )
        
        # Build normalized filings
        filings = []
        unpadded_cik = str(int(cik))
        
        # Setup case-insensitive form filter if provided
        upper_forms = {f.upper() for f in forms} if forms else None
        
        for i in range(num_filings):
            form_val = str(forms_list[i])
            if upper_forms and (form_val.upper() not in upper_forms):
                continue
                
            accession_number = str(accession_numbers[i])
            accession_without_dashes = accession_number.replace("-", "")
            primary_document = str(primary_documents[i])
            
            # Construct SEC URL
            sec_url = f"https://www.sec.gov/Archives/edgar/data/{unpadded_cik}/{accession_without_dashes}/{primary_document}"
            
            # Safe indexing helper
            def get_val(lst, index):
                if lst and index < len(lst):
                    return lst[index]
                return None
                
            filing_summary = FilingSummary(
                accession_number=accession_number,
                filing_date=str(filing_dates[i]),
                report_date=get_val(report_dates, i),
                acceptance_datetime=get_val(acceptance_datetimes, i),
                form=form_val,
                file_number=get_val(file_numbers, i),
                primary_document=primary_document,
                primary_document_description=get_val(primary_doc_descriptions, i),
                sec_url=sec_url
            )
            filings.append(filing_summary)
            
            if len(filings) >= limit:
                break
                
        return RecentFilingsResponse(
            cik=int(cik),
            company_name=company_name,
            filings=filings,
            count=len(filings)
        )
