import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
const directory = await mkdtemp(join(tmpdir(), 'budget-input-'))
const require = createRequire(import.meta.url)
try {
  await build({ stdin: { resolveDir: resolve(import.meta.dirname, '..'), loader: 'tsx', contents: `
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { NumberInput } from './src/components/ui/NumberInput'
    import { TextInput } from './src/components/ui/TextInput'
    window.commits = []
    createRoot(document.getElementById('root')).render(<><NumberInput value={100} onCommit={v => window.commits.push(v)} /><TextInput value="Original" onCommit={v => window.commits.push(v)} /><TextInput wrap value="Original" onCommit={v => window.commits.push(v)} /><button>Blur</button></>)
  ` }, bundle: true, platform: 'browser', format: 'iife', outfile: join(directory, 'renderer.js') })
  await writeFile(join(directory, 'index.html'), '<div id="root"></div><script src="renderer.js"></script>')
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron')
    const assert = require('node:assert/strict')
    app.whenReady().then(async () => {
      const win = new BrowserWindow({ show: true, webPreferences: { backgroundThrottling: false } })
      const pause = () => new Promise(r => setTimeout(r, 100))
      try {
        await win.loadFile(${JSON.stringify(join(directory, 'index.html'))})
        win.show(); win.focus(); await pause()
        for (let index = 0; index < 3; index++) {
          for (const mode of ['Escape', 'Enter', 'blur']) {
            await win.webContents.executeJavaScript(\`window.commits=[];var el=document.querySelectorAll('input,textarea')[\${index}];el.focus()\`)
            await pause()
            assert(await win.webContents.executeJavaScript('document.activeElement === el'), 'Fixture must have focus')
            await win.webContents.executeJavaScript(\`Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,'value').set.call(el,\${index === 0 ? "'999'" : "'Discard me'"});el.dispatchEvent(new Event('input',{bubbles:true}))\`)
            await pause()
            if (mode === 'blur') await win.webContents.executeJavaScript('document.querySelector("button").focus()')
            else { win.webContents.sendInputEvent({ type:'keyDown', keyCode:mode }); win.webContents.sendInputEvent({type:'keyUp',keyCode:mode}) }
            await pause()
            const commits = await win.webContents.executeJavaScript('window.commits')
            assert.deepEqual(commits, mode === 'Escape' ? [] : [index === 0 ? 999 : 'Discard me'])
            if (mode === 'Escape') assert.equal(await win.webContents.executeJavaScript('el.value'), index === 0 ? '100' : 'Original')
          }
        }
        console.log('PASS: focused number, text and wrapping textarea cancel Escape and commit Enter/blur')
        app.exit(0)
      } catch(e) { console.error(e); app.exit(1) }
    })
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{code: number | null; output: string}>((resolveRun, reject) => {
    const child = spawn(require('electron'), [join(directory, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(Error('Input probe timed out')) }, 30000)
    child.on('error', reject)
    child.on('exit', code => { clearTimeout(timer); resolveRun({code, output}) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
} finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }
