import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const directory = await mkdtemp(join(tmpdir(), 'budget-notifications-ui-'))
try {
  await build({ stdin: { resolveDir: resolve(import.meta.dirname, '..'), loader: 'tsx', contents: `
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
    let RemindersPage
    const state = { version: 1, notifications: [], movement: { enabled: false, nextAt: null, lastAt: null }, marketOpen: { enabled: false, nextAt: null, lastAt: null }, supported: true, storageError: '', setupError: '' }
    let failDelivery = false, failCommand = false, selected = '', inbox = false, sequence = 0
    const envelope = () => ({ data: structuredClone(state), meta: { source: 'Fixture', freshness: 'fresh', fetchedAt: Date.now() }, errors: [] })
    window.api = { notificationsStatus: async () => envelope(), notificationsCommand: async command => {
      if (failCommand) throw Error('Fixture disk full')
      if (command.type === 'movement') state.movement = { ...state.movement, enabled: command.enabled, nextAt: command.enabled ? Date.now() + 35 * 60000 : null }
      if (command.type === 'marketOpen') state.marketOpen = { ...state.marketOpen, enabled: command.enabled, nextAt: command.enabled ? Date.parse('2026-11-02T14:30:00Z') : null }
      if (command.type === 'test') state.notifications.unshift({ id: String(++sequence), source: 'test', title: 'Test notification', body: 'Safe text <img src=x onerror=alert(1)>', at: Date.now(), read: false, desktopStatus: failDelivery ? 'failed' : 'shown', ...(failDelivery ? { deliveryError: 'OS blocked banners' } : {}) })
      if (command.type === 'read') state.notifications.forEach(item => { if (!command.id || command.id === item.id) item.read = true })
      if (command.type === 'dismiss') state.notifications = state.notifications.filter(item => item.id !== command.id)
      return envelope()
    } }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const root = createRoot(document.getElementById('root'))
    const onStatusChange = () => {}
    const render = () => root.render(<QueryClientProvider client={client}><RemindersPage inbox={inbox} onNavigate={id => selected = id} onStatusChange={onStatusChange}/></QueryClientProvider>)
    const settle = () => new Promise(resolve => setTimeout(resolve, 100))
    const check = (condition, message) => { if (!condition) throw Error(message) }
    const click = async text => { const button = [...document.querySelectorAll('button')].find(item => item.textContent === text); check(button && !button.disabled, 'Missing button: ' + text); button.click(); await settle() }
    window.runProbe = async () => {
      RemindersPage = (await import('./src/pages/RemindersPage')).RemindersPage
      render(); await settle()
      check(document.body.textContent.includes('30 and 45 minutes'), 'Interval missing')
      await click('Enable market-open reminder')
      check(state.marketOpen.enabled && document.querySelector('.market-open-reminder').textContent.includes('10:30 pm'), 'Market toggle or Singapore winter opening time missing')
      check(!state.movement.enabled, 'Market toggle must not start movement reminders')
      await click('Disable market-open reminder'); check(!state.marketOpen.enabled && state.marketOpen.nextAt === null, 'Market pause failed')
      await click('Start reminders'); check(state.movement.enabled && document.body.textContent.includes('Scheduled for'), 'Start failed')
      check(/34:|35:/.test(document.querySelector('.movement-clock strong').textContent), 'Countdown missing')
      await click('Pause reminders'); check(!state.movement.enabled && state.movement.nextAt === null, 'Pause failed')
      await click('Send test notification'); check(document.querySelector('[role=status]').textContent.includes('sent to your desktop'), 'Test success missing')
      check(!state.movement.enabled, 'Test started reminders')
      await click('Open notifications (1) →'); check(selected === 'notifications', 'Inbox link failed')
      inbox = true; render(); await settle()
      const item = document.querySelector('.reminders-item')
      check(item.textContent.includes('<img') && !item.querySelector('img,script'), 'Unsafe notification rendering')
      await click('Mark read'); check(state.notifications[0].read, 'Read failed')
      await click('Dismiss'); check(!state.notifications.length && document.body.textContent.includes('Your inbox is ready.'), 'Dismiss failed')
      failDelivery = true; await click('Send test notification')
      check(document.body.textContent.includes('OS blocked banners') && state.notifications.length === 1, 'OS failure fallback missing')
      await click('Mark all read'); check(state.notifications.every(item => item.read), 'Mark all failed')
      const filter = document.querySelector('select'); filter.value = 'movement'; filter.dispatchEvent(new Event('change', { bubbles: true })); await settle()
      check(!document.querySelector('.reminders-item'), 'Source filter failed')
      failCommand = true; await click('Send test notification'); check(document.body.textContent.includes('Fixture disk full'), 'Write failure hidden')
      failCommand = false; inbox = false; render(); await settle()
      await click('Start reminders')
      return 'PASS: reminder start/pause/countdown, test without starting scheduler, inbox navigation, safe notification text, read/dismiss/filter, OS failure fallback and storage failure visibility'
    }
    window.verifyWidth = () => { const main = document.querySelector('main'); check(main.scrollWidth <= main.clientWidth + 1, 'Horizontal overflow'); return 'PASS: responsive page without horizontal overflow' }
  ` }, bundle: true, jsx: 'automatic', platform: 'browser', format: 'iife', outfile: join(directory, 'renderer.js'),
    alias: { '@': resolve(import.meta.dirname, '../src'), '@shared': resolve(import.meta.dirname, '../electron/shared') }, logLevel: 'silent' })
  await writeFile(join(directory, 'index.html'), `<style>:root{--color-bg:#080b12;--color-surface:#0d1420;--color-surface-raised:#121b2b;--color-text:#d5dee9;--color-text-muted:#7d8ea6;--color-border:#1e2b3f;--color-border-strong:#2c3e59}html,body{height:100%;margin:0;overflow:hidden;background:var(--color-bg);font-family:Segoe UI,sans-serif}#root{height:100%;display:flex;flex-direction:column}*{box-sizing:border-box}button,select{color:inherit}h1,h2,h3,p{margin:0}</style><link rel="stylesheet" href="renderer.css"><div id="root"></div><script src="renderer.js"></script>`)
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))})
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1280, height: 850, webPreferences: { offscreen: true, backgroundThrottling: false } })
      window.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message) })
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        console.log(await window.webContents.executeJavaScript('window.runProbe().catch(error => { console.error(error.stack); throw error })'))
        console.log(await window.webContents.executeJavaScript('window.verifyWidth()'))
        await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        require('node:fs').writeFileSync(${JSON.stringify(join(tmpdir(), 'budget-movement-desktop.png'))}, (await window.webContents.capturePage()).toPNG())
        window.setSize(520, 760)
        await new Promise(resolve => setTimeout(resolve, 150))
        console.log(await window.webContents.executeJavaScript('window.verifyWidth()'))
        require('node:fs').writeFileSync(${JSON.stringify(join(tmpdir(), 'budget-movement-narrow.png'))}, (await window.webContents.capturePage()).toPNG())
        app.exit(0)
      } catch(error) { console.error(error); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const output = await new Promise<{ code: number | null; text: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let text = ''
    child.stdout.on('data', chunk => { text += chunk }); child.stderr.on('data', chunk => { text += chunk })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Notifications UI probe timed out')) }, 30_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, text }) })
  })
  assert.equal(output.code, 0, output.text)
  console.log(output.text.trim())
} finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }
