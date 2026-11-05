// Keep provider text from injecting terminal control sequences or changing titles.
export function safeText(value: unknown): string {
  return String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
}

export function privateField(key: string): boolean {
  return /token|password|secret|api.?key|authorization|cookie|source.?path/i.test(key)
}

export function describe(value: unknown, indent = ''): string[] {
  if (value === null || value === undefined) return [`${indent}--`]
  if (typeof value !== 'object') return [`${indent}${safeText(value)}`]
  if (Array.isArray(value)) {
    if (!value.length) return [`${indent}(empty)`]
    return value.flatMap((item, index) => [
      `${indent}[${index + 1}]`, ...describe(item, indent + '  '),
    ])
  }
  return Object.entries(value).flatMap(([key, entry]) => {
    // Credentials are never useful in a terminal research view.
    if (privateField(key)) return []
    return entry !== null && typeof entry === 'object'
      ? [`${indent}${safeText(key)}`, ...describe(entry, indent + '  ')]
      : [`${indent}${safeText(key).padEnd(20)} ${safeText(entry)}`]
  })
}

export function wrapLines(lines: string[], width: number): string[] {
  const size = Math.max(1, width)
  return lines.flatMap(line => {
    const chars = Array.from(safeText(line))
    if (!chars.length) return ['']
    const result: string[] = []
    for (let offset = 0; offset < chars.length; offset += size) result.push(chars.slice(offset, offset + size).join(''))
    return result
  })
}
