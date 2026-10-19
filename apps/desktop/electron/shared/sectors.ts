import { SECTOR_UNIVERSE } from './sectorUniverse.js'

/** Portfolio buckets, including intentional thematic Crypto and Metals groupings. */
export const SECTOR_DATA: Record<string, string[]> = {
  ...SECTOR_UNIVERSE,
  Technology: [...SECTOR_UNIVERSE.Technology, ...'ASML TSM ARM ASX UMC GFS STM QRVO OLED ACLS ALAB AMKR SNOW NET ZS OKTA MDB TEAM HUBS DOCU PATH IOT CFLT DUOL SOUN AI BBAI IONQ RGTI QBTS QUBT U SHOP HSAI ZETA'.split(' ')],
  Financials: [...SECTOR_UNIVERSE.Financials, ...'HSBC RY TD UBS SOFI NU AFRM UPST ALLY LC LMND ROOT FUTU TIGR MKTX BRK.A BK MMC FI SQ'.split(' ')],
  Healthcare: [...SECTOR_UNIVERSE.Healthcare, ...'NVO AZN HIMS TEM RXRX CRSP NTLA BEAM EDIT VKTX'.split(' ')],
  'Consumer Cyclical': [...SECTOR_UNIVERSE['Consumer Cyclical'], ...'TM RIVN LCID NIO XPEV LI BABA JD PDD MELI CAVA DKNG ONON BIRK'.split(' ')],
  Energy: [...SECTOR_UNIVERSE.Energy, ...'SHEL TTE BP PBR ET EPD LNG FTI CTRA CHK'.split(' ')],
  'Communication Services': [...SECTOR_UNIVERSE['Communication Services'], ...'AMX SPOT RBLX SNAP PINS BIDU TME WBD PARA EA'.split(' ')],
  Industrials: [...SECTOR_UNIVERSE.Industrials, ...'RKLB ASTS LUNR ACHR JOBY LILM KTOS AVAV RCAT RDW SATL'.split(' ')],
  'Consumer Defensive': [...SECTOR_UNIVERSE['Consumer Defensive'], ...'UL DEO BTI CELH K WBA CCEP'.split(' ')],
  Utilities: [...SECTOR_UNIVERSE.Utilities, 'CWEN', 'BEP', 'BEPC'],
  'Basic Materials': [...SECTOR_UNIVERSE['Basic Materials'], ...'BHP RIO VALE CTVA SCCO CCJ UEC UUUU DNN NXE MP LAC ALTM'.split(' ')],
  Crypto: 'IBIT FBTC ARKB BITB HODL BTCO BRRR BTCW GBTC BTC ETHA FETH ETHW ETHE ETH BSOL BITW BMNR MSTR STRK STRF STRD STRC CRCL COIN BITQ MARA RIOT CLSK IREN HUT WULF BTDR CIFR CORZ CAN BTBT HIVE BITF PURR'.split(' '),
  Metals: 'GLD SLV GDX GDXJ GLDM IAU IAUM SGOL AAAU SIVR PSLV PHYS CEF PPLT PALL PAAS WPM FNV SBSW AG HL AGI AEM GOLD RGLD KGC NEM'.split(' '),
  Funds: 'SPY VOO IVV VTI VT ITOT SPLG SPYM RSP QQQ QQQM QQQJ IWM IWR IWB DIA MDY VB VO VUG VTV VIG VYM SCHD SCHB SCHX SCHG SCHV DGRO DGRW JEPI JEPQ DIVO VEA VWO VXUS IXUS EFA EEM IEMG ACWI AVUV AVDE VXF ARKK ARKQ ARKW ARKG ARKF ARKX PRNT IZRL TQQQ SQQQ UPRO SPXU SPXL SPXS SOXL SOXS TNA TZA QLD QID SSO SDS NVDL NVDU NVDX TSLL TSLS MSTU MSTX CONL DXYZ TACK'.split(' '),
  Bonds: 'BND BNDX AGG SCHZ TLT TLH IEF IEI SHY SHV SGOV BIL USFR TFLO GOVT VGIT VGSH EDV ZROZ TIP SCHP VTIP LQD VCIT VCSH HYG JNK BKLN EMB MUB VTEB IUSB BSV BIV BLV JPST ICSH FLOT TMF TBT'.split(' '),
  Commodities: 'USO BNO UNG DBC PDBC DBA CORN WEAT SOYB'.split(' '),
  Currencies: ['UUP', 'UDN'],
}

export const UNCLASSIFIED_SECTOR = 'Unclassified'

/** Provider taxonomies collapse to the portfolio's existing sector labels. */
const aliases: Record<string, string> = {
  technology: 'Technology', informationtechnology: 'Technology',
  financials: 'Financials', financialservices: 'Financials', finance: 'Financials',
  healthcare: 'Healthcare', health: 'Healthcare',
  consumercyclical: 'Consumer Cyclical', consumerdiscretionary: 'Consumer Cyclical',
  consumerdefensive: 'Consumer Defensive', consumerstaples: 'Consumer Defensive',
  communicationservices: 'Communication Services', telecommunications: 'Communication Services',
  industrials: 'Industrials', energy: 'Energy', utilities: 'Utilities',
  realestate: 'Real Estate', materials: 'Basic Materials', basicmaterials: 'Basic Materials',
  crypto: 'Crypto', metals: 'Metals', funds: 'Funds', bonds: 'Bonds', commodities: 'Commodities', currencies: 'Currencies', indices: 'Indices',
}

export function normalizeSectorName(value: unknown): string {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ')
  const key = text.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (['', 'na', 'none', 'null', 'unknown', 'unclassified', 'notavailable', 'other', 'others'].includes(key)) return ''
  return aliases[key] ?? text
}

export function normalizeSectorSymbol(symbol: string): string {
  // Share-class separators are interchangeable; exchange suffixes (.L, .HK, .TO)
  // are not. Preserve foreign listing symbols when requesting provider metadata.
  return symbol.trim().toUpperCase().replace(/^([A-Z]+)\.([ABC])$/, '$1-$2')
}

const byGicsSymbol = new Map<string, string>()
for (const [sector, tickers] of Object.entries(SECTOR_UNIVERSE)) {
  for (const ticker of tickers) byGicsSymbol.set(normalizeSectorSymbol(ticker), toGicsSector(sector))
}

const bySymbol = new Map<string, string>()
for (const [sector, tickers] of Object.entries(SECTOR_DATA)) {
  for (const ticker of tickers) bySymbol.set(normalizeSectorSymbol(ticker), sector)
}

/** Sector ETFs have known sector exposure; broad funds must not pretend to be a sector. */
for (const [sector, symbols] of Object.entries({
  Technology: 'XLK VGT FTEC IYW IGV SMH SOXX XSD SOXQ DRAM',
  Financials: 'XLF VFH KRE KBE IYF', Healthcare: 'XLV VHT IYH IBB XBI',
  'Consumer Cyclical': 'XLY VCR', 'Consumer Defensive': 'XLP VDC',
  Energy: 'XLE VDE XOP OIH', Industrials: 'XLI VIS ITA PPA XAR',
  Utilities: 'XLU VPU', 'Real Estate': 'XLRE VNQ IYR SCHH',
  'Basic Materials': 'XLB VAW', 'Communication Services': 'XLC VOX',
})) for (const symbol of symbols.split(' ')) bySymbol.set(symbol, sector)

/** Keep thematic overrides, otherwise prefer fresh provider data to the offline fallback. */
export function sectorFor(symbol: string, providerSector?: unknown): string {
  const fallback = bySymbol.get(normalizeSectorSymbol(symbol))
  if (fallback === 'Crypto' || fallback === 'Metals') return fallback
  return normalizeSectorName(providerSector) || fallback || UNCLASSIFIED_SECTOR
}

/** Index maps retain GICS labels and never apply portfolio thematic overrides. */
export function gicsSectorFor(symbol: string): string {
  const key = normalizeSectorSymbol(symbol)
  const reference = byGicsSymbol.get(key)
  if (reference) return reference
  if (key === 'MSTR') return 'Information Technology'
  const sector = sectorFor(symbol)
  return ['Crypto', 'Metals', 'Funds', 'Bonds', 'Commodities', 'Currencies', 'Indices', UNCLASSIFIED_SECTOR].includes(sector) ? '' : toGicsSector(sector)
}

export function toGicsSector(value: unknown): string {
  const sector = normalizeSectorName(value)
  return ({ Technology: 'Information Technology', Healthcare: 'Health Care',
    'Consumer Cyclical': 'Consumer Discretionary', 'Consumer Defensive': 'Consumer Staples',
    'Basic Materials': 'Materials' } as Record<string, string>)[sector] ?? sector
}
