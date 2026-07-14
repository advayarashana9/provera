import logging
import math
from datetime import datetime
from typing import List, Optional, Dict, Tuple
from fastapi import HTTPException

from app.models.company import FilingSummary
from app.models.dashboard import (
    DashboardMetric,
    DashboardSeriesPoint,
    DashboardSeries,
    FinancialRatio,
    FinancialDashboardResponse,
    AIInsightPanel,
    HealthScoreBreakdown,
    QuarterHighlight
)
from app.services.sec_client import SECClient
from app.services.company_profile import CompanyProfileService
from app.services.fact_normalizer import FactNormalizerService

logger = logging.getLogger(__name__)

# Map core dashboard keys to acceptable SEC concepts
METRIC_CONCEPTS = {
    "revenue": [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "SalesRevenueNet",
        "Revenues",
        "RevenueMineralSales",
        "SalesRevenueGoodsNet"
    ],
    "net_income": [
        "NetIncomeLoss",
        "NetIncomeLossAvailableToCommonStockholdersBasic",
        "NetIncomeLossAvailableToCommonStockholdersDiluted"
    ],
    "gross_profit": [
        "GrossProfit"
    ],
    "operating_income": [
        "OperatingIncomeLoss",
        "OperatingIncome"
    ],
    "cash": [
        "CashAndCashEquivalentsAtCarryingValue",
        "Cash",
        "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"
    ],
    "assets": [
        "Assets"
    ],
    "liabilities": [
        "Liabilities"
    ],
    "equity": [
        "StockholdersEquity",
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"
    ],
    "inventory": [
        "InventoryNet",
        "InventoriesNet",
        "Inventories"
    ],
    "receivables": [
        "AccountsReceivableNetCurrent",
        "AccountsReceivableNet",
        "ReceivablesNetCurrent",
        "Receivables"
    ],
    "operating_cash_flow": [
        "NetCashProvidedByUsedInOperatingActivities",
        "OperatingCashFlow"
    ],
    "current_assets": [
        "AssetsCurrent"
    ],
    "current_liabilities": [
        "LiabilitiesCurrent"
    ]
}

METRIC_LABELS = {
    "revenue": "Revenue",
    "net_income": "Net Income",
    "gross_profit": "Gross Profit",
    "operating_income": "Operating Income",
    "cash": "Cash and Cash Equivalents",
    "assets": "Total Assets",
    "liabilities": "Total Liabilities",
    "equity": "Stockholders’ Equity",
    "inventory": "Inventory",
    "receivables": "Accounts Receivable",
    "operating_cash_flow": "Net Cash Provided by Operating Activities",
    "current_assets": "Current Assets",
    "current_liabilities": "Current Liabilities"
}

INSTANT_METRICS = {"cash", "assets", "liabilities", "equity", "inventory", "receivables", "current_assets", "current_liabilities"}

class FinancialDashboardService:
    def __init__(
        self,
        sec_client: Optional[SECClient] = None,
        profile_service: Optional[CompanyProfileService] = None,
        fact_normalizer: Optional[FactNormalizerService] = None
    ):
        self.sec_client = sec_client or SECClient()
        self.profile_service = profile_service or CompanyProfileService(self.sec_client)
        self.fact_normalizer = fact_normalizer or FactNormalizerService(self.sec_client)

    def _get_duration_days(self, start_str: Optional[str], end_str: str) -> Optional[int]:
        if not start_str or not end_str:
            return None
        try:
            start = datetime.strptime(start_str, "%Y-%m-%d")
            end = datetime.strptime(end_str, "%Y-%m-%d")
            return abs((end - start).days)
        except Exception:
            return None

    def _matches_period_end(self, date_str: str, target_end_str: str) -> bool:
        if date_str == target_end_str:
            return True
        try:
            d = datetime.strptime(date_str, "%Y-%m-%d")
            t = datetime.strptime(target_end_str, "%Y-%m-%d")
            return abs((d - t).days) <= 4
        except Exception:
            return False

    def _derive_quarter_value(self, all_facts, target_end_date: str, concepts: List[str]) -> Optional[dict]:
        # Derives a quarter value from cumulative YTD values if direct quarter value is missing
        for concept in concepts:
            f2_candidates = [
                f for f in all_facts 
                if f.concept.lower() == concept.lower() 
                and f.start_date is not None 
                and self._matches_period_end(f.end_date, target_end_date)
            ]
            for f2 in f2_candidates:
                f2_days = self._get_duration_days(f2.start_date, f2.end_date)
                if f2_days is None or f2_days <= 120:
                    continue
                
                try:
                    f2_end_dt = datetime.strptime(f2.end_date, "%Y-%m-%d")
                except Exception:
                    continue
                    
                f1_candidates = [
                    f for f in all_facts 
                    if f.concept.lower() == concept.lower() 
                    and f.start_date == f2.start_date
                    and f.end_date != f2.end_date
                    and f.unit.upper() == f2.unit.upper()
                ]
                for f1 in f1_candidates:
                    try:
                        f1_end_dt = datetime.strptime(f1.end_date, "%Y-%m-%d")
                    except Exception:
                        continue
                    diff_days = (f2_end_dt - f1_end_dt).days
                    if 60 <= diff_days <= 120:
                        derived_val = f2.value - f1.value
                        return {
                            "value": derived_val,
                            "unit": f2.unit,
                            "concept": f2.concept,
                            "label": f2.label or METRIC_LABELS.get(concept.lower(), f2.concept),
                            "start_date": f1.end_date,
                            "end_date": f2.end_date,
                            "form": f2.form,
                            "accession_number": f2.accession_number,
                            "source_url": None,
                            "is_derived": True
                        }
        return None

    def _extract_metric_value(self, all_facts, filing: FilingSummary, metric_key: str) -> Optional[dict]:
        concepts = METRIC_CONCEPTS.get(metric_key, [])
        is_instant = metric_key in INSTANT_METRICS

        # Search for direct fact first
        candidates = []
        for concept in concepts:
            for f in all_facts:
                if f.concept.lower() != concept.lower():
                    continue
                if not self._matches_period_end(f.end_date, filing.report_date):
                    continue
                
                # Exclude malformed
                if f.value is None or not isinstance(f.value, (int, float)):
                    continue
                if math.isnan(f.value) or math.isinf(f.value):
                    continue

                if is_instant:
                    if f.start_date is None:
                        candidates.append(f)
                else:
                    if f.start_date is not None:
                        days = self._get_duration_days(f.start_date, f.end_date)
                        if filing.form.upper() == "10-Q":
                            # Quarter duration preferred (60-120 days)
                            if days is not None and 60 <= days <= 120:
                                candidates.append(f)
                        elif filing.form.upper() == "10-K":
                            # Annual duration preferred (330-400 days)
                            if days is not None and 330 <= days <= 400:
                                candidates.append(f)

        if candidates:
            # Sort to select best candidate: prefer latest accession, then matching form, then latest filed_date
            acc_priority = getattr(self, "_acc_priority", {})
            candidates.sort(key=lambda f: (
                acc_priority.get(f.accession_number, 999),
                0 if f.form and f.form.upper() == filing.form.upper() else 1,
                f.filed_date or ""
            ))
            best = candidates[0]
            return {
                "value": best.value,
                "unit": best.unit,
                "concept": best.concept,
                "label": best.label or METRIC_LABELS.get(metric_key, best.concept),
                "start_date": best.start_date,
                "end_date": best.end_date,
                "form": best.form,
                "accession_number": best.accession_number,
                "filed_date": best.filed_date,
                "source_url": best.source_url,
                "is_derived": False
            }

        # If duration metric and direct quarter fact was missing, try to derive it
        if not is_instant and filing.form.upper() == "10-Q":
            derived = self._derive_quarter_value(all_facts, filing.report_date, concepts)
            if derived:
                return derived

        return None

    async def get_dashboard(
        self,
        cik: int,
        forms: Optional[List[str]] = None,
        periods: int = 8
    ) -> FinancialDashboardResponse:
        # Enforce inputs
        periods = max(4, min(20, periods))
        target_forms = forms or ["10-K", "10-Q"]

        # Fetch recent filings
        recent_filings_res = await self.profile_service.get_recent_filings(cik, forms=target_forms, limit=100)
        recent_filings = recent_filings_res.filings

        if not recent_filings:
            raise HTTPException(status_code=404, detail=f"No suitable filings found for CIK {cik}")

        # Set priority map of accession numbers (latest filing has priority 0)
        self._acc_priority = {f.accession_number: idx for idx, f in enumerate(recent_filings)}

        # Fetch all facts once
        facts_res = await self.fact_normalizer.get_company_facts(cik, forms=target_forms, limit=5000)
        all_facts = facts_res.facts
        company_name = facts_res.company_name

        # Select latest periods to report
        target_filings = recent_filings[:periods]

        # Determine latest filing details
        latest_filing = recent_filings[0]
        latest_period_end = latest_filing.report_date
        latest_form = latest_filing.form

        warnings = []
        metrics_dict: Dict[str, Optional[dict]] = {}
        
        # Extract latest value and prior comparable value for KPI cards
        for metric_key in METRIC_CONCEPTS.keys():
            latest_val = self._extract_metric_value(all_facts, latest_filing, metric_key)
            metrics_dict[metric_key] = latest_val

            # Trace if derived to add a warning
            if latest_val and latest_val.get("is_derived"):
                warnings.append(f"Derived quarterly value for {METRIC_LABELS.get(metric_key)} in period {latest_val.get('end_date')}.")

        # Retrieve prior comparable period value for metrics
        kpi_metrics = []
        kpis_to_show = ["revenue", "net_income", "cash", "assets", "liabilities", "equity"]
        
        # Find prior comparable filing
        prior_filing = None
        for f in recent_filings[1:]:
            if f.form.upper() == latest_filing.form.upper():
                # Compare by report_date: approximately 365 days prior
                try:
                    d_latest = datetime.strptime(latest_filing.report_date, "%Y-%m-%d")
                    d_f = datetime.strptime(f.report_date, "%Y-%m-%d")
                    diff_days = abs((d_latest - d_f).days)
                    if 330 <= diff_days <= 400:
                        prior_filing = f
                        break
                except Exception:
                    continue

        for key in kpis_to_show:
            latest_data = metrics_dict[key]
            prior_data = None
            if prior_filing:
                prior_data = self._extract_metric_value(all_facts, prior_filing, key)
                if prior_data and prior_data.get("is_derived"):
                    warnings.append(f"Derived quarterly value for {METRIC_LABELS.get(key)} in prior comparable period {prior_data.get('end_date')}.")

            # Compute change and status
            val = latest_data["value"] if latest_data else None
            p_val = prior_data["value"] if prior_data else None
            
            abs_change = None
            pct_change = None
            status = "unavailable"

            if val is not None and p_val is not None:
                abs_change = val - p_val
                # Apply diff rules: null when prior <= 0 or sign changes
                if p_val <= 0:
                    pct_change = None
                elif (p_val > 0 and val < 0) or (p_val < 0 and val > 0):
                    pct_change = None
                else:
                    pct_change = abs_change / p_val
                
                if abs_change > 0:
                    status = "increased"
                elif abs_change < 0:
                    status = "decreased"
                else:
                    status = "unchanged"

            kpi_metrics.append(DashboardMetric(
                key=key,
                concept=latest_data["concept"] if latest_data else (METRIC_CONCEPTS.get(key)[0] if METRIC_CONCEPTS.get(key) else ""),
                label=METRIC_LABELS.get(key, key),
                value=val,
                prior_value=p_val,
                unit=latest_data["unit"] if latest_data else (prior_data["unit"] if prior_data else "USD"),
                period_end=latest_data["end_date"] if latest_data else None,
                prior_period_end=prior_data["end_date"] if prior_data else None,
                absolute_change=abs_change,
                percentage_change=pct_change,
                source_url=latest_data["source_url"] if latest_data else None,
                accession_number=latest_data.get("accession_number") if latest_data else None,
                filed_date=latest_data.get("filed_date") if latest_data else None,
                status=status
            ))

        # Ratios calculation
        ratios = []

        # Gross margin = Gross profit / Revenue
        revenue_val = metrics_dict["revenue"]["value"] if metrics_dict["revenue"] else None
        gross_profit_val = metrics_dict["gross_profit"]["value"] if metrics_dict["gross_profit"] else None
        
        prior_revenue_val = None
        prior_gross_profit_val = None
        if prior_filing:
            prior_rev = self._extract_metric_value(all_facts, prior_filing, "revenue")
            prior_gp = self._extract_metric_value(all_facts, prior_filing, "gross_profit")
            prior_revenue_val = prior_rev["value"] if prior_rev else None
            prior_gross_profit_val = prior_gp["value"] if prior_gp else None

        gm_val = None
        gm_prior = None
        if revenue_val and gross_profit_val and revenue_val != 0:
            gm_val = gross_profit_val / revenue_val
        if prior_revenue_val and prior_gross_profit_val and prior_revenue_val != 0:
            gm_prior = prior_gross_profit_val / prior_revenue_val

        gm_abs = (gm_val - gm_prior) if gm_val is not None and gm_prior is not None else None
        gm_status = "unavailable"
        if gm_abs is not None:
            gm_status = "increased" if gm_abs > 0 else ("decreased" if gm_abs < 0 else "unchanged")

        ratios.append(FinancialRatio(
            key="gross_margin",
            label="Gross Margin",
            value=gm_val,
            prior_value=gm_prior,
            absolute_change=gm_abs,
            status=gm_status,
            formula="Gross Margin = Gross Profit / Revenue",
            period_end=latest_period_end
        ))

        # Operating margin = Operating income / Revenue
        op_inc_val = metrics_dict["operating_income"]["value"] if metrics_dict["operating_income"] else None
        prior_op_inc_val = None
        if prior_filing:
            prior_op_inc = self._extract_metric_value(all_facts, prior_filing, "operating_income")
            prior_op_inc_val = prior_op_inc["value"] if prior_op_inc else None

        om_val = None
        om_prior = None
        if revenue_val and op_inc_val and revenue_val != 0:
            om_val = op_inc_val / revenue_val
        if prior_revenue_val and prior_op_inc_val and prior_revenue_val != 0:
            om_prior = prior_op_inc_val / prior_revenue_val

        om_abs = (om_val - om_prior) if om_val is not None and om_prior is not None else None
        om_status = "unavailable"
        if om_abs is not None:
            om_status = "increased" if om_abs > 0 else ("decreased" if om_abs < 0 else "unchanged")

        ratios.append(FinancialRatio(
            key="operating_margin",
            label="Operating Margin",
            value=om_val,
            prior_value=om_prior,
            absolute_change=om_abs,
            status=om_status,
            formula="Operating Margin = Operating Income / Revenue",
            period_end=latest_period_end
        ))

        # Net margin = Net income / Revenue
        ni_val = metrics_dict["net_income"]["value"] if metrics_dict["net_income"] else None
        prior_ni_val = None
        if prior_filing:
            prior_ni = self._extract_metric_value(all_facts, prior_filing, "net_income")
            prior_ni_val = prior_ni["value"] if prior_ni else None

        nm_val = None
        nm_prior = None
        if revenue_val and ni_val and revenue_val != 0:
            nm_val = ni_val / revenue_val
        if prior_revenue_val and prior_ni_val and prior_revenue_val != 0:
            nm_prior = prior_ni_val / prior_revenue_val

        nm_abs = (nm_val - nm_prior) if nm_val is not None and nm_prior is not None else None
        nm_status = "unavailable"
        if nm_abs is not None:
            nm_status = "increased" if nm_abs > 0 else ("decreased" if nm_abs < 0 else "unchanged")

        ratios.append(FinancialRatio(
            key="net_margin",
            label="Net Margin",
            value=nm_val,
            prior_value=nm_prior,
            absolute_change=nm_abs,
            status=nm_status,
            formula="Net Margin = Net Income / Revenue",
            period_end=latest_period_end
        ))

        # Current ratio = Current assets / Current liabilities
        curr_assets_val = metrics_dict["current_assets"]["value"] if metrics_dict["current_assets"] else None
        curr_liab_val = metrics_dict["current_liabilities"]["value"] if metrics_dict["current_liabilities"] else None

        prior_curr_assets_val = None
        prior_curr_liab_val = None
        if prior_filing:
            prior_curr_assets = self._extract_metric_value(all_facts, prior_filing, "current_assets")
            prior_curr_liab = self._extract_metric_value(all_facts, prior_filing, "current_liabilities")
            prior_curr_assets_val = prior_curr_assets["value"] if prior_curr_assets else None
            prior_curr_liab_val = prior_curr_liab["value"] if prior_curr_liab else None

        cr_val = None
        cr_prior = None
        if curr_assets_val and curr_liab_val and curr_liab_val != 0:
            cr_val = curr_assets_val / curr_liab_val
        if prior_curr_assets_val and prior_curr_liab_val and prior_curr_liab_val != 0:
            cr_prior = prior_curr_assets_val / prior_curr_liab_val

        cr_abs = (cr_val - cr_prior) if cr_val is not None and cr_prior is not None else None
        cr_status = "unavailable"
        if cr_abs is not None:
            cr_status = "increased" if cr_abs > 0 else ("decreased" if cr_abs < 0 else "unchanged")

        ratios.append(FinancialRatio(
            key="current_ratio",
            label="Current Ratio",
            value=cr_val,
            prior_value=cr_prior,
            absolute_change=cr_abs,
            status=cr_status,
            formula="Current Ratio = Current Assets / Current Liabilities",
            period_end=latest_period_end
        ))

        # Debt-to-equity = Liabilities / Stockholders’ equity
        liab_val = metrics_dict["liabilities"]["value"] if metrics_dict["liabilities"] else None
        equity_val = metrics_dict["equity"]["value"] if metrics_dict["equity"] else None

        prior_liab_val = None
        prior_equity_val = None
        if prior_filing:
            prior_liab = self._extract_metric_value(all_facts, prior_filing, "liabilities")
            prior_equity = self._extract_metric_value(all_facts, prior_filing, "equity")
            prior_liab_val = prior_liab["value"] if prior_liab else None
            prior_equity_val = prior_equity["value"] if prior_equity else None

        de_val = None
        de_prior = None
        if liab_val and equity_val and equity_val != 0:
            de_val = liab_val / equity_val
        if prior_liab_val and prior_equity_val and prior_equity_val != 0:
            de_prior = prior_liab_val / prior_equity_val

        de_abs = (de_val - de_prior) if de_val is not None and de_prior is not None else None
        de_status = "unavailable"
        if de_abs is not None:
            de_status = "increased" if de_abs > 0 else ("decreased" if de_abs < 0 else "unchanged")

        ratios.append(FinancialRatio(
            key="debt_to_equity",
            label="Debt to Equity",
            value=de_val,
            prior_value=de_prior,
            absolute_change=de_abs,
            status=de_status,
            formula="Debt to Equity = Total Liabilities / Stockholders' Equity",
            period_end=latest_period_end
        ))

        # Return on assets = Net income / average assets, only when compatible annual facts exist
        # Find latest 10-K in submissions
        latest_10k = next((f for f in recent_filings if f.form.upper() == "10-K"), None)
        roa_val = None
        roa_prior = None
        roa_period_end = None

        if latest_10k:
            roa_period_end = latest_10k.report_date
            # Retrieve annual Net income
            roa_ni = self._extract_metric_value(all_facts, latest_10k, "net_income")
            # Retrieve Assets at FY end
            roa_assets_curr = self._extract_metric_value(all_facts, latest_10k, "assets")
            # Find prior 10-K
            prior_10k = None
            prior_prior_10k = None
            found_idx = -1
            for idx, f in enumerate(recent_filings):
                if f.accession_number == latest_10k.accession_number:
                    found_idx = idx
                    break
            
            if found_idx != -1:
                # Prior 10-K
                for f in recent_filings[found_idx+1:]:
                    if f.form.upper() == "10-K":
                        prior_10k = f
                        break
                if prior_10k:
                    # Prior prior 10-K (to average prior assets)
                    for f in recent_filings[recent_filings.index(prior_10k)+1:]:
                        if f.form.upper() == "10-K":
                            prior_prior_10k = f
                            break

            if roa_ni and roa_assets_curr and prior_10k:
                roa_assets_prev = self._extract_metric_value(all_facts, prior_10k, "assets")
                if roa_assets_prev and roa_ni["value"] is not None and roa_assets_curr["value"] is not None and roa_assets_prev["value"] is not None:
                    avg_assets = (roa_assets_curr["value"] + roa_assets_prev["value"]) / 2
                    if avg_assets != 0:
                        roa_val = roa_ni["value"] / avg_assets

            # Try to calculate ROA for prior period too
            if prior_10k and prior_prior_10k:
                roa_ni_prior = self._extract_metric_value(all_facts, prior_10k, "net_income")
                roa_assets_prior_curr = self._extract_metric_value(all_facts, prior_10k, "assets")
                roa_assets_prior_prev = self._extract_metric_value(all_facts, prior_prior_10k, "assets")
                if roa_ni_prior and roa_assets_prior_curr and roa_assets_prior_prev:
                    avg_assets_prior = (roa_assets_prior_curr["value"] + roa_assets_prior_prev["value"]) / 2
                    if avg_assets_prior != 0:
                        roa_prior = roa_ni_prior["value"] / avg_assets_prior

        roa_abs = (roa_val - roa_prior) if roa_val is not None and roa_prior is not None else None
        roa_status = "unavailable"
        if roa_abs is not None:
            roa_status = "increased" if roa_abs > 0 else ("decreased" if roa_abs < 0 else "unchanged")

        ratios.append(FinancialRatio(
            key="return_on_assets",
            label="Return on Assets (Annual)",
            value=roa_val,
            prior_value=roa_prior,
            absolute_change=roa_abs,
            status=roa_status,
            formula="ROA = Net Income (Annual) / Average Total Assets",
            period_end=roa_period_end
        ))

        # Return on equity = Net income / average equity, only when compatible annual facts exist
        roe_val = None
        roe_prior = None

        if latest_10k:
            roe_ni = self._extract_metric_value(all_facts, latest_10k, "net_income")
            roe_equity_curr = self._extract_metric_value(all_facts, latest_10k, "equity")
            
            if roe_ni and roe_equity_curr and prior_10k:
                roe_equity_prev = self._extract_metric_value(all_facts, prior_10k, "equity")
                if roe_equity_prev and roe_ni["value"] is not None and roe_equity_curr["value"] is not None and roe_equity_prev["value"] is not None:
                    avg_equity = (roe_equity_curr["value"] + roe_equity_prev["value"]) / 2
                    if avg_equity != 0:
                        roe_val = roe_ni["value"] / avg_equity
            
            if prior_10k and prior_prior_10k:
                roe_ni_prior = self._extract_metric_value(all_facts, prior_10k, "net_income")
                roe_equity_prior_curr = self._extract_metric_value(all_facts, prior_10k, "equity")
                roe_equity_prior_prev = self._extract_metric_value(all_facts, prior_prior_10k, "equity")
                if roe_ni_prior and roe_equity_prior_curr and roe_equity_prior_prev:
                    avg_equity_prior = (roe_equity_prior_curr["value"] + roe_equity_prior_prev["value"]) / 2
                    if avg_equity_prior != 0:
                        roe_prior = roe_ni_prior["value"] / avg_equity_prior

        roe_abs = (roe_val - roe_prior) if roe_val is not None and roe_prior is not None else None
        roe_status = "unavailable"
        if roe_abs is not None:
            roe_status = "increased" if roe_abs > 0 else ("decreased" if roe_abs < 0 else "unchanged")

        ratios.append(FinancialRatio(
            key="return_on_equity",
            label="Return on Equity (Annual)",
            value=roe_val,
            prior_value=roe_prior,
            absolute_change=roe_abs,
            status=roe_status,
            formula="ROE = Net Income (Annual) / Average Stockholders' Equity",
            period_end=roa_period_end
        ))

        # Construct Trend Series
        series_keys = [
            "revenue", "net_income", "cash", "assets", "liabilities", "operating_cash_flow",
            "gross_profit", "operating_income", "equity", "current_assets", "current_liabilities"
        ]
        series_list = []

        # We will output two trend series for each metric: one quarterly, one annual
        # So we don't mix them.
        for key in series_keys:
            # 1. Quarterly Series
            q_points = []
            for filing in recent_filings[:20]: # look back up to 20 filings to find points
                metric_data = self._extract_metric_value(all_facts, filing, key)
                if metric_data:
                    # Filter out annual durations from quarterly series
                    is_dur = key not in INSTANT_METRICS
                    if is_dur:
                        days = self._get_duration_days(metric_data["start_date"], metric_data["end_date"])
                        if days is not None and days > 120:
                            continue # skip annual or YTD

                    # Extract details
                    q_points.append(DashboardSeriesPoint(
                        value=metric_data["value"],
                        period_end=filing.report_date,
                        fiscal_year=filing.fiscal_year if hasattr(filing, 'fiscal_year') else None,
                        fiscal_period=filing.fiscal_period if hasattr(filing, 'fiscal_period') else None,
                        form=filing.form,
                        accession_number=filing.accession_number,
                        source_url=metric_data["source_url"]
                    ))

            # Deduplicate by period_end (preferring latest accession, i.e. first one found in recent_filings descending)
            q_seen = {}
            for p in q_points:
                if p.period_end not in q_seen:
                    q_seen[p.period_end] = p
            
            final_q_points = sorted(list(q_seen.values()), key=lambda x: x.period_end)
            unit_str = "USD"
            if final_q_points and metrics_dict.get(key) and metrics_dict.get(key).get("unit"):
                unit_str = metrics_dict[key]["unit"]

            series_list.append(DashboardSeries(
                key=f"{key}_quarterly",
                label=f"{METRIC_LABELS.get(key)} (Quarterly)",
                unit=unit_str,
                points=final_q_points
            ))

            # 2. Annual Series
            a_points = []
            for filing in recent_filings[:20]:
                if filing.form.upper() == "10-K":
                    metric_data = self._extract_metric_value(all_facts, filing, key)
                    if metric_data:
                        a_points.append(DashboardSeriesPoint(
                            value=metric_data["value"],
                            period_end=filing.report_date,
                            fiscal_year=filing.fiscal_year if hasattr(filing, 'fiscal_year') else None,
                            fiscal_period="FY",
                            form="10-K",
                            accession_number=filing.accession_number,
                            source_url=metric_data["source_url"]
                        ))
            
            a_seen = {}
            for p in a_points:
                if p.period_end not in a_seen:
                    a_seen[p.period_end] = p
            
            final_a_points = sorted(list(a_seen.values()), key=lambda x: x.period_end)

            series_list.append(DashboardSeries(
                key=f"{key}_annual",
                label=f"{METRIC_LABELS.get(key)} (Annual)",
                unit=unit_str,
                points=final_a_points
            ))

        # Compute and append ratio/margin trend series
        series_map = {s.key: s for s in series_list}

        def compute_ratio_series(key_name, label_name, numerator_key, denominator_key, is_percentage=False):
            # 1. Quarterly
            q_num_map = {p.period_end: p for p in series_map.get(f"{numerator_key}_quarterly").points} if f"{numerator_key}_quarterly" in series_map else {}
            q_den_map = {p.period_end: p for p in series_map.get(f"{denominator_key}_quarterly").points} if f"{denominator_key}_quarterly" in series_map else {}
            
            q_ratio_points = []
            for pe, num_pt in q_num_map.items():
                if pe in q_den_map and q_den_map[pe].value != 0:
                    val = num_pt.value / q_den_map[pe].value
                    if is_percentage:
                        val = val * 100
                    q_ratio_points.append(DashboardSeriesPoint(
                        value=val,
                        period_end=pe,
                        fiscal_year=num_pt.fiscal_year,
                        fiscal_period=num_pt.fiscal_period,
                        form=num_pt.form,
                        accession_number=num_pt.accession_number,
                        source_url=num_pt.source_url
                    ))
            q_ratio_points.sort(key=lambda x: x.period_end)
            series_list.append(DashboardSeries(
                key=f"{key_name}_quarterly",
                label=f"{label_name} (Quarterly)",
                unit="%" if is_percentage else "Ratio",
                points=q_ratio_points
            ))

            # 2. Annual
            a_num_map = {p.period_end: p for p in series_map.get(f"{numerator_key}_annual").points} if f"{numerator_key}_annual" in series_map else {}
            a_den_map = {p.period_end: p for p in series_map.get(f"{denominator_key}_annual").points} if f"{denominator_key}_annual" in series_map else {}
            
            a_ratio_points = []
            for pe, num_pt in a_num_map.items():
                if pe in a_den_map and a_den_map[pe].value != 0:
                    val = num_pt.value / a_den_map[pe].value
                    if is_percentage:
                        val = val * 100
                    a_ratio_points.append(DashboardSeriesPoint(
                        value=val,
                        period_end=pe,
                        fiscal_year=num_pt.fiscal_year,
                        fiscal_period="FY",
                        form="10-K",
                        accession_number=num_pt.accession_number,
                        source_url=num_pt.source_url
                    ))
            a_ratio_points.sort(key=lambda x: x.period_end)
            series_list.append(DashboardSeries(
                key=f"{key_name}_annual",
                label=f"{label_name} (Annual)",
                unit="%" if is_percentage else "Ratio",
                points=a_ratio_points
            ))

        compute_ratio_series("gross_margin", "Gross Margin", "gross_profit", "revenue", is_percentage=True)
        compute_ratio_series("operating_margin", "Operating Margin", "operating_income", "revenue", is_percentage=True)
        compute_ratio_series("net_margin", "Net Margin", "net_income", "revenue", is_percentage=True)
        compute_ratio_series("current_ratio", "Current Ratio", "current_assets", "current_liabilities")
        compute_ratio_series("debt_to_equity", "Debt to Equity", "liabilities", "equity")
        compute_ratio_series("return_on_assets", "Return on Assets", "net_income", "assets")
        compute_ratio_series("return_on_equity", "Return on Equity", "net_income", "equity")

        # Compute Health Scores (Growth, Profitability, Liquidity, Leverage, Stability)
        # 1. Growth Score (Revenue change YoY)
        revenue_metric = next((m for m in kpi_metrics if m.key == "revenue"), None)
        rev_change = revenue_metric.percentage_change if revenue_metric else None
        growth_score = min(100, max(0, int(50 + (rev_change * 250)))) if rev_change is not None else 50
        
        # 2. Profitability Score (Net Margin)
        net_margin_ratio = next((r for r in ratios if r.key == "net_margin"), None)
        nm_val = net_margin_ratio.value if net_margin_ratio else None
        profitability_score = min(100, max(0, int((nm_val or 0.0) * 400))) if nm_val is not None else 50
        
        # 3. Liquidity Score (Current Ratio)
        current_ratio_ratio = next((r for r in ratios if r.key == "current_ratio"), None)
        cr_val = current_ratio_ratio.value if current_ratio_ratio else None
        liquidity_score = min(100, max(0, int(((cr_val or 1.0) - 0.5) / 1.5 * 100))) if cr_val is not None else 50
        
        # 4. Leverage Score (Debt to Equity)
        debt_to_equity_ratio = next((r for r in ratios if r.key == "debt_to_equity"), None)
        de_val = debt_to_equity_ratio.value if debt_to_equity_ratio else None
        leverage_score = min(100, max(0, int(100 - ((de_val or 1.0) / 3.0 * 100)))) if de_val is not None else 50
        
        # 5. Financial Stability Score
        cash_metric = next((m for m in kpi_metrics if m.key == "cash"), None)
        cash_change = cash_metric.percentage_change if cash_metric else None
        net_income_metric = next((m for m in kpi_metrics if m.key == "net_income"), None)
        ni_val = net_income_metric.value if net_income_metric else None
        
        stability_score = 50
        if ni_val and ni_val > 0:
            stability_score += 25
        if cash_change and cash_change > 0:
            stability_score += 25
            
        overall_health = int((growth_score + profitability_score + liquidity_score + leverage_score + stability_score) / 5)
        
        health_breakdown = HealthScoreBreakdown(
            overall=overall_health,
            growth=growth_score,
            profitability=profitability_score,
            liquidity=liquidity_score,
            leverage=leverage_score,
            stability=stability_score
        )
        
        # Generate Deterministic AI Insights Panel
        # Strength
        scores = [
            ("profitability", profitability_score, f"High Net Profit Margin of {nm_val * 100:.2f}%" if nm_val is not None else "Consistent operating efficiency"),
            ("growth", growth_score, f"Strong top-line expansion with Revenue growing {rev_change * 100:.2f}% YoY" if rev_change is not None else "Consistent revenue scale"),
            ("liquidity", liquidity_score, f"Healthy liquidity cushion with a Current Ratio of {cr_val:.2f}" if cr_val is not None else "Stable short-term obligations coverage"),
            ("leverage", leverage_score, f"Conservative leverage profile with a low Debt-to-Equity ratio of {de_val:.2f}" if de_val is not None else "Conservative capital structure")
        ]
        scores.sort(key=lambda x: x[1], reverse=True)
        biggest_strength = f"Robust financial foundation driven by: {scores[0][2]}."
        
        # Risk
        scores_asc = list(scores)
        scores_asc.sort(key=lambda x: x[1])
        biggest_risk = f"Potential pressure point identified: {scores_asc[0][2]}."
        if scores_asc[0][1] >= 80:
            biggest_risk = "Excellent performance metrics; primary risks remain macroeconomic factors and industry competitiveness."
            
        # Change
        chg_metric = None
        max_abs_pct = -1.0
        for m in kpi_metrics:
            if m.percentage_change is not None:
                abs_pct = abs(m.percentage_change)
                if abs_pct > max_abs_pct:
                    max_abs_pct = abs_pct
                    chg_metric = m
                    
        if chg_metric:
            direction = "increased" if chg_metric.percentage_change > 0 else "decreased"
            biggest_change = f"Material YoY shift in {chg_metric.label}, which {direction} by {abs(chg_metric.percentage_change) * 100:.1f}%."
        else:
            biggest_change = "Stable YoY balance sheet and income statement KPIs."
            
        # Important metric
        if revenue_metric and revenue_metric.value is not None:
            important_val = f"${revenue_metric.value / 1e9:.2f}B" if abs(revenue_metric.value) >= 1e9 else f"${revenue_metric.value / 1e6:.2f}M"
            rev_change_str = f" ({'+' if rev_change > 0 else ''}{rev_change * 100:.1f}% YoY)" if rev_change is not None else ""
            most_important_metric = f"Revenue of {important_val}{rev_change_str}, representing top-line scale and market penetration."
        else:
            most_important_metric = "Primary profitability and liquidity indexes serve as core key indicators."
            
        # Watch
        if scores_asc[0][0] == "profitability":
            watch_next_quarter = "Monitor operating income margins and input cost scaling pressures."
        elif scores_asc[0][0] == "liquidity":
            watch_next_quarter = "Monitor cash generation conversion efficiency and working capital requirements."
        elif scores_asc[0][0] == "leverage":
            watch_next_quarter = "Monitor long-term debt repayment obligations and leverage solvency index."
        else:
            watch_next_quarter = "Monitor top-line revenue growth momentum and cash levels."
            
        ai_insights_panel = AIInsightPanel(
            biggest_strength=biggest_strength,
            biggest_risk=biggest_risk,
            biggest_change=biggest_change,
            most_important_metric=most_important_metric,
            watch_next_quarter=watch_next_quarter
        )
        
        # Quarter Highlights Timeline (last 6 filings)
        timeline_list = []
        for filing in recent_filings[:6]:
            r_data = self._extract_metric_value(all_facts, filing, "revenue")
            ni_data = self._extract_metric_value(all_facts, filing, "net_income")
            
            val_to_use = r_data if r_data and r_data.get("value") is not None else ni_data
            metric_label = "Revenue" if r_data and r_data.get("value") is not None else "Net Income"
            
            if val_to_use and val_to_use.get("value") is not None:
                val = val_to_use["value"]
                formatted_val = f"${val / 1e9:.2f}B" if abs(val) >= 1e9 else f"${val / 1e6:.2f}M"
                timeline_list.append(QuarterHighlight(
                    metric=metric_label,
                    change=formatted_val,
                    filing=f"{filing.form} (Reported {filing.report_date})",
                    explanation=f"Reported {metric_label.lower()} of {formatted_val} for the fiscal period ending {filing.report_date}."
                ))

        # Check for general warnings
        if not all_facts:
            warnings.append("No financial facts available for this company.")
        if roa_val is None:
            warnings.append("Annual Return on Assets is unavailable due to missing or incompatible historical 10-K filings.")

        return FinancialDashboardResponse(
            cik=cik,
            company_name=company_name,
            latest_period_end=latest_period_end,
            latest_form=latest_form,
            metrics=kpi_metrics,
            ratios=ratios,
            series=series_list,
            warnings=warnings,
            ai_insights=ai_insights_panel,
            health_score=health_breakdown,
            timeline=timeline_list
        )
