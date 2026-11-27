import { createMobileApi } from './client'
import { installDoubleTap } from './touch'
import './mobile.css'
import './portrait.css'

// A rebuild on the computer deletes the old hashed chunks. Reload once to pick up the new
// build instead of failing on a page or chart opened later.
const reloadKey = 'budget-terminal-mobile-reload'
function reloadOnce() {
  try {
    if (Date.now() - Number(sessionStorage.getItem(reloadKey) ?? 0) < 60_000) return false
    sessionStorage.setItem(reloadKey, String(Date.now()))
  } catch { return false }
  location.reload()
  return true
}
window.addEventListener('vite:preloadError', event => { if (reloadOnce()) event.preventDefault() })

window.api = createMobileApi()
installDoubleTap()
void import('../main').then(() => import('./layout')).then(layout => layout.installMobileLayout()).catch(() => {
  if (reloadOnce()) return
  const root = document.getElementById('root')
  if (root && !root.querySelector('.terminal-shell')) root.textContent = 'Budget Terminal could not open. Keep the desktop app open and reload this page.'
})
