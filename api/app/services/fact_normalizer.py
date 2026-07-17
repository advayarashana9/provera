from typing import List, Optional
import httpx
import time
import logging
from app.services.sec_client import SECClient
from app.models.financial_fact import NormalizedFinancialFact, CompanyFactsResponse, ConceptFactsResponse

logger = logging.getLogger(__name__)

def normalize_value(val: Optional[float], unit: Optional[str]) -> Optional[float]:
    """
    Scale the claimed value to absolute numbers based on scale keywords.
    """
    if val is None:
        return None
    if not unit:
        return val
    u = unit.strip().lower()
    if u in ["billion", "billions", "b"]:
        return val * 1_000_000_000
    if u in ["million", "millions", "m"]:
        return val * 1_000_000
    if u in ["thousand", "thousands", "k"]:
        return val * 1_000
    return val

def format_value_with_unit(val: float, unit_str: Optional[str]) -> str:
    """
    Formats a numeric value into a human-readable financial representation.
    """
    if val is None:
        return "N/A"
    
    if unit_str and unit_str.strip().lower() in ["percent", "%"]:
        return f"{val:.2f}%"
        
    abs_val = abs(val)
    sign = "-" if val < 0 else ""
    
    if abs_val >= 1_000_000_000:
        return f"{sign}${abs_val / 1_000_000_000:.3f} billion"
    elif abs_val >= 1_000_000:
        return f"{sign}${abs_val / 1_000_000:.3f} million"
    elif abs_val >= 1_000:
        return f"{sign}${abs_val / 1_000:.3f} thousand"
    else:
        return f"{sign}${val:,.2f}"


class FactNormalizerService:
    def __init__(self, sec_client: Optional[SECClient] = None):
        """
        Initialize FactNormalizerService with a given SEC client.
        """
        self.sec_client = sec_client or SECClient()

    async def get_company_facts(
        self,
        cik: int,
        forms: Optional[List[str]] = None,
        units: Optional[List[str]] = None,
        concepts: Optional[List[str]] = None,
        limit: int = 1000
    ) -> CompanyFactsResponse:
        """
        Fetch and normalize all financial facts for a company, applying optional filters.
        """
        limit = max(1, min(5000, limit))
        raw_data = await self.sec_client.get_company_facts(cik)
        start_time = time.time()
        company_name = raw_data.get("entityName", "")
        raw_facts = raw_data.get("facts", {})

        facts = []
        
        # Build uppercase filter sets for case-insensitive filtering
        upper_forms = {f.upper() for f in forms} if forms else None
        upper_units = {u.upper() for u in units} if units else None
        upper_concepts = {c.upper() for c in concepts} if concepts else None

        for ns, ns_data in raw_facts.items():
            if not isinstance(ns_data, dict):
                continue
            for concept, concept_data in ns_data.items():
                if not isinstance(concept_data, dict):
                    continue
                
                # Filter by concepts if specified
                if upper_concepts and (concept.upper() not in upper_concepts):
                    continue

                label = concept_data.get("label")
                description = concept_data.get("description")
                units_dict = concept_data.get("units", {})
                if not isinstance(units_dict, dict):
                    continue

                for unit_name, units_list in units_dict.items():
                    if not isinstance(units_list, list):
                        continue
                    
                    # Filter by units if specified
                    if upper_units and (unit_name.upper() not in upper_units):
                        continue

                    for fact_dict in units_list:
                        if not isinstance(fact_dict, dict):
                            continue

                        # Validate value (must be int or float)
                        val = fact_dict.get("val")
                        if val is None:
                            continue
                        if not isinstance(val, (int, float)):
                            try:
                                val = float(val)
                            except (ValueError, TypeError):
                                continue

                        # Validate end date (required field in NormalizedFinancialFact)
                        end_date = fact_dict.get("end")
                        if not end_date or not isinstance(end_date, str):
                            continue

                        # Filter by forms if specified
                        form_val = fact_dict.get("form")
                        form_str = str(form_val) if form_val is not None else None
                        if upper_forms and (form_str is None or form_str.upper() not in upper_forms):
                            continue

                        # Construct source_url
                        accn = fact_dict.get("accn")
                        accn_str = str(accn) if accn is not None else None
                        source_url = None
                        if accn_str:
                            unpadded_cik = str(int(cik))
                            accn_no_dashes = accn_str.replace("-", "")
                            source_url = f"https://www.sec.gov/Archives/edgar/data/{unpadded_cik}/{accn_no_dashes}/"

                        normalized_fact = NormalizedFinancialFact(
                            namespace=ns,
                            concept=concept,
                            label=label,
                            description=description,
                            unit=unit_name,
                            value=val,
                            start_date=fact_dict.get("start"),
                            end_date=end_date,
                            filed_date=fact_dict.get("filed"),
                            form=form_str,
                            fiscal_year=fact_dict.get("fy"),
                            fiscal_period=fact_dict.get("fp"),
                            accession_number=accn_str,
                            raw_value=val,
                            normalized_value=normalize_value(val, unit_name),
                            formatted_value=format_value_with_unit(val, unit_name),
                            frame=fact_dict.get("frame"),
                            source_url=source_url
                        )
                        facts.append(normalized_fact)

        # Sort facts: newest filed dates first. Place None/empty string at the end.
        facts.sort(key=lambda f: f.filed_date or "", reverse=True)
        results = facts[:limit]

        duration = time.time() - start_time
        logger.info(f"[TIMING] Normalization of company facts for CIK {cik} took {duration:.4f}s")

        return CompanyFactsResponse(
            cik=int(cik),
            company_name=str(company_name),
            facts=results,
            count=len(results)
        )

    async def get_concept_facts(
        self,
        cik: int,
        namespace: str,
        concept: str,
        forms: Optional[List[str]] = None,
        limit: int = 500
    ) -> ConceptFactsResponse:
        """
        Fetch and normalize facts for a specific namespace and concept, applying optional form filtering.
        """
        limit = max(1, min(5000, limit))
        raw_data = await self.sec_client.get_company_facts(cik)
        start_time = time.time()
        company_name = raw_data.get("entityName", "")
        raw_facts = raw_data.get("facts", {})

        # Find target namespace and concept case-insensitively
        target_ns_data = None
        target_ns_key = None
        for ns_key in raw_facts.keys():
            if ns_key.lower() == namespace.lower():
                target_ns_data = raw_facts[ns_key]
                target_ns_key = ns_key
                break

        target_concept_data = None
        target_concept_key = None
        if target_ns_data:
            for c_key in target_ns_data.keys():
                if c_key.lower() == concept.lower():
                    target_concept_data = target_ns_data[c_key]
                    target_concept_key = c_key
                    break

        facts = []
        label = None
        description = None

        if target_concept_data:
            label = target_concept_data.get("label")
            description = target_concept_data.get("description")
            units_dict = target_concept_data.get("units", {})

            upper_forms = {f.upper() for f in forms} if forms else None

            for unit_name, units_list in units_dict.items():
                if not isinstance(units_list, list):
                    continue
                for fact_dict in units_list:
                    if not isinstance(fact_dict, dict):
                        continue

                    # Validate value
                    val = fact_dict.get("val")
                    if val is None:
                        continue
                    if not isinstance(val, (int, float)):
                        try:
                            val = float(val)
                        except (ValueError, TypeError):
                            continue

                    # Validate end date
                    end_date = fact_dict.get("end")
                    if not end_date or not isinstance(end_date, str):
                        continue

                    # Filter by form
                    form_val = fact_dict.get("form")
                    form_str = str(form_val) if form_val is not None else None
                    if upper_forms and (form_str is None or form_str.upper() not in upper_forms):
                        continue

                    # Construct source_url
                    accn = fact_dict.get("accn")
                    accn_str = str(accn) if accn is not None else None
                    source_url = None
                    if accn_str:
                        unpadded_cik = str(int(cik))
                        accn_no_dashes = accn_str.replace("-", "")
                        source_url = f"https://www.sec.gov/Archives/edgar/data/{unpadded_cik}/{accn_no_dashes}/"

                    normalized_fact = NormalizedFinancialFact(
                        namespace=target_ns_key or namespace,
                        concept=target_concept_key or concept,
                        label=label,
                        description=description,
                        unit=unit_name,
                        value=val,
                        start_date=fact_dict.get("start"),
                        end_date=end_date,
                        filed_date=fact_dict.get("filed"),
                        form=form_str,
                        fiscal_year=fact_dict.get("fy"),
                        fiscal_period=fact_dict.get("fp"),
                        accession_number=accn_str,
                        raw_value=val,
                        normalized_value=normalize_value(val, unit_name),
                        formatted_value=format_value_with_unit(val, unit_name),
                        frame=fact_dict.get("frame"),
                        source_url=source_url
                    )
                    facts.append(normalized_fact)

        # Sort facts: newest filed dates first.
        facts.sort(key=lambda f: f.filed_date or "", reverse=True)
        results = facts[:limit]

        duration = time.time() - start_time
        logger.info(f"[TIMING] Normalization of concept facts for CIK {cik} took {duration:.4f}s")

        return ConceptFactsResponse(
            cik=int(cik),
            company_name=str(company_name),
            namespace=target_ns_key or namespace,
            concept=target_concept_key or concept,
            label=label,
            description=description,
            facts=results,
            count=len(results)
        )
