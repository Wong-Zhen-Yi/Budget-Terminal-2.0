import type { Operation } from './operations.js'
import { mutationDomains } from './operations.js'
import type { McpPermission } from '../electron/shared/mcpAccess.js'

export const permissionLabels: Record<McpPermission, string> = {
  marketResearch: 'Market research', portfolioRead: 'Saved portfolios and Cards', personalFinanceRead: 'Personal finance',
  savedContentRead: 'Saved articles and settings', screenshots: 'App screenshots', browserContent: 'Browser content and actions', recordEdits: 'Saved-record edits',
}
export function requiredPermissions(operation: Operation): McpPermission[] {
  if (operation in mutationDomains) return ['recordEdits']
  // A capture can show any selected page or shared website. Prevent visual bypass
  // of denied data categories, even when the user navigates during a capture.
  if (operation === 'screenshot') return ['screenshots', 'browserContent', 'portfolioRead', 'personalFinanceRead', 'savedContentRead']
  if (operation === 'browserResearch') return ['browserContent']
  if (operation === 'portfolio' || operation === 'cards') return ['portfolioRead']
  if (operation === 'personalFinance') return ['personalFinanceRead']
  if (operation === 'articles' || operation === 'settings') return ['savedContentRead']
  if (operation === 'portfolioBriefing') return ['portfolioRead', 'marketResearch']
  if (['browserStatus', 'apiUsage', 'operationStatus'].includes(operation)) return []
  return ['marketResearch']
}
