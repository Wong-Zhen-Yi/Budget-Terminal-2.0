import { useCallback, useEffect, useState } from 'react'
import { TABS } from '@shared/contract'
import type { ScreenshotCommand } from '@shared/screenshot'

/** Capture overrides presentation only: navigation preferences and startup loads stay intact. */
export function useMcpScreenshot() {
  const [command, setCommand] = useState<ScreenshotCommand | null>(null)
  useEffect(() => window.api.onScreenshotRequested(setCommand), [])
  const complete = useCallback((id: string) => {
    setCommand((current) => current?.id === id ? null : current)
  }, [])
  return { command, complete }
}

export function useScreenshotReady(command: ScreenshotCommand | null, pageId: string, obscured: boolean, startupLoading: boolean, complete: (id: string) => void) {
  useEffect(() => {
    if (!command) return
    let cancelled = false
    let firstFrame = 0
    let secondFrame = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    // Commit the page, let ResizeObservers size its charts, and give canvases a paint.
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        timer = setTimeout(() => {
          if (cancelled) return
          const page = [...document.querySelectorAll<HTMLElement>('[data-page-id]')]
            .find((element) => element.dataset.pageId === pageId && element.getBoundingClientRect().height > 0)
          void window.api.screenshotReady({
            id: command.id, pageId, label: TABS.find((tab) => tab.id === pageId)?.label ?? pageId,
            obscured, startupLoading, status: document.querySelector('footer')?.textContent ?? '',
            error: !page ? 'The requested page did not render.' : undefined,
          }).catch(() => { /* Capture may have timed out or the host may be shutting down. */ })
            .finally(() => { if (command.page === null) complete(command.id) })
        }, 250)
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(secondFrame)
      clearTimeout(timer)
    }
  }, [command, pageId, obscured, startupLoading, complete])
}
