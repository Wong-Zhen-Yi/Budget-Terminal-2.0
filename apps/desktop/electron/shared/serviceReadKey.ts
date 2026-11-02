/** Scheduling flags do not change a read's result. Force remains part of its identity. */
export function serviceReadKey(channel: string, request: unknown): string {
  const input = request && typeof request === 'object' && !Array.isArray(request)
    ? Object.fromEntries(Object.entries(request).filter(([key, value]) => key !== 'background' && key !== 'backgroundOrder' && !(key === 'force' && value === false))
      .sort(([a], [b]) => a.localeCompare(b))) : request ?? {}
  return `${channel}:${JSON.stringify(input)}`
}
