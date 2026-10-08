import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { CHANNELS, type Envelope, type PortfolioPayload } from '../electron/shared/contract'
import { startWebServer } from '../electron/web/server'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'budget-web-ui-'))
const oldAppData = process.env.APPDATA
const oldLocalAppData = process.env.LOCALAPPDATA
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory
const { createWebRoutes } = await import('../electron/web/routes')
const { subscribeSavedDataChanged } = await import('../electron/services/savedDataEvents')
const local = createWebRoutes()
// Real holdings expose intrinsic grid sizing that an empty panel cannot exercise.
const portfolio = await local(CHANNELS.portfolio, []) as Envelope<PortfolioPayload>
const portfolioId = portfolio.data.activeId!
for (const ticker of ['NVDA', 'RKLB', 'VST', 'AVGO', 'GOOGL', 'SOFI', 'TACK', 'IAU', 'AAPL', 'MSFT', 'AMZN']) {
  await local(CHANNELS.portfolioMutate, [{ type: 'addPosition', portfolioId, ticker }])
  await local(CHANNELS.portfolioMutate, [{ type: 'setPosition', portfolioId, ticker, shares: 10, avgPrice: 100 }])
}
const requests: string[] = []
const invalidRequests: string[] = []
const localChannels = new Set<string>([CHANNELS.settings, CHANNELS.portfolio, CHANNELS.cards, CHANNELS.personalFinance, CHANNELS.settingsMutate])
const fixture = createWebRoutes(async (channel, request) => {
  if (channel === CHANNELS.apiUsage) return { sampledAt: Date.now(), providers: [] }
  if (localChannels.has(channel)) return local(channel, [request])
  throw new TypeError('Offline UI fixture: provider unavailable')
})
const server = await startWebServer({
  port: 0, rendererDirectory: join(root, 'out/renderer'), subscribe: subscribeSavedDataChanged,
  invoke: async (channel, args) => {
    requests.push(channel)
    // The fixture deliberately fails providers. Every page must still start and
    // report its failure without external network traffic or personal data.
    try { return await fixture(channel, args) }
    catch (error) {
      if (error instanceof Error && error.message === 'Invalid service request.') invalidRequests.push(channel)
      throw error
    }
  },
})
try {
  const url = `http://127.0.0.1:${server.status().port}`
  const screenshot = join(root, 'out/web-ipad-portrait.png')
  const desktopBundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client'
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
      import { TabBar } from './src/components/chrome/TabBar'
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><div className="terminal-shell flex h-full flex-col"><TabBar onOpenPicker={() => {}} onReload={() => {}} reloading={false} clockCountry="US" time12h={true} obscured={false} onToggleObscure={() => {}} /></div></QueryClientProvider>)
    ` },
    bundle: true, jsx: 'automatic', write: false, format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@': join(root, 'src'), '@shared': join(root, 'electron/shared') },
  })
  await writeFile(join(directory, 'desktop.js'), desktopBundle.outputFiles[0].text)
  const assets = join(root, 'out/renderer/assets')
  const css = (await readdir(assets)).find(file => file.endsWith('.css'))!
  await writeFile(join(directory, 'theme.css'), await readFile(join(assets, css)))
  await writeFile(join(directory, 'desktop.html'), `<link rel="stylesheet" href="theme.css"><div id="root"></div><script>
    window.decisions = [];
    const status = { enabled: true, running: true, port: 4317, pairingCode: '0123', pairingExpiresAt: Date.now() + 600000, sessionCount: 2, connectionCount: 1, accessRequests: ['REQUEST1', 'REQUEST2'].map(id => ({id, label: 'iPad browser', requestedAt: Date.now(), expiresAt: Date.now() + 300000})) };
    window.api = { platform: 'win32', mcpStatus: async () => ({available: true, active: false, connected: true}), webStatus: async () => structuredClone(status), decideWebAccess: async (id, approve) => { window.decisions.push({id, approve}); status.accessRequests = status.accessRequests.filter(request => request.id !== id); return structuredClone(status); } };
    </script><script src="desktop.js"></script>`)
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron');
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    app.setPath('userData', ${JSON.stringify(join(directory, 'userData'))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 768, height: 1024, webPreferences: { backgroundThrottling: false } });
      window.setContentSize(768, 1024);
      window.webContents.setUserAgent('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1');
      window.webContents.on('console-message', event => { if (event.level === 'error' || event.level === 3) console.error(event.message); });
      const run = async script => { try { return await window.webContents.executeJavaScript(script); } catch (error) { console.error('Renderer check: ' + script); throw error; } };
      const wait = async (script, label) => {
        const until = Date.now() + 20000;
        while (Date.now() < until) { if (await run(script)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
        throw Error('Timed out: ' + label + '\\n' + await run('document.body.innerText'));
      };
      const pair = async code => {
        await wait('!!document.querySelector("#pair-code:not(:disabled)")', 'pairing input');
        // React controlled fields require the native setter to update the value tracker.
        await run('(() => { const field = document.querySelector("#pair-code"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, ' + JSON.stringify(code) + '); field.dispatchEvent(new Event("input", { bubbles:true })); })()');
        await new Promise(resolve => setTimeout(resolve, 100));
        await run('document.querySelector("form").requestSubmit()');
      };
      try {
        await window.loadURL(${JSON.stringify(url)});
        window.webContents.debugger.attach('1.3');
        await window.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true });
        assert.ok(await run('document.querySelector("#pair-code").inputMode === "numeric" && document.querySelector("#pair-code").maxLength === 4'), 'Four-digit code needs numeric keyboard and length limit');
        await pair(${JSON.stringify(server.status().pairingCode === '0000' ? '0001' : '0000')});
        await wait('document.querySelector("[role=alert]")?.textContent.includes("invalid")', 'invalid code feedback');
        await pair(${JSON.stringify(server.status().pairingCode)});
        await wait('!!document.querySelector(".terminal-shell")', 'authenticated terminal');
        await wait('document.body.innerText.includes("Connected")', 'SSE connection');
        assert.equal(await run('!!document.querySelector("button[aria-label=minimize], button[aria-label=maximize], button[aria-label=close]")'), false, 'Desktop window controls leaked into browser');
        await wait('document.querySelector("footer [role=status]")?.textContent.includes("startup load(s) failed")', 'visible startup provider failures');
        assert.ok(await run('matchMedia("(pointer: coarse)").matches'), 'Tablet checks must exercise touch styles');
        for (const [width, height] of [[1133, 610], [1024, 600], [744, 980], [768, 900]]) {
          window.setContentSize(width, height);
          await new Promise(resolve => setTimeout(resolve, 200));
          assert.ok(await run('getComputedStyle(document.querySelector(".workspace-sidebar")).display === "none"'), 'iPad mini sidebar must leave space in both orientations');
          assert.ok(await run('document.documentElement.scrollWidth <= innerWidth'), 'Tablet shell must fit the viewport');
          assert.ok(await run('document.documentElement.scrollHeight <= innerHeight'), 'Tablet document must not scroll beyond the terminal');
          assert.ok(await run('getComputedStyle(document.documentElement).overscrollBehaviorY === "none" && getComputedStyle(document.body).overscrollBehaviorY === "none"'), 'Tablet viewport must disable rubber-banding');
          assert.ok(await run('(() => { const root = document.querySelector("#root"); const rect = root.getBoundingClientRect(); return getComputedStyle(root).position === "fixed" && rect.top === 0 && Math.abs(rect.bottom - innerHeight) <= 1; })()'), 'Terminal must stay anchored to the visible viewport on rotation');
          assert.ok(await run('[...document.querySelectorAll("[data-page-id=dashboard], [data-page-id=dashboard] *")].filter(node => /auto|scroll/.test(getComputedStyle(node).overflowY)).every(node => getComputedStyle(node).overscrollBehaviorY === "none")'), 'Nested tablet panels must disable edge bounce');
          assert.ok(await run('(() => { const page = document.querySelector("[data-page-id=dashboard]"); return page.scrollWidth <= page.clientWidth + 1; })()'), 'Dashboard must reflow without horizontal page scrolling');
          assert.ok(await run('(() => { const macro = document.querySelector(".dashboard-macro").getBoundingClientRect(); const chart = document.querySelector(".dashboard-chart").getBoundingClientRect(); const page = document.querySelector("[data-page-id=dashboard]").getBoundingClientRect(); return macro.height <= 120 && chart.top < page.bottom - 100; })()'), 'Populated holdings must not stretch macro tiles and push chart below the viewport');
          assert.ok(await run('document.querySelector(".dashboard-chart").getBoundingClientRect().height >= 520'), 'Chart squeezed by desktop side columns');
          assert.ok(await run('document.querySelector(".dashboard-chart > div:last-child").getBoundingClientRect().height >= 300'), 'Toolbar leaves too little chart space');
          assert.ok(await run('(() => { const panel = document.querySelector(".dashboard-options-column").getBoundingClientRect(); const chart = document.querySelector(".dashboard-chart").getBoundingClientRect(); return panel.top >= chart.bottom; })()'), 'Options must move below chart on tablet');
          assert.ok(await run('(() => { const footer = document.querySelector("footer").getBoundingClientRect(); return footer.bottom <= innerHeight && footer.right <= innerWidth; })()'), 'Tablet footer exceeds viewport');
          assert.ok(await run('(() => { const bar = document.querySelector(".terminal-topbar").getBoundingClientRect(); const footer = document.querySelector("footer").getBoundingClientRect(); const header = document.querySelector(".workspace-header").getBoundingClientRect(); return Math.abs(bar.bottom - innerHeight) <= 1 && bar.top >= footer.bottom - 1 && header.top === 0; })()'), 'Browser actions must sit below status with navigation at the top');
          assert.ok(await run('getComputedStyle(document.querySelector("footer [role=status]")).whiteSpace === "normal"'), 'Startup progress and failures must remain readable');
          // Capture both the chart and panels reached by scrolling for visual review.
          await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
          fs.writeFileSync(${JSON.stringify(join(root, 'out'))} + '/web-ipad-dashboard-' + width + '.png', (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
          await run('(() => { const page = document.querySelector("[data-page-id=dashboard]"); page.scrollTop = page.scrollHeight; })()');
          await new Promise(resolve => setTimeout(resolve, 100));
          await run('window.scrollTo(0, 10000)');
          assert.ok(await run('window.scrollY === 0 && Math.abs(document.querySelector(".terminal-topbar").getBoundingClientRect().bottom - innerHeight) <= 1'), 'Scrolling at the page bottom must not move the action bar or expose a bottom gap');
          assert.ok(await run('(() => { const page = document.querySelector("[data-page-id=dashboard]").getBoundingClientRect(); const last = document.querySelector(".dashboard-options > section:last-child").getBoundingClientRect(); return last.bottom <= page.bottom + 1 && last.top >= page.top; })()'), 'Last options panel must be reachable by scrolling');
          fs.writeFileSync(${JSON.stringify(join(root, 'out'))} + '/web-ipad-options-' + width + '.png', (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
          await run('document.querySelector("[data-page-id=dashboard]").scrollTop = 0');
        }
        // Electron does not set browser-mode. Exercise its existing CSS at both
        // sides of the tablet breakpoint so this fix cannot reflow the desktop.
        await run('document.documentElement.classList.remove("browser-mode")');
        for (const width of [1133, 1600]) {
          window.setContentSize(width, 900);
          await new Promise(resolve => setTimeout(resolve, 150));
          assert.equal(await run('getComputedStyle(document.querySelector(".dashboard-layout")).display'), 'flex', 'Desktop dashboard must retain splitter columns');
          assert.equal(await run('document.querySelector(".terminal-topbar").getBoundingClientRect().top'), 0, 'Desktop actions must remain at the top');
          assert.equal(await run('getComputedStyle(document.querySelector(".dashboard-market")).display'), 'flex', 'Desktop market column must retain its own layout');
          assert.ok(await run('(() => { const chart = document.querySelector(".dashboard-chart").getBoundingClientRect(); const options = document.querySelector(".dashboard-options-column").getBoundingClientRect(); return Math.abs(chart.top - options.top) <= 1 && options.left >= chart.right; })()'), 'Desktop options must remain beside the chart');
          assert.equal(await run('getComputedStyle(document.querySelector(".dashboard-holdings h2")).fontSize'), '15px', 'Desktop type scale must remain unchanged');
        }
        await run('document.documentElement.classList.add("browser-mode")');
        window.setContentSize(744, 980);
        await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
        await wait('innerWidth === 744 && getComputedStyle(document.querySelector(".workspace-sidebar")).display === "none"', 'tablet layout restored after desktop CSS check');
        assert.ok(await run('getComputedStyle(document.querySelector(".workspace-sidebar")).display === "none"'), 'Portrait sidebar should leave room for pages');
        assert.ok(await run('document.querySelector(".browser-page-select select").getBoundingClientRect().height > 0'), 'Portrait page selector missing');
        await run('(() => { const select = document.querySelector(".browser-page-select select"); select.value = "pre-market"; select.dispatchEvent(new Event("change", { bubbles:true })); })()');
        await wait('!!document.querySelector("[data-page-id=pre-market]")', 'Pre-Market selection');
        window.setContentSize(1133, 610);
        await new Promise(resolve => setTimeout(resolve, 200));
        assert.ok(await run('(() => { const page = document.querySelector("[data-page-id=pre-market]"); return page.scrollHeight > page.clientHeight && getComputedStyle(page).overflowY === "auto" && page.firstElementChild.getBoundingClientRect().height >= 600; })()'), 'Landscape Pre-Market panels must keep their height and scroll');
        fs.writeFileSync(${JSON.stringify(join(root, 'out/web-ipad-pre-market.png'))}, (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        await run('(() => { const page = document.querySelector("[data-page-id=pre-market]"); page.scrollTop = page.scrollHeight; })()');
        assert.ok(await run('(() => { const page = document.querySelector("[data-page-id=pre-market]"); return page.scrollTop > 0 && page.firstElementChild.getBoundingClientRect().bottom <= page.getBoundingClientRect().bottom + 1 && Math.abs(document.querySelector(".terminal-topbar").getBoundingClientRect().bottom - innerHeight) <= 1; })()'), 'Pre-Market bottom row must be reachable while actions stay visible');
        window.setContentSize(744, 980);
        await new Promise(resolve => setTimeout(resolve, 150));
        await run('(() => { const select = document.querySelector(".browser-page-select select"); select.value = "stocks"; select.dispatchEvent(new Event("change", { bubbles:true })); })()');
        await wait('document.querySelector("h1")?.textContent === "Stocks"', 'touch page selection');
        assert.ok(await run('(() => { const page = document.querySelector("[data-page-id=stocks]"); return page.scrollWidth > page.clientWidth && getComputedStyle(page).overflowX === "auto"; })()'), 'Dense Stocks page must scroll horizontally');
        await run('(() => { const select = document.querySelector(".browser-page-select select"); select.value = "settings"; select.dispatchEvent(new Event("change", { bubbles:true })); })()');
        await wait('document.body.innerText.includes("manage pairing codes")', 'browser host settings explanation');
        assert.equal(await run('!![...document.querySelectorAll("h2")].find(node => node.textContent.includes("User Data") || node.textContent.includes("Local MCP"))'), false, 'Desktop maintenance leaked into browser');
        // Wake the hidden compositor before retaining a screenshot of the new tree.
        await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
        await new Promise(resolve => setTimeout(resolve, 300));
        fs.writeFileSync(${JSON.stringify(screenshot)}, (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        window.setContentSize(1024, 768);
        await new Promise(resolve => setTimeout(resolve, 150));
        assert.ok(await run('(() => { const footer = document.querySelector("footer").getBoundingClientRect(); return footer.bottom <= innerHeight && footer.right <= innerWidth; })()'), 'Landscape footer exceeds viewport');
        fs.writeFileSync(${JSON.stringify(join(root, 'out/web-ipad-landscape.png'))}, (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        await run('localStorage.setItem("budget-terminal:valuation", "private fixture note"); [...document.querySelectorAll("button")].find(button => button.textContent === "Log out").click()');
        await wait('!!document.querySelector("#pair-code")', 'logout clears terminal');
        assert.equal(await run('localStorage.getItem("budget-terminal:valuation")'), null, 'Logout kept private page notes');
        const requestAccess = async () => {
          await run('[...document.querySelectorAll("button")].find(button => button.textContent === "Request Access").click()');
          await wait('document.querySelector("[role=status]")?.textContent.includes("Waiting for approval")', 'access request waiting');
        };
        await requestAccess();
        console.log('DECLINE_ACCESS');
        await wait('document.querySelector("[role=status]")?.textContent.includes("declined")', 'declined request feedback');
        await requestAccess();
        await window.reload();
        await wait('document.querySelector("[role=status]")?.textContent.includes("Waiting for approval")', 'pending request restored after reload');
        window.setContentSize(1133, 500);
        await new Promise(resolve => setTimeout(resolve, 150));
        assert.ok(await run('document.querySelector("form").getBoundingClientRect().top >= 0'), 'Pairing form top must stay reachable in short landscape');
        await run('document.querySelector("main").scrollTop = document.querySelector("main").scrollHeight');
        assert.ok(await run('document.querySelector("form").getBoundingClientRect().bottom <= innerHeight'), 'Pairing form bottom must stay reachable by scrolling');
        window.setContentSize(1024, 768);
        await run('document.querySelector("main").scrollTop = 0');
        await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
        fs.writeFileSync(${JSON.stringify(join(root, 'out/web-access-request.png'))}, (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        console.log('APPROVE_ACCESS');
        await wait('document.body.innerText.includes("Connected")', 'desktop approval opens terminal without code');
        console.log('REVOKE_BROWSER');
        await wait('!!document.querySelector("#pair-code")', 'host session revocation returns to pairing');
        // Exercise the desktop review component with synthetic requests and no real host data.
        window.setContentSize(1920, 1030);
        await window.loadFile(${JSON.stringify(join(directory, 'desktop.html'))});
        await wait('document.querySelector("[data-remote-connection]")?.textContent.includes("Review access (2)")', 'top bar request alert');
        assert.ok(await run('document.querySelector(".terminal-topbar [data-remote-connection]").previousElementSibling.getAttribute("aria-label").startsWith("MCP:")'), 'Remote must sit beside MCP in the highlighted top bar area');
        assert.ok(await run('document.querySelector("[data-remote-connection]").textContent.includes("Connected (1)")'), 'Remote must display active connections');
        assert.equal(await run('!!document.querySelector("dialog[open]")'), false, 'Remote controls should start closed');
        await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
        fs.writeFileSync(${JSON.stringify(join(root, 'out/remote-topbar.png'))}, (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        await run('document.querySelector("[data-remote-connection] button[aria-label]").click()');
        await wait('document.body.innerText.includes("REQUEST2")', 'desktop review controls');
        assert.ok(await run('!!document.querySelector("dialog[open]")'), 'Top bar request control must open review without navigating');
        assert.ok(await run('document.querySelector("dialog").textContent.includes("remembered browser(s)")'), 'Remote must explain persistence');
        assert.equal(await run('document.body.innerText.toLowerCase().includes("web access")'), false, 'Visible Web access labels must be renamed Remote');
        assert.ok(await run('document.body.innerText.includes("0123")'), 'Desktop must retain leading zeros in pairing code');
        await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
        fs.writeFileSync(${JSON.stringify(join(root, 'out/web-access-desktop-review.png'))}, (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        await run('[...document.querySelectorAll("button")].find(button => button.textContent === "Approve").click()');
        await wait('!document.body.innerText.includes("REQUEST1")', 'desktop approval removes request');
        await run('[...document.querySelectorAll("button")].find(button => button.textContent === "Decline").click()');
        await wait('!document.body.innerText.includes("REQUEST2")', 'desktop decline removes request');
        assert.equal(await run('!!document.querySelector("[data-remote-connection] button[aria-label]")'), false, 'Request button must clear after all requests are reviewed');
        assert.deepEqual(await run('window.decisions'), [{ id: 'REQUEST1', approve: true }, { id: 'REQUEST2', approve: false }]);
        await run('[...document.querySelectorAll("dialog button")].find(button => button.textContent === "Close").click()');
        await wait('!document.querySelector("dialog[open]")', 'Remote review closes');
        await run('document.querySelector("[data-remote-connection] button").click()');
        await wait('!!document.querySelector("dialog[open]")', 'Remote connection button opens settings');
        console.log('PASS: four-digit pairing, numeric keyboard, access request/decline/reload/approval, shared services, all-page startup failures, iPad layout, logout and revocation');
        app.exit(0);
      } catch (error) { console.error(error); app.exit(1); }
    });
  `)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
    const child = spawn(require('electron') as string, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (data: Buffer) => {
      const message = data.toString()
      output += message
      if (message.includes('DECLINE_ACCESS')) server.decideAccess(server.status().accessRequests[0].id, false)
      if (message.includes('APPROVE_ACCESS')) server.decideAccess(server.status().accessRequests[0].id, true)
      if (message.includes('REVOKE_BROWSER')) void server.revoke()
    })
    child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Browser UI probe timed out: ' + output)) }, 90_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, output }) })
  })
  assert.equal(result.code, 0, result.output)
  assert.deepEqual(invalidRequests, [], 'Browser startup sent requests rejected by the service schemas')
  for (const channel of [CHANNELS.money, CHANNELS.economic, CHANNELS.forexQuotes, CHANNELS.stocks, CHANNELS.bitcoin]) assert.ok(requests.includes(channel), `Startup did not request ${channel}`)
  console.log(result.output.replace(/(?:DECLINE_ACCESS|APPROVE_ACCESS|REVOKE_BROWSER)\r?\n/g, '').trim())
  console.log(`Screenshots: ${screenshot}, ${join(root, 'out/web-ipad-landscape.png')}`)
} finally {
  await server.stop()
  if (oldAppData === undefined) delete process.env.APPDATA
  else process.env.APPDATA = oldAppData
  if (oldLocalAppData === undefined) delete process.env.LOCALAPPDATA
  else process.env.LOCALAPPDATA = oldLocalAppData
  assert.ok(!relative(tmpdir(), directory).startsWith('..'))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
