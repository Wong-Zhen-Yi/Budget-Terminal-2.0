import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireDataSession } from '../electron/services/dataSession.js'

const scratch = await mkdtemp(join(tmpdir(), 'budget-session-'))
process.env.APPDATA = scratch
process.env.LOCALAPPDATA = scratch
let release: (() => void) | undefined
let child: ReturnType<typeof spawn> | undefined
try {
  const legacyApp = join(scratch, 'checkout', 'apps', 'desktop')
  const legacyDirectory = join(legacyApp, 'AppData', 'Roaming', 'BudgetTerminalElectron')
  const dataDirectory = join(scratch, 'BudgetTerminalElectron')
  const target = join(dataDirectory, 'portfolio.json')
  await mkdir(legacyDirectory, { recursive: true })
  await mkdir(dataDirectory, { recursive: true })
  const legacy = {
    version: 2, activeId: 'portfolio_1', mainId: 'portfolio_1', order: ['portfolio_1'],
    portfolios: { portfolio_1: {
      id: 'portfolio_1', name: 'Old book', tickers: ['TEST'],
      holdings: { TEST: { ticker: 'TEST', shares: 4, avgPrice: 12, includeInWeight: true } },
      cashBalance: 0, marginDebt: 0, includeCashInWeight: true, options: [],
    } },
  }
  const empty = {
    ...legacy, portfolios: { portfolio_1: { ...legacy.portfolios.portfolio_1, name: 'Portfolio 1', tickers: [], holdings: {} } },
    personalFinance: { cash: [{ id: 'cash_1', desc: 'Keep me', amount: 42 }] },
  }
  await writeFile(join(legacyDirectory, 'portfolio.json'), JSON.stringify(legacy))
  await writeFile(target, JSON.stringify(empty))
  release = acquireDataSession(legacyApp)
  let recovered = JSON.parse(await readFile(target, 'utf8'))
  assert.deepEqual(recovered.portfolios.portfolio_1.tickers, ['TEST'])
  assert.deepEqual(recovered.personalFinance, empty.personalFinance)
  assert.equal(JSON.parse(await readFile(`${target}.before-legacy-recovery`, 'utf8')).portfolios.portfolio_1.tickers.length, 0)
  release()
  release = undefined
  recovered.portfolios.portfolio_1.holdings.TEST.shares = 7
  await writeFile(target, JSON.stringify(recovered))
  await rm(join(dataDirectory, '.legacy-portfolio-checked'))
  release = acquireDataSession(legacyApp)
  assert.equal(JSON.parse(await readFile(target, 'utf8')).portfolios.portfolio_1.holdings.TEST.shares, 7)
  release()
  release = undefined
  const cashOnly = { ...empty, portfolios: {
    portfolio_1: { ...empty.portfolios.portfolio_1, cashBalance: 99 },
  } }
  await writeFile(target, JSON.stringify(cashOnly))
  await rm(join(dataDirectory, '.legacy-portfolio-checked'))
  release = acquireDataSession(legacyApp)
  assert.equal(JSON.parse(await readFile(target, 'utf8')).portfolios.portfolio_1.cashBalance, 99)
  release()
  release = undefined

  release = acquireDataSession()
  assert.throws(acquireDataSession, /already using this data folder/)
  release()
  release()
  release = undefined
  child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import { acquireDataSession } from ${JSON.stringify(new URL('../electron/services/dataSession.ts', import.meta.url).href)}
    const release = acquireDataSession()
    process.once('exit', release)
    console.log('LOCKED')
    setInterval(() => {}, 1000)
  `], { env: { ...process.env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = once(child, 'exit')
  await new Promise<void>((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error(`Lock child timed out: ${output}`)), 10_000)
    child!.stdout!.on('data', (chunk) => {
      output += chunk
      if (output.includes('LOCKED')) { clearTimeout(timer); resolve() }
    })
    child!.stderr!.on('data', (chunk) => { output += chunk })
    child!.once('error', (error) => { clearTimeout(timer); reject(error) })
    child!.once('exit', () => { clearTimeout(timer); reject(new Error(output)) })
  })
  assert.throws(acquireDataSession, /already using this data folder/)
  // Simulate a crash: no application cleanup handler runs.
  child.kill('SIGKILL')
  await exited
  child = undefined
  release = acquireDataSession()
  console.log('PASS: one-time legacy recovery, current data preservation, same-process and cross-process exclusion, immediate recovery after crash')
} catch (error) {
  console.error('Session check failed:', error)
  throw error
} finally {
  if (child) {
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
  }
  release?.()
  await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
