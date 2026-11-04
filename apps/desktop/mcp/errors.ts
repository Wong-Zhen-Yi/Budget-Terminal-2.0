export type ErrorCode = 'APP_CLOSED' | 'INVALID_ARGUMENTS' | 'UNKNOWN_TOOL' | 'STALE_REVISION' | 'APPROVAL_DENIED' | 'ACCESS_DENIED' | 'RATE_LIMITED' | 'CANCELLED' | 'CONNECTION_INTERRUPTED' | 'JOURNAL_UNAVAILABLE' | 'SERVICE_FAILED'
export class McpError extends Error {
  constructor(message: string, public code: ErrorCode, public retryable = false, public nextStep = 'Review the request before trying again.') { super(message) }
}
export function errorDetails(error: unknown) {
  if (error instanceof McpError) return { code: error.code, message: error.message, retryable: error.retryable, nextStep: error.nextStep }
  return { code: 'SERVICE_FAILED' as const, message: 'Budget Terminal service failed.', retryable: false, nextStep: 'Inspect saved records before repeating a write. Check provider diagnostics in Settings.' }
}
export function errorResult(error: unknown) {
  const details = errorDetails(error)
  return { content: [{ type: 'text' as const, text: JSON.stringify(details) }], structuredContent: { error: details }, isError: true }
}
