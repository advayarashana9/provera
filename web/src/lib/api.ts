export interface CompanySearchResult {
  cik: number;
  ticker: string;
  name: string;
}

export interface CompanyOverview {
  cik: number;
  name: string;
  tickers: string[];
  exchanges: string[];
  sic?: string | null;
  sic_description?: string | null;
  fiscal_year_end?: string | null;
  state_of_incorporation?: string | null;
  entity_type?: string | null;
  website?: string | null;
  investor_website?: string | null;
  phone?: string | null;
}

export interface FilingSummary {
  accession_number: string;
  filing_date: string;
  report_date?: string | null;
  acceptance_datetime?: string | null;
  form: string;
  file_number?: string | null;
  primary_document: string;
  primary_document_description?: string | null;
  sec_url: string;
}

export interface RecentFilingsResponse {
  cik: number;
  company_name: string;
  filings: FilingSummary[];
  count: number;
}

export interface VerificationEvidence {
  namespace: string;
  concept: string;
  label?: string | null;
  value: number;
  unit: string;
  end_date: string;
  start_date?: string | null;
  form?: string | null;
  filed_date?: string | null;
  accession_number?: string | null;
  source_url?: string | null;
}

export interface VerificationFinding {
  check_id: string;
  title: string;
  category: string;
  status: string;
  severity: string;
  confidence: number;
  period_end: string;
  form?: string | null;
  unit: string;
  reported_value?: number | null;
  expected_value?: number | null;
  difference?: number | null;
  relative_difference?: number | null;
  equation?: string | null;
  explanation: string;
  possible_explanations: string[];
  evidence: VerificationEvidence[];
}

export interface VerificationSummary {
  cik: number;
  company_name: string;
  checks_run: number;
  checks_passed: number;
  confirmed_inconsistencies: number;
  review_items: number;
  skipped_checks: number;
  findings: VerificationFinding[];
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

/**
 * Common API fetch helper. Handles error parsing cleanly.
 */
async function fetchFromApi<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const response = await fetch(url, options);
  if (!response.ok) {
    let errorDetail = "";
    try {
      const errJson = await response.json();
      errorDetail = errJson.detail || JSON.stringify(errJson);
    } catch {
      errorDetail = response.statusText;
    }
    throw new Error(`API Error ${response.status}: ${errorDetail}`);
  }
  return response.json() as Promise<T>;
}

/**
 * Search companies by ticker or name.
 */
export async function searchCompanies(query: string, signal?: AbortSignal): Promise<CompanySearchResult[]> {
  if (!query || !query.trim()) {
    return [];
  }
  const data = await fetchFromApi<{ results: CompanySearchResult[] }>(
    `/companies/search?q=${encodeURIComponent(query)}`,
    { signal }
  );
  return data.results;
}

/**
 * Fetch company profile overview details.
 */
export async function getCompanyOverview(cik: number, signal?: AbortSignal): Promise<CompanyOverview> {
  return fetchFromApi<CompanyOverview>(`/companies/${cik}/overview`, { signal });
}

/**
 * Fetch list of recent filings.
 */
export async function getRecentFilings(
  cik: number,
  forms?: string,
  limit?: number,
  signal?: AbortSignal
): Promise<RecentFilingsResponse> {
  let path = `/companies/${cik}/filings`;
  const params = new URLSearchParams();
  if (forms) {
    params.append("forms", forms);
  }
  if (limit !== undefined) {
    params.append("limit", limit.toString());
  }
  const queryStr = params.toString();
  if (queryStr) {
    path += `?${queryStr}`;
  }
  return fetchFromApi<RecentFilingsResponse>(path, { signal });
}

/**
 * Run deterministic verification engine on the company's facts.
 */
export async function verifyCompany(
  cik: number,
  forms?: string,
  limitPeriods?: number,
  signal?: AbortSignal
): Promise<VerificationSummary> {
  let path = `/companies/${cik}/verify`;
  const params = new URLSearchParams();
  if (forms) {
    params.append("forms", forms);
  }
  if (limitPeriods !== undefined) {
    params.append("limit_periods", limitPeriods.toString());
  }
  const queryStr = params.toString();
  if (queryStr) {
    path += `?${queryStr}`;
  }
  return fetchFromApi<VerificationSummary>(path, { signal });
}

export interface ChatCitation {
  id: number;
  concept: string;
  label?: string | null;
  value: number;
  unit: string;
  period_end: string;
  form?: string | null;
  accession_number?: string | null;
  source_url?: string | null;
}

export interface ChatComparison {
  concept: string;
  label?: string | null;
  current_value: number;
  prior_value: number;
  unit: string;
  current_period_end: string;
  prior_period_end: string;
  absolute_change: number;
  percentage_change?: number | null;
}

export interface ChatResponse {
  answer: string;
  citations: ChatCitation[];
  comparisons: ChatComparison[];
  evidence_count: number;
  insufficient_evidence: boolean;
}

/**
 * Ask Gemini a question about the company's SEC filings.
 */
export async function askQuestion(
  cik: number,
  question: string,
  signal?: AbortSignal
): Promise<ChatResponse> {
  return fetchFromApi<ChatResponse>(`/companies/${cik}/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question }),
    signal,
  });
}

export interface FilingDiffRequest {
  older_accession_number: string;
  newer_accession_number: string;
}

export interface FilingSectionChange {
  section: string;
  change_type: string;
  summary: string;
  older_excerpt?: string | null;
  newer_excerpt?: string | null;
  older_source_url?: string | null;
  newer_source_url?: string | null;
  confidence: number;
}

export interface FinancialMetricChange {
  concept: string;
  label?: string | null;
  older_value: number;
  newer_value: number;
  unit: string;
  absolute_change: number;
  percentage_change?: number | null;
  older_period_end: string;
  newer_period_end: string;
}

export interface FilingDiffResponse {
  cik: number;
  company_name: string;
  older_filing: FilingSummary;
  newer_filing: FilingSummary;
  metric_changes: FinancialMetricChange[];
  section_changes: FilingSectionChange[];
  generated_summary?: string | null;
  key_takeaways?: string[] | null;
  similarity_percentage: number;
  largest_financial_change?: number | null;
}


/**
 * Compare two filings for a company using deterministic checks and section diffs.
 */
export async function compareFilings(
  cik: number,
  olderAccession: string,
  newerAccession: string,
  signal?: AbortSignal
): Promise<FilingDiffResponse> {
  return fetchFromApi<FilingDiffResponse>(`/companies/${cik}/filing-diff`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      older_accession_number: olderAccession,
      newer_accession_number: newerAccession,
    }),
    signal,
  });
}


export interface DashboardMetric {
  key: string;
  concept: string;
  label: string;
  value: number | null;
  prior_value: number | null;
  unit: string | null;
  period_end: string | null;
  prior_period_end: string | null;
  absolute_change: number | null;
  percentage_change: number | null;
  source_url: string | null;
  accession_number?: string | null;
  filed_date?: string | null;
  status: string;
}


export interface DashboardSeriesPoint {
  value: number;
  period_end: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  form: string | null;
  accession_number: string | null;
  source_url: string | null;
}

export interface DashboardSeries {
  key: string;
  label: string;
  unit: string;
  points: DashboardSeriesPoint[];
}

export interface FinancialRatio {
  key: string;
  label: string;
  value: number | null;
  prior_value: number | null;
  absolute_change: number | null;
  status: string;
  formula: string;
  period_end: string | null;
}

export interface FinancialDashboardResponse {
  cik: number;
  company_name: string;
  ticker?: string | null;
  latest_period_end: string | null;
  latest_form: string | null;
  metrics: DashboardMetric[];
  ratios: FinancialRatio[];
  series: DashboardSeries[];
  warnings: string[];
}

/**
 * Fetch the financial dashboard for a company.
 */
export async function getFinancialDashboard(
  cik: number,
  forms?: string,
  periods?: number,
  signal?: AbortSignal
): Promise<FinancialDashboardResponse> {
  let path = `/companies/${cik}/dashboard`;
  const params = new URLSearchParams();
  if (forms) {
    params.append("forms", forms);
  }
  if (periods !== undefined) {
    params.append("periods", periods.toString());
  }
  const queryStr = params.toString();
  if (queryStr) {
    path += `?${queryStr}`;
  }
  return fetchFromApi<FinancialDashboardResponse>(path, { signal });
}

export interface ReportCitation {
  id: number;
  concept: string;
  label?: string | null;
  value: number;
  unit: string;
  period_end: string;
  form: string;
  source_url?: string | null;
}

export interface ReportSection {
  title: string;
  content: string;
  citations: number[];
}

export interface ReportMetadata {
  filing_type: string;
  filing_date: string;
  period_end: string;
  fiscal_quarter: string;
  cik: string;
  exchange: string;
}

export interface InvestmentSnapshot {
  overall_assessment: string;
  financial_health: string;
  liquidity: string;
  profitability: string;
  leverage: string;
  biggest_strength: string;
  biggest_risk: string;
  metrics_to_watch_next_quarter: string[];
}

export interface KeyMetricEntry {
  key: string;
  label: string;
  value: string;
  change_percentage: number | null;
  status: string | null;
}

export interface AIResearchReportResponse {
  title: string;
  metadata: ReportMetadata;
  investment_snapshot: InvestmentSnapshot;
  key_metrics: KeyMetricEntry[];
  executive_summary: ReportSection;
  business_overview: ReportSection;
  financial_highlights: ReportSection;
  balance_sheet: ReportSection;
  income_statement: ReportSection;
  cash_flow: ReportSection;
  profitability: ReportSection;
  risks: ReportSection;
  recent_changes: ReportSection;
  management_discussion: ReportSection;
  conclusion: ReportSection;
  citations: ReportCitation[];
}

export async function generateResearchReport(cik: number, periods: number = 4): Promise<AIResearchReportResponse> {
  return fetchFromApi<AIResearchReportResponse>(`/companies/${cik}/research-report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ periods })
  });
}

export async function downloadResearchReportPdf(cik: number, report: AIResearchReportResponse): Promise<Blob> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const res = await fetch(`${baseUrl}/companies/${cik}/research-report/pdf`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(report)
  });
  if (!res.ok) {
    throw new Error(`Failed to generate PDF: ${res.statusText}`);
  }
  return await res.blob();
}

export interface PeerComparisonResponse {
  base_cik: number;
  companies: FinancialDashboardResponse[];
}

export async function getPeerComparison(
  cik: number,
  peers?: string,
  periods?: number,
  signal?: AbortSignal
): Promise<PeerComparisonResponse> {
  let path = `/companies/${cik}/peer-comparison`;
  const params = new URLSearchParams();
  if (peers) {
    params.append("peers", peers);
  }
  if (periods !== undefined) {
    params.append("periods", periods.toString());
  }
  const queryStr = params.toString();
  if (queryStr) {
    path += `?${queryStr}`;
  }
  return fetchFromApi<PeerComparisonResponse>(path, { signal });
}

export interface InvestmentMemoSection {
  title: string;
  content: string;
  citations: number[];
}

export interface InvestmentMemoResponse {
  title: string;
  executive_summary: InvestmentMemoSection;
  business_overview: InvestmentMemoSection;
  financial_strength: InvestmentMemoSection;
  growth_drivers: InvestmentMemoSection;
  key_risks: InvestmentMemoSection;
  filing_changes: InvestmentMemoSection;
  competitive_position: InvestmentMemoSection;
  overall_assessment: InvestmentMemoSection;
  citations: ReportCitation[];
}

export async function generateInvestmentMemo(
  cik: number,
  peers: number[] = [],
  periods: number = 4
): Promise<InvestmentMemoResponse> {
  return fetchFromApi<InvestmentMemoResponse>(`/companies/${cik}/investment-memo`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ peers, periods })
  });
}

export async function downloadInvestmentMemoPdf(
  cik: number,
  memo: InvestmentMemoResponse
): Promise<Blob> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const res = await fetch(`${baseUrl}/companies/${cik}/investment-memo/pdf`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(memo)
  });
  if (!res.ok) {
    throw new Error(`Failed to generate Investment Memo PDF: ${res.statusText}`);
  }
  return await res.blob();
}



