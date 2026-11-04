const { spawn, spawnSync } = require('node:child_process')
const { existsSync, readdirSync, statSync } = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { build } = require('esbuild')
const root = path.resolve(__dirname, '..')
const desktop = path.join(root, 'apps/desktop')

function newest(directory) {
  return Math.max(0, ...readdirSync(directory, { withFileTypes: true }).map(entry => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? newest(file) : statSync(file).mtimeMs
  }))
}

async function main() {
  const output = path.join(desktop, 'out/tui/main.mjs')
  await build({ entryPoints: [path.join(desktop, 'tui/main.ts')], outfile: output, bundle: true, platform: 'node', format: 'esm', target: 'node22', banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } })
  if (process.argv.includes('--help')) return import(pathToFileURL(output).href)
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run BT in an interactive PowerShell or Windows Terminal window.')
  // Reuse the same authenticated local service bridge; never open a second data store.
  const runtimeOutput = path.join(desktop, 'out/tui/runtime.mjs')
  await build({ entryPoints: [path.join(desktop, 'mcp/runtime.ts')], outfile: runtimeOutput, bundle: true, platform: 'node', format: 'esm', target: 'node22' })
  const { invokeBridge } = await import(pathToFileURL(runtimeOutput).href)
  let backend
  try { await invokeBridge('budget_terminal_connection_status', {}, { timeoutMs: 2000 }) }
  catch {
    const mainFile = path.join(desktop, 'out/main/main.js')
    const sourceTime = Math.max(...['electron', 'src', 'resources'].map(folder => newest(path.join(desktop, folder))), statSync(path.join(desktop, 'electron.vite.config.ts')).mtimeMs)
    if (!existsSync(mainFile) || statSync(mainFile).mtimeMs < sourceTime) {
      console.log('Building Budget Terminal for the TUI...')
      const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npm'
      const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run build'] : ['run', 'build']
      const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
      if (result.error || result.status !== 0) throw new Error('Build failed. Fix the errors above and run BT again.')
    }
    console.log('Starting Budget Terminal services in the background...')
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const profile = env.BUDGET_TERMINAL_DATA_DIR ? [`--user-data-dir=${path.join(env.BUDGET_TERMINAL_DATA_DIR, 'electron-profile')}`] : []
    backend = spawn(require('electron'), [...profile, desktop, '--tui-backend', `--tui-parent=${process.pid}`], { cwd: root, env, windowsHide: true, stdio: 'ignore' })
    let startupError
    backend.on('error', error => { startupError = error })
    try {
      const deadline = Date.now() + 90_000
      while (true) {
        if (startupError) throw startupError
        try { await invokeBridge('budget_terminal_connection_status', {}, { timeoutMs: 2000 }); break } catch {
          if (backend.exitCode !== null || Date.now() > deadline) throw new Error('Services did not start. Close any Budget Terminal startup error dialog and check Settings > Diagnostics in the desktop app, then retry BT. If the desktop is open, enable read-only Local MCP in Settings.')
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }
    } catch (error) { throw error }
    // The backend watches this process and drains its services when it exits.
    backend.unref()
  }
  await import(pathToFileURL(output).href)
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
