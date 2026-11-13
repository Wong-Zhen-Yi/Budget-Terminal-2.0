import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const cli = join(dirname(require.resolve('convex/package.json')), 'bin/main.js')
const production = process.argv.includes('--prod')
if (process.argv.slice(2).some(arg => arg !== '--prod')) throw new Error('Usage: npm run convex:setup [-- --prod]')
const target = production ? ['--prod'] : []
function convex(args, capture = false) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root, env: process.env, windowsHide: true, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit',
  })
  if (result.error || result.status !== 0) throw new Error(`Convex ${args[0]} failed. Check CLI sign-in and deployment configuration.`)
  return result.stdout?.trim() ?? ''
}

// Never overwrite a deployed backend until a complete private recovery export exists.
// First-time projects should run convex:dev to select/create their deployment first.
let configured = false
try { configured = /^CONVEX_DEPLOYMENT=\S+/m.test(readFileSync(join(root, '.env.local'), 'utf8')) } catch {}
if (!configured && !process.env.CONVEX_DEPLOYMENT && !process.env.CONVEX_DEPLOY_KEY) {
  throw new Error('Select your Convex project first with npm run convex:dev. Configure AUTH_GITHUB_ID and AUTH_GITHUB_SECRET on that deployment, then run this setup again.')
}
const names = convex(['env', ...target, 'list', '--names-only'], true).split(/\r?\n/)
if (!names.includes('AUTH_GITHUB_ID') || !names.includes('AUTH_GITHUB_SECRET')) {
  throw new Error('Configure AUTH_GITHUB_ID and AUTH_GITHUB_SECRET using convex env set or the Convex dashboard. Keep credentials out of the source and renderer.')
}
convex(['codegen', '--typecheck', 'disable'])
// Convex's built-in compiler lookup does not resolve hoisted npm workspace dependencies.
const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc')
const check = spawnSync(process.execPath, [tsc, '--noEmit', '-p', 'tsconfig.json'], { cwd: root, env: process.env, windowsHide: true, stdio: 'inherit' })
if (check.error || check.status !== 0) throw new Error('Typecheck failed; the backend has not been deployed.')
const backups = join(process.env.LOCALAPPDATA || homedir(), 'BudgetTerminal', 'convex-backups')
mkdirSync(backups, { recursive: true, mode: 0o700 })
const backup = join(backups, `before-auth-v2-${production ? 'prod' : 'dev'}-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`)
convex(['export', ...target, '--include-file-storage', '--path', backup])
console.log(`Private recovery export saved outside the repository: ${backup}`)
if (production) convex(['deploy', '--yes', '--typecheck', 'disable'])
else convex(['dev', '--once', '--typecheck', 'disable', '--tail-logs', 'disable'])
const config = JSON.parse(convex(['run', ...target, 'sync:authConfiguration', '{}'], true))
if (config.authVersion !== 2 || !config.githubConfigured) throw new Error('Convex Auth v2 preflight failed.')
console.log('PASS: Convex Auth v2 components deployed and GitHub credentials configured. Reconnect each device in Settings with the same GitHub account.')
console.log('GitHub callback: <your Convex site URL>/api/auth/callback/github/callback. Register this exact URL if your OAuth App uses exact callback matching.')
