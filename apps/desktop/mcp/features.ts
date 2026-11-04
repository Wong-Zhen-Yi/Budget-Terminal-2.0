/** MCP-only requests; no additional renderer or maintenance privileges. */
export interface CompanyOverviewRequest { symbol: string; sections?: Array<'quotes' | 'fundamentals' | 'news'> }
export interface PortfolioBriefingRequest { portfolioId: string; sections?: Array<'quotes' | 'news'> }
export interface OperationStatusRequest { tool: string; requestId: string }
export const featureOperations = new Set(['companyOverview', 'portfolioBriefing', 'operationStatus'])
