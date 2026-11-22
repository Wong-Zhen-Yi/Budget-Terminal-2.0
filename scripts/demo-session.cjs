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
    CODEX_HOME: join(directory, 'codex'),
  }
  // Drop case variants too: Windows resolves environment names case-insensitively.
  const replaced = new Set([...Object.keys(overrides), 'OPENAI_API_KEY', 'CODEX_API_KEY'])
  const inherited = Object.fromEntries(Object.entries(environment).filter(([key]) => !replaced.has(key.toUpperCase())))
  return { directory, env: { ...inherited, ...overrides }, close }
}

module.exports = { createDemoSession }
