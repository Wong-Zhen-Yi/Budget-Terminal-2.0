import Ajv, { type ValidateFunction } from 'ajv'
import { z } from 'zod'
import schemas from '../../mcp/schemas.json'
import type { Operation } from '../../mcp/operations.js'
import { createServiceRoutes } from '../mcp/routes.js'
import { CHANNELS, type StoredDataVerification } from '../shared/contract.js'
import { ok } from '../shared/envelope.js'
import { notificationCommandSchema } from '../shared/notifications.js'
import { getHeatmapProgress } from './heatmap.js'
import { normalizeEtfKey } from '../shared/heatmap.js'
import { readPageProgress } from './pageProgress.js'
import { verifyStoredData } from './portfolioStore.js'
import { notificationsCommand, notificationsStatus } from './notificationsHost.js'
import { articlePdfRequestSchema, renderArticlePdf } from './articlePdf.js'
import { MobileDownload, MobileRequestError } from './mobileHttp.js'
import { readUserDataBackup } from './automaticBackup.js'
import { renderMobileArticleArchive } from './mobileArticleArchive.js'

const desktopOperations = new Set<Operation>(['screenshot', 'browserStatus', 'browserResearch', 'apiUsage', 'operationStatus', 'companyOverview', 'portfolioBriefing'])
const mutationChannels: Partial<Record<Operation, string>> = {
  mutatePortfolio: CHANNELS.portfolioMutate, mutateCards: CHANNELS.cardsMutate,
  mutatePersonalFinance: CHANNELS.personalFinanceMutate, mutateArticles: CHANNELS.articlesMutate,
  mutateSettings: CHANNELS.settingsMutate,
}
const withoutArguments = new Set<Operation>(['portfolio', 'cards', 'personalFinance', 'articles', 'settings', 'discoveryUniverse', 'technicalScan'])
const verifyInput = z.object({ kind: z.enum(['portfolio', 'personalFinance']), expected: z.record(z.string(), z.unknown()) }).strict()
const readKey = z.string().min(1).max(100_000)

function redactPath(result: unknown) {
  if (!result || typeof result !== 'object' || !('data' in result)) return result
  const { data } = result
  if (!data || typeof data !== 'object' || !('sourcePath' in data)) return result
  const { automaticBackup: _automaticBackup, ...portable } = data as Record<string, unknown>
  return { ...result, data: { ...portable, sourcePath: '' } }
}

export function createMobileRoutes(telegramProfile: () => Promise<string>) {
  const ajv = new Ajv({ strict: false })
  let exportingPdf = false
  const tools = new Map<string, { operation: Operation; run: (request: unknown) => unknown; validate?: ValidateFunction }>()
  for (const [operation, run] of createServiceRoutes()) {
    if (desktopOperations.has(operation)) continue
    const channel = mutationChannels[operation] ?? CHANNELS[operation as keyof typeof CHANNELS]
    if (!channel || !(operation in schemas)) throw new Error(`Missing mobile service definition: ${operation}`)
    tools.set(channel, { operation, run })
  }

  return async (channel: string, args: unknown[]) => {
    const [value] = args
    const tool = tools.get(channel)
    if (tool) {
      const { operation, run } = tool
      if (withoutArguments.has(operation)) return redactPath(await run(undefined))
      let request = value
      if (operation === 'quantScan' && request === null) request = {}
      const { background, backgroundOrder, ...fields } = request && typeof request === 'object' && !Array.isArray(request)
        ? request as Record<string, unknown> : {}
      tool.validate ??= ajv.compile(schemas[operation])
      if (!tool.validate(fields)) throw new MobileRequestError('Invalid request for this Budget Terminal feature.')
      return redactPath(await run({
        ...fields,
        ...(background === true ? { background: true } : {}),
        ...(background === true && typeof backgroundOrder === 'number' && Number.isInteger(backgroundOrder) && backgroundOrder >= 0 && backgroundOrder <= 1000 ? { backgroundOrder } : {}),
      }))
    }
    switch (channel) {
      case CHANNELS.pageProgress: {
        const key = readKey.safeParse(value)
        return key.success ? readPageProgress(key.data) : null
      }
      case CHANNELS.heatmapProgress:
        return typeof value === 'string' && value.length < 50 ? getHeatmapProgress(normalizeEtfKey(value)) : null
      case CHANNELS.verifyStoredData: {
        const input = verifyInput.safeParse(value)
        return ok(input.success && await verifyStoredData(input.data as unknown as StoredDataVerification).catch(() => false), 'portfolio store')
      }
      case CHANNELS.notificationsStatus: {
        const result = await notificationsStatus()
        return { ...result, data: { ...result.data, setupError: '', storageError: result.data.storageError ? 'Notification storage is unavailable.' : '' } }
      }
      case CHANNELS.notificationsCommand: {
        const input = notificationCommandSchema.safeParse(value)
        if (!input.success) break
        return notificationsCommand(input.data)
      }
      case CHANNELS.exportArticlesPdf: {
        const input = articlePdfRequestSchema.safeParse(value)
        if (!input.success) throw new MobileRequestError('Invalid article PDF request.')
        if (input.data.articles.length > 60) throw new MobileRequestError('The mobile archive supports up to 60 articles. Export a larger library on the computer.', 413)
        if (exportingPdf) throw new MobileRequestError('An article export is already running. Try again when it finishes.', 503)
        exportingPdf = true
        try {
          return input.data.all
            ? new MobileDownload(await renderMobileArticleArchive(input.data.articles), 'application/zip')
            : new MobileDownload(await renderArticlePdf(input.data.articles[0].html), 'application/pdf')
        } finally { exportingPdf = false }
      }
      case 'mobile:telegram':
        return telegramProfile()
      case 'mobile:backup':
        return readUserDataBackup()
    }
    throw new MobileRequestError('This action is available in the desktop application.', 404)
  }
}
