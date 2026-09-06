import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'

import type { AppSettings, AppSettingsMutation } from '../shared/contract.js'
import {
  DEFAULT_DAY_TRADING_SETTINGS as DEFAULT_SIGNALS_PAGE_SETTINGS,
  normalizeDayTradingSettings as normalizeSignalsPageSettings,
} from '../shared/dayTrading.js'
import {
  CLOCK_COUNTRIES,
  DEFAULT_CLOCK_COUNTRY,
  DEFAULT_OBSCURED_TABS,
  SETTINGS_TAB_ID,
  TABS,
} from '../shared/contract.js'
import {
  DEFAULT_BACKTEST_PAGE_SETTINGS,
  normalizeBacktestPageSettings,
} from '../shared/backtest.js'
import {
  DEFAULT_QUANT_PAGE_SETTINGS,
  normalizeQuantPageSettings,
} from '../shared/quant.js'
import {
  DEFAULT_YOUTUBE_PAGE_SETTINGS,
  normalizeYouTubePageSettings,
} from '../shared/youtube.js'

/**
 * The Settings page's own store.
 *
 * It lives beside `portfolio.json` but in a separate file, the way the reference keeps
 * `app_config.json` apart from `user_data.json`: clearing user data must not reset the
 * navigation order, and a settings write must not queue behind a burst of cell edits.
 * Writes are atomic (temp file plus rename), same as the holdings store.
 */

const settingsSchema = z.object({
  version: z.number().catch(1),
  clockCountry: z.string().catch(DEFAULT_CLOCK_COUNTRY),
  time12h: z.boolean().catch(true),
  tabOrder: z.array(z.string()).catch([]),
  hiddenTabs: z.array(z.string()).catch([]),
  obscuredTabs: z.array(z.string()).optional(),
  backtestPage: z.unknown().optional(),
  signalsPage: z.unknown().optional(),
  quantPage: z.unknown().optional(),
  youtubePage: z.unknown().optional(),
})

type StoredSettings = z.infer<typeof settingsSchema>

const STORE_VERSION = 1

const KNOWN_TABS = TABS.map((tab) => tab.id)
const CLOCK_CODES = new Set(CLOCK_COUNTRIES.map((entry) => entry.code))

export function settingsPath(): string {
  // Resolved from the environment rather than Electron's `app`, so the probe scripts
  // reach the same file without booting a browser process.
  const appData = process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming')
  return join(appData, 'BudgetTerminalElectron', 'settings.json')
}

function emptySettings(): StoredSettings {
  return {
    version: STORE_VERSION,
    clockCountry: DEFAULT_CLOCK_COUNTRY,
    time12h: true,
    tabOrder: [...KNOWN_TABS],
    hiddenTabs: [],
    // A fresh install obscures Personal Finance, like `DEFAULT_PRIVACY_SETTINGS`.
    obscuredTabs: [...DEFAULT_OBSCURED_TABS],
    backtestPage: DEFAULT_BACKTEST_PAGE_SETTINGS,
    signalsPage: DEFAULT_SIGNALS_PAGE_SETTINGS,
    quantPage: DEFAULT_QUANT_PAGE_SETTINGS,
    youtubePage: DEFAULT_YOUTUBE_PAGE_SETTINGS,
  }
}

/**
 * Repair anything the schema let through: tabs this build no longer ships, tabs it
 * gained since the file was written, and any attempt to hide or obscure Settings.
 */
function normalize(settings: StoredSettings): StoredSettings {
  settings.version = STORE_VERSION
  settings.clockCountry = CLOCK_CODES.has(settings.clockCountry.trim().toUpperCase())
    ? settings.clockCountry.trim().toUpperCase()
    : DEFAULT_CLOCK_COUNTRY

  const order = settings.tabOrder.filter(
    (id, index) => KNOWN_TABS.includes(id) && settings.tabOrder.indexOf(id) === index,
  )
  // A tab added by a newer build lands in its contract position rather than at the end,
  // so an existing install sees it where the default order puts it.
  for (const id of KNOWN_TABS) {
    if (order.includes(id)) continue
    const position = KNOWN_TABS.indexOf(id)
    const insertAt = order.findIndex((existing) => KNOWN_TABS.indexOf(existing) > position)
    if (insertAt < 0) order.push(id)
    else order.splice(insertAt, 0, id)
  }
  settings.tabOrder = order

  const keep = (ids: string[]): string[] => [
    ...new Set(ids.filter((id) => KNOWN_TABS.includes(id) && id !== SETTINGS_TAB_ID)),
  ]
  settings.hiddenTabs = keep(settings.hiddenTabs)
  settings.obscuredTabs = keep(settings.obscuredTabs ?? [...DEFAULT_OBSCURED_TABS])
  settings.backtestPage = normalizeBacktestPageSettings(settings.backtestPage)
  settings.signalsPage = normalizeSignalsPageSettings(settings.signalsPage)
  settings.quantPage = normalizeQuantPageSettings(settings.quantPage)
  settings.youtubePage = normalizeYouTubePageSettings(settings.youtubePage)
  return settings
}

/* ------------------------------------------------------------------- access */

let cached: StoredSettings | null = null
let writeChain: Promise<void> = Promise.resolve()

/**
 * Whether a read failure means the file is not there rather than momentarily unreadable.
 *
 * The same rule as the holdings store: defaulting on a transient EBUSY or EPERM would
 * hand the next write — and the next export — an empty settings document in place of the
 * user's tab order.
 */
function isAbsentOrDamaged(error: unknown): boolean {
  if (error instanceof SyntaxError) return true
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

async function loadSettings(): Promise<StoredSettings> {
  if (cached) return cached
  try {
    const raw = await readFile(settingsPath(), 'utf8')
    const parsed = settingsSchema.safeParse(JSON.parse(raw))
    cached = normalize(parsed.success ? parsed.data : emptySettings())
  } catch (error) {
    // No file yet, or a damaged one: start from the defaults rather than fail.
    if (!isAbsentOrDamaged(error)) throw error
    cached = emptySettings()
  }
  return cached
}

async function persist(settings: StoredSettings): Promise<void> {
  const target = settingsPath()
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(settings, null, 2), 'utf8')
  await rename(temporary, target)
}

/** Drop the in-memory copy so the next read goes back to disk, like `resetStoreCache`. */
export function resetSettingsCache(): void {
  cached = null
}

function toPayload(settings: StoredSettings): AppSettings {
  return {
    clockCountry: settings.clockCountry,
    time12h: settings.time12h,
    tabOrder: [...settings.tabOrder],
    hiddenTabs: [...settings.hiddenTabs],
    obscuredTabs: [...(settings.obscuredTabs ?? [])],
    backtestPage: normalizeBacktestPageSettings(settings.backtestPage),
    signalsPage: normalizeSignalsPageSettings(settings.signalsPage),
    quantPage: normalizeQuantPageSettings(settings.quantPage),
    youtubePage: normalizeYouTubePageSettings(settings.youtubePage),
    sourcePath: settingsPath(),
  }
}

export async function readSettings(): Promise<AppSettings> {
  return toPayload(await loadSettings())
}

/* ------------------------------------------------------------------ writing */

function toggle(ids: string[], id: string, on: boolean): string[] {
  const without = ids.filter((entry) => entry !== id)
  return on ? [...without, id] : without
}

function apply(settings: StoredSettings, mutation: AppSettingsMutation): void {
  switch (mutation.type) {
    case 'setClockCountry': {
      const code = mutation.code.trim().toUpperCase()
      if (!CLOCK_CODES.has(code)) throw new Error(`Unknown clock market ${mutation.code}.`)
      settings.clockCountry = code
      return
    }
    case 'setTime12h': {
      settings.time12h = mutation.value
      return
    }
    case 'setTabHidden': {
      if (mutation.id === SETTINGS_TAB_ID) throw new Error('Settings must remain visible.')
      if (!KNOWN_TABS.includes(mutation.id)) throw new Error(`Unknown page ${mutation.id}.`)
      settings.hiddenTabs = toggle(settings.hiddenTabs, mutation.id, mutation.hidden)
      return
    }
    case 'moveTab': {
      const from = settings.tabOrder.indexOf(mutation.id)
      const to = from + mutation.direction
      if (from < 0) throw new Error(`Unknown page ${mutation.id}.`)
      if (to < 0 || to >= settings.tabOrder.length) return
      const [moved] = settings.tabOrder.splice(from, 1)
      settings.tabOrder.splice(to, 0, moved)
      return
    }
    case 'resetNavigation': {
      settings.tabOrder = [...KNOWN_TABS]
      settings.hiddenTabs = []
      return
    }
    case 'setTabObscured': {
      if (mutation.id === SETTINGS_TAB_ID) throw new Error('Settings cannot be obscured.')
      if (!KNOWN_TABS.includes(mutation.id)) throw new Error(`Unknown page ${mutation.id}.`)
      settings.obscuredTabs = toggle(
        settings.obscuredTabs ?? [],
        mutation.id,
        mutation.obscured,
      )
      return
    }
    case 'setBacktestPage': {
      settings.backtestPage = normalizeBacktestPageSettings(mutation.value)
      return
    }
    case 'setSignalsPage': {
      settings.signalsPage = normalizeSignalsPageSettings(mutation.value)
      return
    }
    case 'setQuantPage': {
      settings.quantPage = normalizeQuantPageSettings(mutation.value)
      return
    }
    case 'setYouTubePage': {
      settings.youtubePage = normalizeYouTubePageSettings(mutation.value)
      return
    }
  }
}

/**
 * Apply one edit and answer with the re-read document, the same contract the portfolio
 * and finance writes use: a refused edit renders unchanged rather than throwing.
 */
export async function mutateSettings(mutation: AppSettingsMutation): Promise<AppSettings> {
  let failure: unknown = null
  const run = writeChain.then(async () => {
    try {
      const settings = await loadSettings()
      apply(settings, mutation)
      cached = normalize(settings)
      await persist(cached)
    } catch (error) {
      failure = error
    }
  })
  writeChain = run
  await run
  if (failure) throw failure
  return readSettings()
}

/** Replace the whole document, used by the user-data import. */
export async function replaceSettings(source: unknown): Promise<AppSettings> {
  const parsed = settingsSchema.safeParse(source)
  if (!parsed.success) throw new Error('The backup does not contain valid settings.')
  let failure: unknown = null
  const run = writeChain.then(async () => {
    try {
      cached = normalize(parsed.data)
      await persist(cached)
    } catch (error) {
      failure = error
    }
  })
  writeChain = run
  await run
  if (failure) throw failure
  return readSettings()
}

/**
 * The raw document, as the user-data export writes it.
 *
 * Taken at the back of the write queue so a mutation still in flight when Export was
 * clicked is part of the backup rather than the edit the backup is missing.
 */
export async function exportSettings(): Promise<StoredSettings> {
  let snapshot: StoredSettings | undefined
  let failure: unknown = null
  const run = writeChain.then(async () => {
    try {
      snapshot = { ...(await loadSettings()) }
    } catch (error) {
      failure = error
    }
  })
  writeChain = run
  await run
  if (failure) throw failure
  return snapshot as StoredSettings
}
