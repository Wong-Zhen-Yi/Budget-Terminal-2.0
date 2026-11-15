/** Reviewed company presentation. These dated disclosures are not live estimates. */
export interface HoodPresentationPeriod {
  period: string
  basis: 'quarter'
  transaction: number
  interest: number
  other: number
  assets: number
  deposits: number
  arpu: number
  dilutedEps: number
  adjustedOpexAndSbc: number
  adjustedEbitda: number
}

export interface HoodPresentation {
  title: string
  publishedAt: string
  reviewedAt: string
  asOf: string
  sourceUrl: string
  quarterlySource: {
    title: string
    publishedAt: string
    sourceUrl: string
    sourcePages: { customers: number; revenue: number; profitability: number; reconciliation: number }
  }
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
  quarterlySource: {
    title: 'Q3 2026 Earnings Presentation',
    publishedAt: '2026-10-27',
    sourceUrl: 'https://investors.robinhood.com/static-files/fd90f575-5b4c-4cde-a16d-d114c920fb6a',
    sourcePages: { customers: 3, revenue: 13, profitability: 4, reconciliation: 44 },
  },
  sourcePages: { overview: 3, priorities: 6, customers: 12, revenue: 14, profitability: 17, reconciliation: 20 },
  fundedCustomers: 28.7e6,
  goldSubscribers: 5.18e6,
  goldYearGrowth: 34,
  depositGrowth: 17,
  adjustedEbitdaMargin: 57,
  dilutedEps: 0.51,
  // Monetary values are USD; ARPU is USD/customer. Percentages use 0–100.
  // Each column is a discrete quarter. Assets are period-end; ARPU is annualized.
  history: [
    { period: "Q3 '25", basis: 'quarter', transaction: 730e6, interest: 456e6, other: 88e6, assets: 333e9, deposits: 20.4e9, arpu: 191, dilutedEps: 0.61, adjustedOpexAndSbc: 613e6, adjustedEbitda: 742e6 },
    { period: "Q4 '25", basis: 'quarter', transaction: 776e6, interest: 411e6, other: 96e6, assets: 322e9, deposits: 15.9e9, arpu: 191, dilutedEps: 0.66, adjustedOpexAndSbc: 597e6, adjustedEbitda: 761e6 },
    { period: "Q1 '26", basis: 'quarter', transaction: 623e6, interest: 359e6, other: 85e6, assets: 307e9, deposits: 17.7e9, arpu: 157, dilutedEps: 0.38, adjustedOpexAndSbc: 607e6, adjustedEbitda: 534e6 },
    { period: "Q2 '26", basis: 'quarter', transaction: 776e6, interest: 389e6, other: 143e6, assets: 369e9, deposits: 21.7e9, arpu: 187, dilutedEps: 0.62, adjustedOpexAndSbc: 641e6, adjustedEbitda: 741e6 },
    { period: "Q3 '26", basis: 'quarter', transaction: 867e6, interest: 415e6, other: 142e6, assets: 396e9, deposits: 15.7e9, arpu: 200, dilutedEps: 0.51, adjustedOpexAndSbc: 664e6, adjustedEbitda: 808e6 },
  ],
  businessLines: ['Options trading', 'Margin interest', 'Equities trading', 'Crypto trading', 'Margin securities lending', 'Cash sweep', 'Fully paid securities lending', 'Gold subscriptions', 'Instant withdrawals', 'Prediction markets', 'Bitstamp', 'Credit card', 'Robinhood Legend', 'Rothera'],
  priorities: [
    { id: 'traders', title: 'Active traders', products: ['Prediction markets', 'SuperApp design', 'Cortex & social'] },
    { id: 'wallet', title: 'Next-generation wallet share', products: ['Family investing', 'Private markets'] },
    { id: 'global', title: 'Global financial ecosystem', products: ['Tokenization & Robinhood Chain', 'New markets'] },
  ],
  notes: [
    'Each history column is one reported quarter from Q3 2025 through Q3 2026, sourced from the Q3 2026 earnings presentation published October 27, 2026. Platform assets are quarter-end balances; revenue, deposits, expenses, EBITDA and diluted EPS cover the quarter.',
    'ARPU is annualized for each three-month period, as reported by Robinhood. Net deposit growth is the quarterly flow annualized relative to prior quarter-end platform assets. Neither is a full-year forecast.',
    'Adjusted EBITDA, its margin, and adjusted operating expenses plus SBC are non-GAAP. Earnings deck slides 43–44 reconcile these measures; EBITDA is not revenue minus the displayed expense measure.',
    'The 14-business threshold uses quarterly revenue multiplied by four, not realized annual revenue. Business lines overlap and must not be added together.',
    'Quarterly diluted EPS is GAAP. Q2 2026 included $0.14 of gains primarily from RVI deconsolidation; Q3 2026 included $0.07 of unrealized losses primarily from RVI mark-to-market.',
    'Priorities are management plans, not completed launches or financial guidance. Figures are rounded as reported in the presentation.',
  ],
}
