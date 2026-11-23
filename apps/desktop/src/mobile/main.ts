import { createMobileApi } from './client'
import './mobile.css'
import './portrait.css'

window.api = createMobileApi()
void import('../main').catch(() => {
  const root = document.getElementById('root')
  if (root) root.textContent = 'Budget Terminal could not open. Keep the desktop app open and reload this page.'
})
