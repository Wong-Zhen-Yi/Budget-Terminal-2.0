import { createMobileApi } from './client'
import './mobile.css'

window.api = createMobileApi()
void import('../main').catch(() => {
  const root = document.getElementById('root')
  if (root) root.textContent = 'Budget Terminal could not open. Reload this page while connected to Tailscale.'
})
