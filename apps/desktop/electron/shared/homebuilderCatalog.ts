import type { HomebuilderCompany } from './homebuilders.js'

export const HOMEBUILDER_REVIEW_DATE = '2026-11-13'
export const HOMEBUILDER_COVERAGE_NOTE = 'Selected U.S. listed homebuilders, not an exhaustive industry universe. ITB and XHB are broader housing equity ETFs, excluded from builder breadth and market cap. Acquired companies are excluded.'

export const HOMEBUILDER_CATALOG: readonly HomebuilderCompany[] = [
  { symbol: 'DHI', name: 'D.R. Horton', kind: 'builder',
    focus: 'New homes across multiple price points, including entry-level housing.', sourceUrl: 'https://investor.drhorton.com/' },
  { symbol: 'LEN', name: 'Lennar', kind: 'builder',
    focus: 'Single-family homes, communities and related financial services.', sourceUrl: 'https://investors.lennar.com/' },
  { symbol: 'PHM', name: 'PulteGroup', kind: 'builder',
    focus: 'Pulte Homes, Centex and Del Webb serve multiple buyer segments.', sourceUrl: 'https://pultegroup.com/investor-relations/' },
  { symbol: 'NVR', name: 'NVR', kind: 'builder',
    focus: 'Ryan Homes, NVHomes and Heartland Luxury Homes; lot purchase agreements.', sourceUrl: 'https://nvri.gcs-web.com/' },
  { symbol: 'TOL', name: 'Toll Brothers', kind: 'builder',
    focus: 'Luxury homes and communities.', sourceUrl: 'https://investors.tollbrothers.com/' },
  { symbol: 'KBH', name: 'KB Home', kind: 'builder',
    focus: 'Personalized new homes for first-time and move-up buyers.', sourceUrl: 'https://investor.kbhome.com/' },
  { symbol: 'MTH', name: 'Meritage Homes', kind: 'builder',
    focus: 'Energy-efficient homes for first-time and first move-up buyers.', sourceUrl: 'https://investors.meritagehomes.com/' },
  { symbol: 'MHO', name: 'M/I Homes', kind: 'builder',
    focus: 'Single-family homes and related mortgage financing services.', sourceUrl: 'https://investors.mihomes.com/' },
  { symbol: 'CCS', name: 'Century Communities', kind: 'builder',
    focus: 'Century Communities and Century Complete new-home brands.', sourceUrl: 'https://investors.centurycommunities.com/overview/default.aspx' },
  { symbol: 'LGIH', name: 'LGI Homes', kind: 'builder',
    focus: 'Entry-level homes and the Terrata Homes brand.', sourceUrl: 'https://investor.lgihomes.com/' },
  { symbol: 'ITB', name: 'iShares U.S. Home Construction ETF', kind: 'benchmark',
    focus: 'Home construction equities; includes builders and related businesses.', sourceUrl: 'https://www.ishares.com/us/products/239512/ishares-us-home-construction-etf' },
  { symbol: 'XHB', name: 'SPDR S&P Homebuilders ETF', kind: 'benchmark',
    focus: 'Homebuilders and housing-related products, suppliers and retailers.', sourceUrl: 'https://www.ssga.com/us/en/individual/etfs/spdr-sp-homebuilders-etf-xhb' },
]
