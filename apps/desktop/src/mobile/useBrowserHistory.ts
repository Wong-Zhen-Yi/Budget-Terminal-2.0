import { useEffect, useRef, useState } from 'react'

interface Entry { btPage: string; btSheet?: true; btDepth: number }

const entryOf = (value: unknown): Entry | null =>
  value && typeof value === 'object' && typeof (value as Entry).btPage === 'string'
    ? { ...(value as Entry), btDepth: Number((value as Entry).btDepth) || 0 } : null

/** The page a reload should keep showing: the one recorded in the current history entry. */
export const reloadedPage = () => entryOf(history.state)?.btPage

/** A Home Screen web app has no browser toolbar, so iOS offers no Back gesture there. */
export const standaloneWebApp = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

/**
 * Phone browsers' Back gesture and button step through the pages visited in Budget Terminal
 * and close the Workspaces sheet, instead of leaving the app. Each page is one browser history
 * entry and the open sheet is another on top of the page it was opened from. Returns whether
 * there is an earlier page to go back to.
 */
export function useBrowserHistory({ enabled, page, setPage, sheetOpen, setSheetOpen, available }: {
  enabled: boolean
  page: string
  setPage: (page: string) => void
  sheetOpen: boolean
  setSheetOpen: (open: boolean) => void
  available: (page: string) => boolean
}) {
  const [depth, setDepth] = useState(0)
  const ready = useRef(false)
  // Read by the popstate listener, which is bound once.
  const latest = useRef({ page, setPage, setSheetOpen, available })
  latest.current = { page, setPage, setSheetOpen, available }

  useEffect(() => {
    if (!enabled) return
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
    const onPopState = (event: PopStateEvent) => {
      const entry = entryOf(event.state)
      if (!entry) return
      const current = latest.current
      setDepth(entry.btDepth)
      current.setSheetOpen(Boolean(entry.btSheet))
      if (current.available(entry.btPage)) current.setPage(entry.btPage)
      // A page hidden since it was visited is skipped; stay where the viewer is.
      else history.replaceState({ ...entry, btPage: current.page }, '')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    const current = entryOf(history.state)
    const depthNow = current?.btDepth ?? 0
    const next = (btDepth: number): Entry => sheetOpen ? { btPage: page, btSheet: true, btDepth } : { btPage: page, btDepth }
    if (!ready.current) {
      ready.current = true
      history.replaceState({ btPage: page, btDepth: depthNow }, '')
      setDepth(depthNow)
      if (sheetOpen) history.pushState(next(depthNow + 1), '')
      return
    }
    if (current?.btPage === page && Boolean(current.btSheet) === sheetOpen) return
    if (current?.btSheet && !sheetOpen) {
      // Closing the sheet on the same page returns to that page's entry; choosing another
      // page turns the sheet's entry into the new page, so Back goes to the page before.
      if (current.btPage === page) {
        history.back()
        return
      }
      history.replaceState(next(depthNow), '')
      setDepth(depthNow)
      return
    }
    history.pushState(next(depthNow + 1), '')
    setDepth(depthNow + 1)
  }, [enabled, page, sheetOpen])

  return depth > 0
}
