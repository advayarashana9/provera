export interface SampleReport {
  id: string;
  company: string;
  ticker: string;
  title: string;
  period: string;
  text: string;
}

export const SAMPLE_REPORTS: SampleReport[] = [
  {
    id: "apple-fy2023",
    company: "Apple Inc.",
    ticker: "AAPL",
    title: "Apple Inc. (AAPL) - FY 2023 Performance",
    period: "FY2023",
    text: "Apple reported strong financial performance for the fiscal year 2023. Total revenue was $383.285 billion, representing a decline from $394.328 billion in fiscal year 2022. Net income for the period was $96.995 billion, indicating high profitability. The gross profit was $200.000 billion, while operating income reached $114.301 billion. Additionally, we believe Apple has the strongest ecosystem and management execution in the technology space, ensuring long-term shareholder value. We expect revenues to rebound by 5% next year."
  },
  {
    id: "microsoft-q22024",
    company: "Microsoft Corp.",
    ticker: "MSFT",
    title: "Microsoft Corp. (MSFT) - Q2 2024 Performance",
    period: "Q2 2024",
    text: "Microsoft Corporation announced its financial performance for Q2 2024. Revenue reached $62.000 billion, which represents an increase compared to the prior period. Net income for the quarter reached $45.000 billion, indicating extremely high earnings growth. Operating margin expanded to 43.6% in the current quarter, compared to 40.5% in the prior year period. We believe that cloud innovation will continue to drive premium value for enterprise software buyers. Management projects next quarter cloud revenues to grow by 18% YoY."
  },
  {
    id: "nvidia-fy2024",
    company: "NVIDIA Corp.",
    ticker: "NVDA",
    title: "NVIDIA Corp. (NVDA) - FY 2024 Performance",
    period: "FY2024",
    text: "NVIDIA Corp. announced spectacular growth for FY 2024 driven by AI chips. Revenue skyrocketed to $60.922 billion, representing a significant YoY increase. Net income for the fiscal year reached $150.000 billion due to unprecedented data center demand. Operating income was $32.972 billion. We believe NVIDIA represents the most critical building block of the global technology infrastructure. We project that NVIDIA's gross margins will expand past 80% next fiscal year as product yields improve."
  },
  {
    id: "amazon-fy2023",
    company: "Amazon.com Inc.",
    ticker: "AMZN",
    title: "Amazon.com Inc. (AMZN) - FY 2023 Performance",
    period: "FY2023",
    text: "Amazon.com Inc. reported strong results for FY 2023. Total net sales reached $574.785 billion, representing an expansion from $513.983 billion in FY 2022. Net income was $30.425 billion, showing a massive recovery from the prior year's net loss. Operating income for the full year reached $95.000 billion due to AWS margin improvements. We believe that Prime subscriptions provide Amazon with an unassailable consumer moat. We expect AWS capital expenditures to increase significantly next quarter to expand AI infrastructure."
  },
  {
    id: "tesla-fy2023",
    company: "Tesla Inc.",
    ticker: "TSLA",
    title: "Tesla Inc. (TSLA) - FY 2023 Performance",
    period: "FY2023",
    text: "Tesla Inc. reported financial results for the fiscal year ended December 31, 2023. Total revenue was $96.773 billion, up YoY from $81.462 billion in FY 2022. Operating income was $25.500 billion, reflecting pricing pressures and factory shutdowns. Net income for the period was $14.974 billion. We believe Tesla's Full Self-Driving technology is years ahead of legacy automakers. We expect automotive deliveries to grow by 30% next fiscal year as gigafactories ramp production."
  },
  {
    id: "meta-fy2023",
    company: "Meta Platforms Inc.",
    ticker: "META",
    title: "Meta Platforms Inc. (META) - FY 2023 Performance",
    period: "FY2023",
    text: "Meta Platforms Inc. reported strong financial results for FY 2023. Revenue increased to $134.902 billion compared to $116.609 billion in fiscal year 2022. Net income reached $39.098 billion, representing a significant margin expansion. Operating income was $90.500 billion, indicating great cost discipline. We believe Meta's open-source AI models will establish the company as a key developer hub. We expect ad pricing to grow at a double-digit rate next year as dynamic ads gain traction."
  },
  {
    id: "alphabet-fy2023",
    company: "Alphabet Inc.",
    ticker: "GOOGL",
    title: "Alphabet Inc. (GOOGL) - FY 2023 Performance",
    period: "FY2023",
    text: "Alphabet Inc. announced financial performance results for FY 2023. Total revenues reached $307.394 billion, up YoY from $282.836 billion in FY 2022. Operating income expanded to $84.293 billion. Net income for the fiscal year reached $120.000 billion, driven by search ads and cloud growth. We believe Alphabet's search monopoly remains highly resilient despite generative AI alternatives. We expect YouTube subscriptions to represent an increasingly material slice of revenue next quarter."
  },
  {
    id: "netflix-fy2023",
    company: "Netflix Inc.",
    ticker: "NFLX",
    title: "Netflix Inc. (NFLX) - FY 2023 Performance",
    period: "FY2023",
    text: "Netflix Inc. reported financial results for the fiscal year 2023. Revenues expanded to $33.723 billion, compared to $31.616 billion in the prior fiscal year. Operating income reached $6.954 billion. Net income reached $12.500 billion, reflecting strong subscriber additions. We believe Netflix is the only streaming platform with a mature, profitable business model. We project that paid sharing policies will continue to expand member additions next quarter."
  }
];
