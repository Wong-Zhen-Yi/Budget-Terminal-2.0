import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { writeFile } from 'node:fs/promises'

import type {
  AnalyticsRequest,
  AppSettingsMutation,
  ChartRequest,
  Envelope,
  MaintenanceAction,
  MaintenanceResult,
  FundamentalsRequest,
  FxRequest,
  GlobalMarketsRequest,
  PreMarketRequest,
  TradingVolumesRequest,
  MomentumRequest,
  OptionQuotesRequest,
  PersonalFinanceMutation,
  ReturnsRequest,
  NewsRequest,
  NewsPageRequest,
  NewsTickerSearchRequest,
  NewsPreviewRequest,
  NewsThumbnailRequest,
  PortfolioMutation,
  OptionsRequest,
  QuotesRequest,
  TargetsRequest,
  WindowAction,
} from '../shared/contract.js'
import { CHANNELS } from '../shared/contract.js'
import { ok } from '../shared/envelope.js'
import { yahooProvider } from '../services/provider.js'
import { watchPortfolios } from '../services/portfolioStore.js'
import { isSafeExternalUrl } from '../services/urls.js'

export function registerIpcHandlers(): () => void {
  const provider = yahooProvider

  ipcMain.handle(CHANNELS.quotes, (_event, request: QuotesRequest) => provider.quotes(request))
  ipcMain.handle(CHANNELS.chart, (_event, request: ChartRequest) => provider.chart(request))
  ipcMain.handle(CHANNELS.options, (_event, request: OptionsRequest) => provider.options(request))
  ipcMain.handle(CHANNELS.targets, (_event, request: TargetsRequest) => provider.targets(request))
  ipcMain.handle(CHANNELS.news, (_event, request: NewsRequest) => provider.news(request))
  ipcMain.handle(CHANNELS.newsPage, (_event, request: NewsPageRequest) =>
    provider.newsPage(request),
  )
  ipcMain.handle(CHANNELS.newsTickerSearch, (_event, request: NewsTickerSearchRequest) =>
    provider.newsTickerSearch(request),
  )
  ipcMain.handle(CHANNELS.newsArticle, (_event, request: NewsPreviewRequest) =>
    provider.newsArticle(request),
  )
  ipcMain.handle(CHANNELS.newsThumbnail, (_event, request: NewsThumbnailRequest) =>
    provider.newsThumbnail(request),
  )
  ipcMain.handle(CHANNELS.fundamentals, (_event, request: FundamentalsRequest) =>
    provider.fundamentals(request),
  )
  ipcMain.handle(CHANNELS.returns, (_event, request: ReturnsRequest) => provider.returns(request))
  ipcMain.handle(CHANNELS.momentum, (_event, request: MomentumRequest) =>
    provider.momentum(request),
  )
  ipcMain.handle(CHANNELS.analytics, (_event, request: AnalyticsRequest) =>
    provider.analytics(request),
  )
  ipcMain.handle(CHANNELS.optionQuotes, (_event, request: OptionQuotesRequest) =>
    provider.optionQuotes(request),
  )
  ipcMain.handle(CHANNELS.portfolio, () => provider.portfolio())
  ipcMain.handle(CHANNELS.portfolioMutate, (_event, mutation: PortfolioMutation) =>
    provider.mutatePortfolio(mutation),
  )
  ipcMain.handle(CHANNELS.personalFinance, () => provider.personalFinance())
  ipcMain.handle(CHANNELS.personalFinanceMutate, (_event, mutation: PersonalFinanceMutation) =>
    provider.mutatePersonalFinance(mutation),
  )
  ipcMain.handle(CHANNELS.fx, (_event, request: FxRequest) => provider.fx(request))
  ipcMain.handle(CHANNELS.globalMarkets, (_event, request: GlobalMarketsRequest) =>
    provider.globalMarkets(request),
  )

  ipcMain.handle(CHANNELS.preMarket, (_event, request: PreMarketRequest) =>
    provider.preMarket(request),
  )
  ipcMain.handle(CHANNELS.tradingVolumes, (_event, request: TradingVolumesRequest) =>
    provider.tradingVolumes(request),
  )
  ipcMain.handle(CHANNELS.settings, () => provider.settings())
  ipcMain.handle(CHANNELS.settingsMutate, (_event, mutation: AppSettingsMutation) =>
    provider.mutateSettings(mutation),
  )

  /**
   * The User Data buttons. The renderer has already confirmed the destructive ones, so
   * all that is left here is resolving a path — dismissing the dialog is a normal
   * outcome and comes back as `performed: false`, not an error.
   */
  ipcMain.handle(
    CHANNELS.maintenance,
    async (event, action: MaintenanceAction): Promise<Envelope<MaintenanceResult>> => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const cancelled = (message: string) =>
        ok({ action, performed: false, message, path: '' }, 'settings store')

      if (action === 'exportUserData') {
        const options = {
          title: 'Export User Data',
          defaultPath: `budget-terminal-backup-${new Date().toISOString().slice(0, 10)}.json`,
          filters: [{ name: 'JSON files', extensions: ['json'] }],
        }
        const result = window
          ? await dialog.showSaveDialog(window, options)
          : await dialog.showSaveDialog(options)
        if (result.canceled || !result.filePath) return cancelled('Export cancelled.')
        return provider.exportUserData(result.filePath)
      }

      if (action === 'importUserData') {
        const options = {
          title: 'Import User Data',
          properties: ['openFile' as const],
          filters: [{ name: 'JSON files', extensions: ['json'] }],
        }
        const result = window
          ? await dialog.showOpenDialog(window, options)
          : await dialog.showOpenDialog(options)
        const [selected] = result.filePaths
        if (result.canceled || !selected) return cancelled('Import cancelled.')
        return provider.importUserData(selected)
      }

      if (action === 'clearUserData') return provider.clearUserData()
      return provider.resetCache()
    },
  )

  ipcMain.handle(CHANNELS.openExternal, async (_event, url: string) => {
    if (!isSafeExternalUrl(url)) return
    await shell.openExternal(url)
  })

  ipcMain.handle(
    CHANNELS.saveText,
    async (event, suggestedName: string, contents: string): Promise<string | null> => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const result = window
        ? await dialog.showSaveDialog(window, { defaultPath: suggestedName })
        : await dialog.showSaveDialog({ defaultPath: suggestedName })
      if (result.canceled || !result.filePath) return null
      await writeFile(result.filePath, contents, 'utf8')
      return result.filePath
    },
  )

  ipcMain.handle(CHANNELS.windowControl, (event, action: WindowAction) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    if (action === 'minimize') window.minimize()
    else if (action === 'close') window.close()
    else if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })

  const stopWatching = watchPortfolios(() => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(CHANNELS.portfolioChanged)
    }
  })

  return () => {
    stopWatching()
    for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel)
  }
}
