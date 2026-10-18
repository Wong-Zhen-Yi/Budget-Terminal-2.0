import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { loadRenderer } from '../electron/services/rendererStartup.js'

const directory = await mkdtemp(join(tmpdir(), 'budget-renderer-startup-'))
try {
  let calls = 0
  const missingFile = Object.assign(new Error('ERR_FILE_NOT_FOUND'), { code: 'ERR_FILE_NOT_FOUND' })
  const fakeWindow = {
    isDestroyed: () => false,
    loadURL: async () => { throw Error('Production must not use loadURL') },
    loadFile: async () => { calls++; if (calls < 3) throw missingFile },
  }
  await loadRenderer(fakeWindow, import.meta.filename, undefined, { attempts: 3, retryDelayMs: 1 })
  assert.equal(calls, 3, 'Retry a file that disappears between access and loadFile')
  fakeWindow.loadFile = async () => { throw new Error('Unexpected renderer error') }
  await assert.rejects(loadRenderer(fakeWindow, import.meta.filename), /Unexpected renderer error/)
  await loadRenderer({ ...fakeWindow, isDestroyed: () => true }, 'missing', undefined, { attempts: 1 })
  await assert.rejects(loadRenderer(fakeWindow, join(directory, 'missing.html'), undefined,
    { attempts: 2, retryDelayMs: 1 }), /Launch Budget Terminal.cmd/)

  const entry = join(directory, 'main.cjs')
  await build({
    stdin: {
      resolveDir: resolve(import.meta.dirname, '..'), loader: 'ts', contents: `
        import { app, BrowserWindow } from 'electron'
        import assert from 'node:assert/strict'
        import { mkdir, writeFile } from 'node:fs/promises'
        import { join } from 'node:path'
        import { loadRenderer } from './electron/services/rendererStartup'
        const directory = ${JSON.stringify(directory)}
        app.setPath('userData', join(directory, 'userData'))
        app.whenReady().then(async () => {
          const window = new BrowserWindow({show: false, webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false}})
          try {
            const folder = join(directory, 'renderer with spaces # %')
            const file = join(folder, 'index.html')
            let loads = 0
            window.webContents.on('did-finish-load', () => loads++)
            const pending = loadRenderer(window, file, undefined, {attempts: 50, retryDelayMs: 20})
            await new Promise(resolve => setTimeout(resolve, 80))
            assert.equal(loads, 0, 'Do not load a Chromium error page while waiting for the build')
            await mkdir(folder, {recursive: true})
            await writeFile(file, '<!doctype html><title>Recovered renderer</title><main>Budget Terminal ready</main>')
            await pending
            assert.equal(loads, 1)
            assert.equal(window.isVisible(), false, 'Loader must not show a window before its caller is ready')
            assert.equal(await window.webContents.executeJavaScript('document.querySelector("main").textContent'), 'Budget Terminal ready')
            console.log('PASS: real Electron recovered a temporarily missing renderer, including spaces and special characters in the path')
            await assert.rejects(loadRenderer(window, join(folder, 'permanently-missing.html'), undefined,
              {attempts: 2, retryDelayMs: 1}), /could not find its built interface/)
            await loadRenderer(window, 'unused', 'data:text/html,<title>Development renderer</title>')
            assert.equal(await window.webContents.executeJavaScript('document.title'), 'Development renderer')
            console.log('PASS: permanent missing file has actionable failure; development URL remains supported')
            app.exit(0)
          } catch (error) {console.error(error); app.exit(1)}
        })
      `,
    },
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: entry,
  })
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const electron = createRequire(import.meta.url)('electron') as string
  const output = await new Promise<{ code: number | null; text: string }>((resolveRun, reject) => {
    const child = spawn(electron, [entry], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let text = ''
    child.stdout.on('data', chunk => { text += chunk })
    child.stderr.on('data', chunk => { text += chunk })
    const timer = setTimeout(() => { child.kill(); reject(Error('Renderer startup probe timed out')) }, 30_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, text }) })
  })
  assert.equal(output.code, 0, output.text)
  console.log(output.text.trim())
  console.log('PASS: transient navigation errors retry, unexpected errors propagate and destroyed windows stop loading')
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
