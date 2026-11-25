import { useEffect, useRef } from 'react'
import { hashKey, useIsRestoring, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { pagePreview } from './pageProgress'
import { pageQueryKeys } from './pageQueryScope'

/**
 * The longest the opening page may hold the window back. A first launch with no saved
 * content and a slow provider still opens; its panels finish loading in place.
 */
export const FIRST_RENDER_DEADLINE_MS = 6_000
/** Consecutive settled frames before reporting, so charts can size and paint once. */
const SETTLED_FRAMES = 3

/** True while a query the page has mounted is still on its first, data-less load. */
export function pageAwaitingFirstData(queryClient: QueryClient, page: string): boolean {
  const cache = queryClient.getQueryCache()
  return pageQueryKeys(page).some((key) => {
    const query = cache.find({ queryKey: key, exact: true })
    return Boolean(query && query.state.data === undefined && query.state.fetchStatus === 'fetching' &&
      pagePreview(hashKey(key)) === undefined)
  })
}

/**
 * Tell the desktop shell when the opening page has painted its content, so the window
 * appears fully rendered instead of as an empty frame that fills in afterwards.
 */
export function useFirstPageRender(activeTab: string, settled: boolean): void {
  const queryClient = useQueryClient()
  const isRestoring = useIsRestoring()
  const reported = useRef(false)
  const page = useRef(activeTab)
  page.current = activeTab

  useEffect(() => {
    if (reported.current || isRestoring || !settled) return
    let frame = 0
    let settledFrames = 0
    const report = () => {
      if (reported.current) return
      reported.current = true
      cancelAnimationFrame(frame)
      clearTimeout(deadline)
      window.api.reportFirstRender()
    }
    const deadline = setTimeout(report, FIRST_RENDER_DEADLINE_MS)
    const check = () => {
      const tab = page.current
      const frameElement = [...document.querySelectorAll<HTMLElement>('[data-page-id]')]
        .find((element) => element.dataset.pageId === tab)
      const painted = Boolean(frameElement && frameElement.getBoundingClientRect().height > 0 && frameElement.childElementCount > 0)
      settledFrames = painted && !pageAwaitingFirstData(queryClient, tab) ? settledFrames + 1 : 0
      if (settledFrames >= SETTLED_FRAMES) report()
      else frame = requestAnimationFrame(check)
    }
    frame = requestAnimationFrame(check)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(deadline)
    }
  }, [isRestoring, settled, queryClient])
}
