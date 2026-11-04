import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-desktop-startup-'))
try {
  const entry = join(directory, 'startup.cjs')
  await writeFile(entry, `
    const assert = require('node:assert/strict')
    const { app, dialog, session } = require('electron')
    app.setAppPath(${JSON.stringify(root)})
    app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))})
    if (process.env.BUDGET_PROBE_AGENT_FAILURE === '1') {
      const fs = require('node:fs')
      const mkdirSync = fs.mkdirSync
      fs.mkdirSync = (path, ...args) => {
        if (path === ${JSON.stringify(join(directory, 'data', 'electron-profile', 'agents'))}) throw Error('Fixture Agent startup failure')
        return mkdirSync(path, ...args)
      }
      require('node:module').syncBuiltinESMExports()
    }
    dialog.showErrorBox = (title, message) => { console.error(title + ': ' + message); app.exit(1) }
    // Block browser network requests while exercising real startup and IPC.
    app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (_details, callback) => callback({ cancel: true }),
    ))
    app.on('browser-window-created', (_event, window) => {
      window.webContents.once('did-finish-load', async () => {
        try {
          const result = await window.webContents.executeJavaScript(
            '(async () => { const cache = await window.api.cacheStatus(); return { mcp: await window.api.testMcpConnection(), cache, configured: await window.api.configureCache(cache.data.settings), progress: await window.api.heatmapProgress("SPY") } })()',
          )
          assert.equal(result.mcp.available, true, result.mcp.error)
          assert.equal(result.mcp.setup.valid, true)
          assert.equal(result.cache.meta.freshness, 'fresh')
          assert.equal(result.configured.meta.freshness, 'fresh')
          assert.deepEqual(result.configured.data.settings, result.cache.data.settings)
          assert(result.progress === null || typeof result.progress === 'object', 'Progress IPC returns null before a heatmap starts')
          const deadline = Date.now() + 10_000
          while (!await window.webContents.executeJavaScript('Boolean(document.querySelector("#root")?.children.length)')) {
            assert(Date.now() < deadline, 'Desktop UI must mount')
            await new Promise(resolve => setTimeout(resolve, 25))
          }
          console.log('PASS: built desktop opens with a mounted UI, working MCP connection and all three desktop-only IPC services')
          app.quit()
        } catch (error) { console.error(error); app.exit(1) }
      })
    })
    import(${JSON.stringify(pathToFileURL(join(root, 'out/main/main.js')).href)})
      .catch(error => { console.error(error); app.exit(1) })
  `)
  const env: NodeJS.ProcessEnv = {
    ...process.env, APPDATA: join(directory, 'roaming'), LOCALAPPDATA: join(directory, 'local'),
    BUDGET_TERMINAL_DATA_DIR: join(directory, 'data'),
  }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const electron = createRequire(import.meta.url)('electron') as string
  for (const agentFailure of [false, true]) {
    const output = await new Promise<{ code: number | null; text: string }>((resolveRun, reject) => {
      const child = spawn(electron, [entry], { env: { ...env, BUDGET_PROBE_AGENT_FAILURE: agentFailure ? '1' : '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let text = ''
      child.stdout.on('data', chunk => { text += chunk })
      child.stderr.on('data', chunk => { text += chunk })
      const timer = setTimeout(() => { child.kill(); reject(Error('Desktop startup timed out: ' + text)) }, 30_000)
      child.on('error', error => { clearTimeout(timer); reject(error) })
      child.on('close', code => { clearTimeout(timer); resolveRun({ code, text }) })
    })
    assert.equal(output.code, 0, output.text)
    assert.match(output.text, /PASS: built desktop opens/)
    if (agentFailure) {
      const logs = join(directory, 'local', 'BudgetTerminal', 'logs')
      const records = (await Promise.all((await readdir(logs)).filter(name => name.endsWith('.jsonl'))
        .map(name => readFile(join(logs, name), 'utf8')))).join('\n').split('\n').filter(Boolean).map(line => JSON.parse(line))
      assert(records.some(record => record.event === 'startup-stage-failed' && record.details.stage === 'agents'), 'Optional agent startup failure must record a fixed diagnostic stage')
      assert(!JSON.stringify(records).includes('Fixture Agent startup failure'), 'Startup diagnostics must exclude raw exception messages')
    }
    console.log(output.text.trim())
  }
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
