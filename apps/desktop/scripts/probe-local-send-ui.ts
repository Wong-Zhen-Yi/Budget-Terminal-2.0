import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-localsend-ui-'))
const screenshot = join(root, 'out', 'localsend-smoke.png')
try {
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(name => name.endsWith('.css'))
  assert.ok(css, 'Run npm run build first')
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  const bundle = await build({
    stdin: {
      resolveDir: root, loader: 'tsx', contents: `
        import { createRoot } from 'react-dom/client'
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
        import { LocalSendPanel } from './src/components/settings/LocalSendPanel'
        import { StatusBar } from './src/components/chrome/StatusBar'
        import { useLocalSend } from './src/api/localSendQueries'
        import { shouldPersistRemoteQuery } from './src/api/queryPersistence'
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const check = (value, message) => { if (!value) throw Error(message) }
        const settle = () => new Promise(resolve => setTimeout(resolve, 100))
        const button = text => [...document.querySelectorAll('button')].find(el => el.textContent === text)
        function Fixture() {
          const { query } = useLocalSend()
          return <><LocalSendPanel /><StatusBar panels={[]} sourcePath="" sync={query.data} onOpenSync={() => { window.openedSync = true }} /></>
        }
        window.runProbe = async () => {
          createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><Fixture /></QueryClientProvider>)
          await settle()
          check(document.body.innerText.includes('Sync is off'), 'Disabled status is missing')
          check(button('Sync off'), 'Footer sync status is missing')
          check(button('Find devices').disabled, 'Discovery must be disabled while sync is off')
          button('Enable sync').click(); await settle()
          check(document.body.innerText.includes('Running'), 'Enabled status is missing')
          button('Open pairing on this device').click(); await settle()
          check(document.querySelector('[aria-label="LocalSend pairing code"]').textContent === '123456', 'Pairing code is missing')
          check(document.body.innerText.includes('replaces the receiver'), 'Initial replacement behavior must be explained')
          button('Find devices').click(); await settle()
          const select = document.querySelector('select')
          select.value = 'peer'; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
          const input = document.querySelector('[aria-label="Receiver pairing code"]')
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '654321')
          input.dispatchEvent(new Event('input', { bubbles: true })); await settle()
          check(!button('Pair & send this data').disabled, 'Pairing controls did not enable')
          button('Pair & send this data').click(); await settle()
          check(window.actions.some(action => action.type === 'pair' && action.code === '654321'), 'Pairing did not use the entered code')
          check(document.body.innerText.includes('Paired'), 'Paired device is missing')
          window.state.pending = { id: 'conflict', alias: 'Other computer', exportedAt: new Date().toISOString(), receivedAt: Date.now() }
          window.state.devices[0].error = 'Both devices have changed'
          client.setQueryData(['localSendStatus'], window.ok(window.state)); await settle()
          check(document.querySelector('[role="alert"]').innerText.includes('paused'), 'Conflict explanation is missing')
          check(document.body.innerText.includes('Both devices have changed'), 'Peer failure is not visible')
          check(button('Sync needs review'), 'Conflict must be visible in the footer')
          button('Sync needs review').click()
          check(window.openedSync, 'Footer must open sync settings')
          check(!shouldPersistRemoteQuery(client.getQueryCache().find({ queryKey: ['localSendStatus'] })), 'Pairing codes must not enter renderer market cache')
          button('Keep local data').click(); await settle()
          check(window.actions.at(-1).accept === false, 'Keep local chose the wrong resolution')
          window.state.pending = { id: 'incoming', alias: 'Other computer', exportedAt: new Date().toISOString(), receivedAt: Date.now() }
          client.setQueryData(['localSendStatus'], window.ok(window.state)); await settle()
          button('Apply incoming data').click(); await settle()
          check(window.actions.at(-1).accept === true, 'Apply incoming chose the wrong resolution')
          check(document.body.innerText.includes('Recovery backup:'), 'Recovery path is hidden')
          window.state.pending = { id: 'preview', alias: 'Other computer', exportedAt: new Date().toISOString(), receivedAt: Date.now() }
          client.setQueryData(['localSendStatus'], window.ok(window.state)); await settle()
          check([...document.querySelectorAll('button,input,select')].every(el => el.getBoundingClientRect().right <= innerWidth), 'Controls overflow the window')
          window.api.localSendStatus = async () => { throw Error("Error invoking remote method 'sync:localsend:status': Error: No handler registered for 'sync:localsend:status'") }
          await client.refetchQueries({ queryKey: ['localSendStatus'] }); await settle()
          check(document.body.innerText.includes('Close Budget Terminal completely'), 'An older backend needs a clear recovery message')
          window.api.localSendAction = async () => { throw Error("Error invoking remote method 'sync:localsend:action': Error: No handler registered for 'sync:localsend:action'") }
          button('Sync now').click(); await settle()
          check(!document.body.innerText.includes('No handler registered'), 'Raw missing-handler errors should be explained')
          return 'PASS: LocalSend enable/discovery, pairing controls, paired/error states, both conflict choices, recovery path, cache exclusion and layout'
        }
      `,
    },
    bundle: true, jsx: 'automatic', write: false, format: 'iife',
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
  await writeFile(join(directory, 'index.html'), `
    <html><head><link rel="stylesheet" href="theme.css"></head><body style="padding:16px;overflow:auto"><div id="root"></div>
    <script>
      window.ok = data => ({ data: structuredClone(data), errors: [], meta: { freshness: 'fresh', source: 'fixture', fetchedAt: Date.now() } });
      window.state = { enabled: false, running: false, alias: 'Budget Terminal · Test laptop', port: 53317, addresses: ['192.168.1.12'], devices: [] };
      window.actions = [];
      window.api = {
        apiUsage: async () => ({ providers: [], sampledAt: Date.now() }),
        localSendStatus: async () => ok(state),
        localSendAction: async action => {
          actions.push(action);
          if (action.type === 'enable') { state.running = action.enabled; state.enabled = action.enabled; }
          if (action.type === 'openPairing') { state.pairingCode = '123456'; state.pairingExpiresAt = Date.now() + 120000; }
          if (action.type === 'discover') state.devices = [{ alias: 'Other computer', address: '192.168.1.13', port: 53317, fingerprint: 'peer', protocol: 'https', budgetTerminal: true }];
          if (action.type === 'pair') { state.devices[0].paired = true; state.devices[0].lastSyncedAt = Date.now(); }
          if (action.type === 'resolve') { state.pending = undefined; if (action.accept) state.recoveryPath = '/fixture/sync/recovery/before-sync.json'; }
          return ok(state);
        }
      };
    </script><script src="renderer.js"></script></body></html>
  `)
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron');
    const fs = require('node:fs');
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1000, height: 900, webPreferences: { contextIsolation: true, backgroundThrottling: false } });
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
        console.log(await window.webContents.executeJavaScript('window.runProbe()'));
        window.webContents.invalidate();
        await new Promise(resolve => setTimeout(resolve, 300));
        fs.writeFileSync(${JSON.stringify(screenshot)}, (await window.webContents.capturePage({ stayHidden: true, stayAwake: true })).toPNG());
        app.exit(0);
      } catch (error) { console.error(error); app.exit(1); }
    });
  `)
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data }); child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(new Error(output || 'UI probe timed out')) }, 30000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  console.log(result.output.trim())
  console.log('Screenshot: ' + screenshot)
} finally {
  assert.ok(!relative(tmpdir(), directory).startsWith('..'))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
