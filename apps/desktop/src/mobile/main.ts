import { createMobileApi } from './client'
import { installDoubleTap } from './touch'
import './mobile.css'
import './portrait.css'

window.api = createMobileApi()
installDoubleTap()
void import('../main').then(() => import('./layout')).then(layout => layout.installMobileLayout()).catch(() => {
  const root = document.getElementById('root')
  if (root && !root.querySelector('.terminal-shell')) root.textContent = 'Budget Terminal could not open. Keep the desktop app open and reload this page.'
})
