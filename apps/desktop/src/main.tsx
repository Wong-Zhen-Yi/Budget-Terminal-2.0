import { createRoot } from 'react-dom/client'
import TerminalRoot from './TerminalRoot'
import { useDataHealth } from './stores/dataHealth'

window.addEventListener('error', event => window.api.reportDiagnostics({ kind: 'error', line: event.lineno, column: event.colno }))
window.addEventListener('unhandledrejection', () => window.api.reportDiagnostics({ kind: 'unhandled-rejection' }))
let previousPages = ''
// Coalesce startup changes so logging cannot add work to each individual render.
let pagesTimer: ReturnType<typeof setTimeout> | undefined
const stopPageDiagnostics = useDataHealth.subscribe((state, previous) => {
  if (state.startup === previous.startup || pagesTimer) return
  pagesTimer = setTimeout(() => {
    pagesTimer = undefined
    const pages = Object.entries(useDataHealth.getState().startup?.pages ?? {}).map(([page, value]) => ({ page, state: value.state }))
    const key = JSON.stringify(pages)
    if (key === previousPages) return
    previousPages = key
    window.api.reportDiagnostics({ kind: 'pages', pages })
  }, 1000)
})
if (import.meta.hot) import.meta.hot.dispose(() => { stopPageDiagnostics(); clearTimeout(pagesTimer) })

createRoot(document.getElementById('root')!).render(<TerminalRoot />)
