const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { check, checkPush, privateAgentData, privateBrowserData, browserExamples } = require('./check-private-agent-data.cjs')

console.log(check())
for (const name of ['agents.json', 'copies/AGENTS.JSON.123.tmp', 'exports/chat-history-private.json', 'any/BudgetTerminalElectron/other.json', 'copies/agent-images/private.json', 'copies/AGENT-IMAGES/photo.png']) assert(privateAgentData(name), name)
for (const name of [...browserExamples, 'copies\\\\NETWORK\\\\COOKIES', 'copies/USERDATA/token.bin']) {
  assert(privateBrowserData(name), name)
  assert(privateAgentData(name), name)
}
for (const name of ['docs/agents.md', 'docs/browser.md', 'docs/history.md', 'apps/desktop/electron/services/agents.ts', 'apps/desktop/electron/shared/agentWorkspace.ts', 'apps/desktop/electron/services/browser.ts', 'src/History.ts', 'src/cookies.ts']) assert(!privateAgentData(name), name)
const root = path.resolve(__dirname, '..')
const directory = mkdtempSync(path.join(tmpdir(), 'budget-agent-privacy-'))
try {
  // A scratch index tests force-staging protection without touching real files or the user's index.
  const env = { ...process.env, GIT_INDEX_FILE: path.join(directory, 'index') }
  const git = args => {
    const result = spawnSync('git', args, { cwd: root, env, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  const head = git(['rev-parse', 'HEAD'])
  console.log(checkPush(`refs/heads/privacy-probe ${head} refs/heads/privacy-probe ${'0'.repeat(40)}\n`))
  git(['read-tree', '--empty'])
  const blob = git(['rev-parse', 'HEAD:.gitignore'])
  git(['update-index', '--add', '--cacheinfo', `100644,${blob},agents.json`])
  const rejected = spawnSync(process.execPath, [path.join(__dirname, 'check-private-agent-data.cjs'), '--staged'], { cwd: root, env, encoding: 'utf8' })
  assert.equal(rejected.status, 1)
  assert.match(rejected.stderr, /must never be committed or published/)
  assert.match(rejected.stderr, /agents\.json/)
  git(['update-index', '--force-remove', 'agents.json'])
  const accepted = spawnSync(process.execPath, [path.join(__dirname, 'check-private-agent-data.cjs'), '--staged'], { cwd: root, env, encoding: 'utf8' })
  assert.equal(accepted.status, 0, accepted.stderr)
  for (const name of browserExamples) {
    git(['update-index', '--add', '--cacheinfo', `100644,${blob},${name}`])
    const browserRejected = spawnSync(process.execPath, [path.join(__dirname, 'check-private-agent-data.cjs'), '--staged'], { cwd: root, env, encoding: 'utf8' })
    assert.equal(browserRejected.status, 1, name)
    assert.match(browserRejected.stderr, /must never be committed or published/)
    git(['update-index', '--force-remove', name])
  }
  console.log('PASS: force-staged Agents/browser login data is rejected; source files are allowed; the real Git index is unchanged.')

  // Outgoing-history regression uses a disposable repository and synthetic bytes only.
  const repository = path.join(directory, 'history-fixture')
  mkdirSync(repository)
  const fixtureEnv = { ...process.env, GIT_INDEX_FILE: path.join(repository, '.git', 'index'),
    GIT_AUTHOR_NAME: 'Privacy probe', GIT_AUTHOR_EMAIL: 'probe@example.invalid',
    GIT_COMMITTER_NAME: 'Privacy probe', GIT_COMMITTER_EMAIL: 'probe@example.invalid' }
  const fixtureGit = args => {
    const result = spawnSync('git', args, { cwd: repository, env: fixtureEnv, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  const commit = message => fixtureGit(['-c', 'core.hooksPath=', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', message])
  const pushInput = () => `refs/heads/privacy-probe ${fixtureGit(['rev-parse', 'HEAD'])} refs/heads/privacy-probe ${'0'.repeat(40)}\\n`
  fixtureGit(['init', '--quiet'])
  writeFileSync(path.join(repository, 'fixture.ts'), '// Synthetic source fixture only\\n')
  fixtureGit(['add', 'fixture.ts'])
  commit('Create public source fixture')
  assert.match(checkPush(pushInput(), { cwd: repository }), /passed/)
  mkdirSync(path.join(repository, 'Network'))
  writeFileSync(path.join(repository, 'Network', 'Cookies'), 'synthetic test bytes, not a real login')
  fixtureGit(['add', '-f', 'Network/Cookies'])
  assert.throws(() => check({ staged: true, cwd: repository }), /must never be committed or published/)
  commit('Create synthetic private-path fixture')
  rmSync(path.join(repository, 'Network'), { recursive: true })
  fixtureGit(['add', '-u'])
  commit('Remove fixture from current tree')
  assert.match(check({ staged: true, cwd: repository }), /passed/)
  assert.throws(() => checkPush(pushInput(), { cwd: repository }), /private Agents\/browser data exists in outgoing Git history/)
  console.log('PASS: push checks reject browser credentials in earlier commits even after deletion from the current tree.')
} finally { rmSync(directory, { recursive: true, force: true }) }
