/** Reviewed company presentation. These dated disclosures are not live estimates. */
export interface HoodPresentationPeriod {
  period: string
  basis: 'FY' | 'LTM'
  transaction: number
  interest: number
  other: number
  assets: number
  deposits: number
  arpu: number
  retention: number
  adjustedOpexAndSbc: number
  adjustedEbitda: number
}

export interface HoodPresentation {
  title: string
  publishedAt: string
  reviewedAt: string
  asOf: string
  sourceUrl: string
  sourcePages: { overview: number; priorities: number; customers: number; revenue: number; profitability: number; reconciliation: number }
  fundedCustomers: number
  goldSubscribers: number
  goldYearGrowth: number
  depositGrowth: number
  adjustedEbitdaMargin: number
  dilutedEps: number
  history: HoodPresentationPeriod[]
  businessLines: string[]
  priorities: Array<{ id: string; title: string; products: string[] }>
  notes: string[]
}

export const HOOD_PRESENTATION: HoodPresentation = {
  title: 'November 2026 Investor Presentation',
  publishedAt: '2026-11-11',
  reviewedAt: '2026-11-15',
  asOf: '2026-09-30',
  sourceUrl: 'https://investors.robinhood.com/static-files/72febcf6-0d7c-4a95-9c94-bc98c42b8284',
  sourcePages: { overview: 3, priorities: 6, customers: 12, revenue: 14, profitability: 17, reconciliation: 20 },
  fundedCustomers: 28.7e6,
  goldSubscribers: 5.2e6,
  goldYearGrowth: 34,
  depositGrowth: 21,
  adjustedEbitdaMargin: 56,
  dilutedEps: 2.17,
  // Monetary values are USD; ARPU is USD/customer. Percentages use 0–100.
  // The final column is LTM financial/flow data and period-end platform assets.
  history: [
    { period: '2021', basis: 'FY', transaction: 1402e6, interest: 256e6, other: 157e6, assets: 98e9, deposits: 27e9, arpu: 103, retention: 80, adjustedOpexAndSbc: 3401e6, adjustedEbitda: 33e6 },
    { period: '2022', basis: 'FY', transaction: 814e6, interest: 424e6, other: 120e6, assets: 62e9, deposits: 18e9, arpu: 60, retention: 95, adjustedOpexAndSbc: 2187e6, adjustedEbitda: -94e6 },
    { period: '2023', basis: 'FY', transaction: 785e6, interest: 929e6, other: 151e6, assets: 103e9, deposits: 17e9, arpu: 80, retention: 96, adjustedOpexAndSbc: 2297e6, adjustedEbitda: 536e6 },
    { period: '2024', basis: 'FY', transaction: 1647e6, interest: 1109e6, other: 195e6, assets: 193e9, deposits: 51e9, arpu: 122, retention: 96, adjustedOpexAndSbc: 1937e6, adjustedEbitda: 1429e6 },
    { period: '2025', basis: 'FY', transaction: 2628e6, interest: 1514e6, other: 331e6, assets: 322e9, deposits: 68e9, arpu: 171, retention: 93, adjustedOpexAndSbc: 2265e6, adjustedEbitda: 2522e6 },
    { period: "LTM Q3 '26", basis: 'LTM', transaction: 3042e6, interest: 1574e6, other: 466e6, assets: 396e9, deposits: 71e9, arpu: 183, retention: 93, adjustedOpexAndSbc: 2509e6, adjustedEbitda: 2844e6 },
  ],
  businessLines: ['Options trading', 'Margin interest', 'Equities trading', 'Crypto trading', 'Margin securities lending', 'Cash sweep', 'Fully paid securities lending', 'Gold subscriptions', 'Instant withdrawals', 'Prediction markets', 'Bitstamp', 'Credit card', 'Robinhood Legend', 'Rothera'],
  priorities: [
    { id: 'traders', title: 'Active traders', products: ['Prediction markets', 'SuperApp design', 'Cortex & social'] },
    { id: 'wallet', title: 'Next-generation wallet share', products: ['Family investing', 'Private markets'] },
    { id: 'global', title: 'Global financial ecosystem', products: ['Tokenization & Robinhood Chain', 'New markets'] },
  ],
  notes: [
    'Presentation snapshot as of September 30, 2026. Final history column is LTM, not a full-year forecast; platform assets are period-end balances.',
    'Adjusted EBITDA, its margin, and adjusted operating expenses plus SBC are non-GAAP. Reconciliations are on slides 20–21; EBITDA is not revenue minus the displayed expense measure.',
    'The 14-business threshold uses quarterly revenue multiplied by four, not realized annual revenue. Business lines overlap and must not be added together.',
    'The 93% retention measure is LTM. The deck says retention before the effect of 2025 low-balance account escheatment would have been 96%.',
    'Priorities are management plans, not completed launches or financial guidance. Figures are rounded as reported in the presentation.',
  ],
}
