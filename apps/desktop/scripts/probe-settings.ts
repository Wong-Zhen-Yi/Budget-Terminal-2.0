/**
 * Exercise everything the Settings page writes: the settings store's mutations, then
 * the four User Data maintenance actions.
 *
 *   npm run probe:settings
 *
 * APPDATA is redirected to a scratch directory first, so this never touches your real
 * settings.json, portfolio.json or strategies.json. The reference to compare against is the PySide6
 * Settings page: the same refusals (Settings cannot be hidden or obscured), the same
 * reset behaviour, and a Clear that leaves navigation and privacy alone.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const scratch = mkdtempSync(join(tmpdir(), 'bt-settings-'))
process.env.APPDATA = scratch
process.env.LOCALAPPDATA = scratch

const { mutateSettings, readSettings, settingsPath, replaceSettings } = await import(
  '../electron/services/settingsStore.js'
)
const { TABS } = await import('../electron/shared/contract.js')
const { mutatePortfolios, readPortfolios } = await import('../electron/services/portfolioStore.js')
const { mutateCards, readCards } = await import('../electron/services/cardsStore.js')
const { yahooProvider } = await import('../electron/services/provider.js')

type Settings = Awaited<ReturnType<typeof readSettings>>

function show(label: string, settings: Settings): void {
  console.log(`\n-- ${label}`)
  console.log(`   clock=${settings.clockCountry} 12h=${settings.time12h}`)
  console.log(`   first six tabs : ${settings.tabOrder.slice(0, 6).join(', ')}`)
  console.log(`   hidden         : ${settings.hiddenTabs.join(', ') || '(none)'}`)
  console.log(`   obscured       : ${settings.obscuredTabs.join(', ') || '(none)'}`)
}

async function expectRejected(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run()
    console.log(`   FAIL  ${label} was allowed but should have been rejected`)
    process.exitCode = 1
  } catch (error) {
    console.log(`   ok    ${label} rejected: ${error instanceof Error ? error.message : error}`)
  }
}

function check(label: string, condition: boolean): void {
  console.log(`   ${condition ? 'ok   ' : 'FAIL '} ${label}`)
  if (!condition) process.exitCode = 1
}

async function main(): Promise<void> {
  console.log(`settings path : ${settingsPath()}`)

  const defaults = await readSettings()
  const { WORKSPACES } = await import('../electron/shared/navigation.js')
  const grouped = WORKSPACES.flatMap((workspace) => workspace.pages)
  check('each page belongs to exactly one workspace', new Set(grouped).size === grouped.length)
  check('all non-settings pages have a workspace', TABS.filter((tab) => tab.id !== 'settings').every((tab) => grouped.includes(tab.id)))
  const { favoriteTabs: omittedFavorites, ...legacy } = defaults
  void omittedFavorites
  check('legacy settings receive default favorites', (await replaceSettings(legacy)).favoriteTabs.join(',') === 'dashboard,portfolio,charts')
  await replaceSettings({ ...defaults, favoriteTabs: ['heatmap', 'heatmap', 'missing', 'settings'] })
  check('import repairs invalid and duplicate favorites', (await readSettings()).favoriteTabs.join(',') === 'heatmap')
  await mutateSettings({ type: 'setTabFavorite', id: 'stocks', favorite: true })
  const { resetSettingsCache } = await import('../electron/services/settingsStore.js')
  resetSettingsCache()
  check('favorites survive a disk reload', (await readSettings()).favoriteTabs.join(',') === 'heatmap,stocks')
  await mutateSettings({ type: 'setSidebarCollapsed', value: true })
  resetSettingsCache()
  check('collapsed sidebar survives a disk reload', (await readSettings()).sidebarCollapsed)
  await mutateSettings({ type: 'setSidebarCollapsed', value: false })
  check('sidebar can be expanded again', !(await readSettings()).sidebarCollapsed)
  await mutateSettings({ type: 'setTabHidden', id: 'stocks', hidden: true })
  check('hidden pages retain favorites', (await readSettings()).favoriteTabs.includes('stocks'))
  await mutateSettings({ type: 'setTabFavorite', id: 'stocks', favorite: false })
  check('favorites can be removed', !(await readSettings()).favoriteTabs.includes('stocks'))
  await expectRejected('favoriting an unknown page', () => mutateSettings({ type: 'setTabFavorite', id: 'missing', favorite: true }))
  await expectRejected('favoriting Settings', () => mutateSettings({ type: 'setTabFavorite', id: 'settings', favorite: true }))
  check('empty favorites remain empty', (await replaceSettings({ ...defaults, favoriteTabs: [] })).favoriteTabs.length === 0)
  await replaceSettings(defaults)
  show('defaults', defaults)
  check('Market Cap follows Price by default', defaults.tabOrder.indexOf('market-cap') === defaults.tabOrder.indexOf('price') + 1)
  const oldOrder = defaults.tabOrder.filter((id) => id !== 'market-cap').reverse()
  const upgraded = await replaceSettings({ ...defaults, tabOrder: oldOrder })
  check('existing settings gain Market Cap once', upgraded.tabOrder.filter((id) => id === 'market-cap').length === 1)
  check('existing tab order is preserved', upgraded.tabOrder.filter((id) => id !== 'market-cap').join(',') === oldOrder.join(','))
  await mutateSettings({ type: 'resetNavigation' })

  const beforeForex = defaults.tabOrder.filter((id) => id !== 'forex').reverse()
  const withForex = await replaceSettings({ ...defaults, tabOrder: beforeForex })
  check('existing settings gain Forex once', withForex.tabOrder.filter((id) => id === 'forex').length === 1)
  check('Forex upgrade preserves existing order', withForex.tabOrder.filter((id) => id !== 'forex').join(',') === beforeForex.join(','))
  check('Forex can be hidden', (await mutateSettings({ type: 'setTabHidden', id: 'forex', hidden: true })).hiddenTabs.includes('forex'))
  await mutateSettings({ type: 'resetNavigation' })

  show('clock market SG', await mutateSettings({ type: 'setClockCountry', code: 'sg' }))
  show('24-hour clock', await mutateSettings({ type: 'setTime12h', value: false }))
  show('hide Global', await mutateSettings({ type: 'setTabHidden', id: 'global', hidden: true }))
  show('move Portfolio up', await mutateSettings({ type: 'moveTab', id: 'portfolio', direction: -1 }))
  show(
    'obscure Portfolio too',
    await mutateSettings({ type: 'setTabObscured', id: 'portfolio', obscured: true }),
  )

  console.log('\n-- refused edits')
  await expectRejected('hiding Settings', () =>
    mutateSettings({ type: 'setTabHidden', id: 'settings', hidden: true }),
  )
  await expectRejected('obscuring Settings', () =>
    mutateSettings({ type: 'setTabObscured', id: 'settings', obscured: true }),
  )
  await expectRejected('an unknown page', () =>
    mutateSettings({ type: 'setTabHidden', id: 'nope', hidden: true }),
  )
  await expectRejected('an unknown clock market', () =>
    mutateSettings({ type: 'setClockCountry', code: 'ZZ' }),
  )

  console.log('\n-- moving past the ends is a no-op, not an error')
  const top = (await readSettings()).tabOrder[0]
  const beforeTop = (await readSettings()).tabOrder.join(',')
  await mutateSettings({ type: 'moveTab', id: top, direction: -1 })
  check('order unchanged after moving the top tab up', (await readSettings()).tabOrder.join(',') === beforeTop)

  show('reset navigation', await mutateSettings({ type: 'resetNavigation' }))
  const afterReset = await readSettings()
  check(
    'reset restores the contract order',
    afterReset.tabOrder.join(',') === TABS.map((tab) => tab.id).join(','),
  )
  check('reset clears hidden pages', afterReset.hiddenTabs.length === 0)
  check('reset keeps privacy selections', afterReset.obscuredTabs.includes('portfolio'))
  check('reset keeps the clock market', afterReset.clockCountry === 'SG')

  console.log('\n-- Signals page controls')
  const signalsSettings = await mutateSettings({
    type: 'setSignalsPage',
    value: { filter: 'ready', setup: 'vwap_pullback', search: 'NVDA' },
  })
  check('Signals filter persists', signalsSettings.signalsPage.filter === 'ready')
  check('Day Trading setup persists', signalsSettings.signalsPage.setup === 'vwap_pullback')
  check('Signals search persists', signalsSettings.signalsPage.search === 'NVDA')

  console.log('\n-- Quant page controls')
  const quantSettings = await mutateSettings({
    type: 'setQuantPage',
    value: {
      activeTab: 'pairs',
      screenFilter: 'top_quartile',
      pairFilter: 'stretched',
      search: 'aapl',
      pairLeft: 'msft',
      pairRight: 'googl',
    },
  })
  check('Quant tab persists', quantSettings.quantPage.activeTab === 'pairs')
  check('Quant filters persist', quantSettings.quantPage.screenFilter === 'top_quartile' && quantSettings.quantPage.pairFilter === 'stretched')
  check('Quant symbols normalize', quantSettings.quantPage.search === 'AAPL' && quantSettings.quantPage.pairLeft === 'MSFT' && quantSettings.quantPage.pairRight === 'GOOGL')

  console.log('\n-- YouTube page controls')
  const youtubeSettings = await mutateSettings({
    type: 'setYouTubePage',
    value: { sortColumn: 3, sortDescending: true },
  })
  check('YouTube sort column persists', youtubeSettings.youtubePage.sortColumn === 3)
  check('YouTube sort direction persists', youtubeSettings.youtubePage.sortDescending)

  /* --------------------------------------------------------------- maintenance */

  const portfolio = (await readPortfolios()).portfolios[0]
  await mutatePortfolios({ type: 'addPosition', portfolioId: portfolio.id, ticker: 'NVDA' })
  await mutatePortfolios({
    type: 'setPosition',
    portfolioId: portfolio.id,
    ticker: 'NVDA',
    shares: 7,
    avgPrice: 123.45,
  })
  await mutateCards({
    type: 'add',
    name: 'Settings Probe Card',
    symbols: ['NVDA', 'AVGO'],
    weighting: 'equal',
    weights: {},
  })

  const backup = join(scratch, 'backup.json')
  console.log('\n-- export')
  // An edit that has not finished writing when Export is clicked. The export joins the
  // same write queue, so it has to come back with the new share count rather than the
  // one the store held when the button was pressed.
  const inFlight = mutatePortfolios({
    type: 'setPosition',
    portfolioId: portfolio.id,
    ticker: 'NVDA',
    shares: 9,
    avgPrice: 123.45,
  })
  const pendingCard = mutateCards({
    type: 'add',
    name: 'In Flight Card',
    symbols: ['MSFT'],
    weighting: 'equal',
    weights: {},
  })
  const exported = await yahooProvider.exportUserData(backup)
  await Promise.all([inFlight, pendingCard])
  console.log(`   ${exported.data.message}`)
  check('export reports success', exported.data.performed)

  const bundle = JSON.parse(await readFile(backup, 'utf8')) as {
    userData: { portfolios: Record<string, { holdings: Record<string, { shares: number }> }> }
    cards: { customCards: { name: string }[] }
  }
  check(
    'export carries an edit that was still in flight',
    bundle.userData.portfolios[portfolio.id]?.holdings.NVDA?.shares === 9,
  )
  check(
    'export carries a card that was still in flight',
    bundle.cards.customCards.some((card) => card.name === 'In Flight Card'),
  )

  console.log('\n-- clear')
  const cleared = await yahooProvider.clearUserData()
  console.log(`   ${cleared.data.message}`)
  check('clear empties the holdings', (await readPortfolios()).portfolios[0].tickers.length === 0)
  check('clear empties custom cards', (await readCards()).customCards.length === 0)
  check('clear leaves settings alone', (await readSettings()).clockCountry === 'SG')

  console.log('\n-- import')
  const imported = await yahooProvider.importUserData(backup)
  console.log(`   ${imported.data.message}`)
  const restored = (await readPortfolios()).portfolios[0]
  check('import restores the position', restored.tickers.includes('NVDA'))
  // 9, not 7: the backup was taken while that edit was still queued and carries it.
  check('import restores the share count', restored.holdings.NVDA?.shares === 9)
  check(
    'import restores cards',
    (await readCards()).customCards.some((card) => card.name === 'Settings Probe Card'),
  )
  check('import restores settings', (await readSettings()).clockCountry === 'SG')

  console.log('\n-- import refuses a file that is not a backup')
  const rejected = await yahooProvider.importUserData(settingsPath())
  console.log(`   ${rejected.data.message}`)
  check('a foreign file is refused', !rejected.data.performed)
  check('the refusal is a partial envelope', rejected.meta.freshness === 'partial')

  console.log('\n-- reset cache')
  const reset = await yahooProvider.resetCache()
  console.log(`   ${reset.data.message}`)
  check('reset cache reports success', reset.data.performed)

  show('final', await readSettings())
  console.log(`\nscratch cleaned: ${scratch}\n`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => rmSync(scratch, { recursive: true, force: true }))
