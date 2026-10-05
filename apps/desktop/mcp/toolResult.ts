import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Envelope } from '../electron/shared/contract.js'
import type { ScreenshotPayload } from '../electron/shared/screenshot.js'
import { failed } from './catalog.js'

export function toolResult(name: string, result: unknown): CallToolResult {
  if (name === 'budget_terminal_screenshot' && result && typeof result === 'object' &&
    Array.isArray((result as Envelope<ScreenshotPayload>).data?.screenshots)) {
    const capture = result as Envelope<ScreenshotPayload>
    // Keep pixels in native MCP image blocks, not duplicated in text/structured JSON.
    const metadata = { ...capture, data: { screenshots: capture.data.screenshots.map(({ base64: _pixels, ...page }) => page) } }
    return {
      content: [
        { type: 'text', text: JSON.stringify(metadata) },
        ...capture.data.screenshots.flatMap((page): CallToolResult['content'] => [
          { type: 'text', text: `${page.label} (${page.pageId})` },
          { type: 'image', data: page.base64, mimeType: page.mimeType },
        ]),
      ],
      structuredContent: metadata, isError: failed(capture),
    }
  }
  const structuredContent = result && typeof result === 'object' && !Array.isArray(result)
    ? result as Record<string, unknown> : { data: result }
  return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent, isError: failed(result) }
}
