import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

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
// Match the Convex CLI's precedence for deployment selection.
function readProjectEnv(file) {
  try {
    return parseEnv(readFileSync(join(root, file), 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return {}
  }
}
const projectEnv = { ...readProjectEnv('.env'), ...readProjectEnv('.env.local'), ...process.env }
if (!projectEnv.CONVEX_DEPLOYMENT?.trim() && !projectEnv.CONVEX_DEPLOY_KEY?.trim()) {
  throw new Error('Select your Convex deployment first with npm exec --workspace budget-terminal-desktop -- convex init. Configure AUTH_GITHUB_ID, AUTH_GITHUB_SECRET, AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET on that deployment, then run this setup again.')
}
const names = convex(['env', ...target, 'list', '--names-only'], true).split(/\r?\n/)
// The deployment refuses to start without every provider credential the app config declares.
const missing = ['AUTH_GITHUB_ID', 'AUTH_GITHUB_SECRET', 'AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET'].filter(name => !names.includes(name))
if (missing.length) {
  throw new Error(`Configure ${missing.join(', ')} using convex env set or the Convex dashboard. Keep credentials out of the source and renderer.`)
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
if (config.authVersion !== 2 || config.accountControlsVersion !== 2 || !config.githubConfigured) throw new Error('Convex Auth v2 account security preflight failed.')
if (!config.googleConfigured) throw new Error('AUTH_GOOGLE_ID must be a Google web client ID ending in .apps.googleusercontent.com, with its matching AUTH_GOOGLE_SECRET.')
const site = new URL(convex(['env', ...target, 'get', 'CONVEX_SITE_URL'], true))
const callback = new URL('/api/auth/callback/github/callback', site)
const googleCallback = new URL('/api/auth/callback/google/callback', site)
console.log('PASS: Convex Auth v2 components deployed and GitHub and Google credential variables present.')
console.log(`REQUIRED GitHub OAuth App redirect URI: ${callback.href}`)
console.log(`REQUIRED Google OAuth client Authorized redirect URI: ${googleCallback.href}`)
console.log('Register this exact URL in GitHub OAuth App settings before reconnecting devices. Convex CLI and the signed-out live probe cannot verify GitHub callback registration. Keep wildcard matching disabled.')
console.log('Complete a browser sign-in from Settings with GitHub and with Google to verify both flows.')
