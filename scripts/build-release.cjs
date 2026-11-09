const { spawnSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const path = require('node:path')

async function main() {
  const root = path.resolve(__dirname, '..')
  const desktop = path.join(root, 'apps/desktop')
  const { loadEnv } = await import('vite')
  const env = { ...loadEnv('production', desktop, 'BUDGET_TERMINAL_'), ...process.env, BUDGET_TERMINAL_RELEASE: '1' }
  const config = JSON.parse(readFileSync(path.join(desktop, 'config/cloud-sync.json'), 'utf8'))
  if (!env.BUDGET_TERMINAL_SYNC_PRODUCTION_URL && !config.productionUrl) {
    throw Error('Production cloud sync is not configured. The service operator must set the public production URL in apps/desktop/config/cloud-sync.json or BUDGET_TERMINAL_SYNC_PRODUCTION_URL. See docs/convex-sync.md. Ordinary users do not configure a backend.')
  }
  const result = process.platform === 'win32'
    ? spawnSync(env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm run build'], { cwd: root, env, stdio: 'inherit', windowsHide: true })
    : spawnSync('npm', ['run', 'build'], { cwd: root, env, stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
