const { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

function createDemoSession(environment) {
  const fixture = require('../fixtures/demo-user-data.json')
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'budget-terminal-demo-'))
  const appData = join(directory, 'roaming')
  const dataDir = join(appData, 'BudgetTerminalElectron')
  const localData = join(directory, 'local')
  // Cleanup is scoped to the directory returned by mkdtemp, never an inherited path.
  const close = () => rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  try {
    for (const folder of [join(dataDir, 'electron-profile'), localData, join(directory, 'downloads')]) {
      mkdirSync(folder, { recursive: true })
    }
    for (const [name, value] of Object.entries({
      'portfolio.json': fixture.userData,
      'settings.json': fixture.settings,
      'strategies.json': fixture.cards,
      'articles.json': fixture.articles,
    })) {
      writeFileSync(join(dataDir, name), JSON.stringify(value, null, 2), { flag: 'wx' })
    }
  } catch (error) {
    close()
    throw error
  }
  const overrides = {
    APPDATA: appData,
    LOCALAPPDATA: localData,
    BUDGET_TERMINAL_DATA_DIR: dataDir,
    BUDGET_TERMINAL_DEMO_DIR: directory,
    // Pi reads credentials, models and settings from here, so the demo never sees personal sign-ins.
    PI_CODING_AGENT_DIR: join(directory, 'pi'),
    // Claude Code keeps its sign-in in its config directory, so the demo's Claude Code is signed out.
    CLAUDE_CONFIG_DIR: join(directory, 'claude'),
  }
  // Drop case variants too: Windows resolves environment names case-insensitively.
  // Model provider credentials in the environment are dropped too, so the demo cannot bill a personal account.
  const replaced = new Set([...Object.keys(overrides), 'CODEX_HOME'])
  const credential = /(?:_API_KEY|_AUTH_TOKEN|_OAUTH_TOKEN|_ACCESS_TOKEN|^GH_TOKEN|^GITHUB_TOKEN|^COPILOT_GITHUB_TOKEN)$/
  const inherited = Object.fromEntries(Object.entries(environment).filter(([key]) => !replaced.has(key.toUpperCase()) && !credential.test(key.toUpperCase())))
  return { directory, env: { ...inherited, ...overrides }, close }
}

module.exports = { createDemoSession }
