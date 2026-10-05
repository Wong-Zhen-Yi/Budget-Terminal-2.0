export interface ScreenshotRequest {
  /** An implemented tab id, "current" (default), or "all" for every implemented page. */
  page?: string
}

/** Private main-to-renderer handshake; null restores the user's selected page. */
export interface ScreenshotCommand { id: string; page: string | null }
export interface ScreenshotReady {
  id: string
  pageId: string
  label: string
  obscured: boolean
  startupLoading: boolean
  status: string
  error?: string
}

export interface PageScreenshot extends Omit<ScreenshotReady, 'id' | 'error'> {
  capturedAt: number
  width: number
  height: number
  mimeType: 'image/png'
  base64: string
}

export interface ScreenshotPayload { screenshots: PageScreenshot[] }
