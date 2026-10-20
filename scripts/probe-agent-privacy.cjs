const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { check, checkPush, privateAgentData } = require('./check-private-agent-data.cjs')

console.log(check())
for (const name of ['agents.json', 'copies/AGENTS.JSON.123.tmp', 'exports/chat-history-private.json', 'any/BudgetTerminalElectron/other.json', 'copies/agent-images/private.json', 'copies/AGENT-IMAGES/photo.png']) assert(privateAgentData(name), name)
for (const name of ['docs/agents.md', 'apps/desktop/electron/services/agents.ts', 'apps/desktop/electron/shared/agentWorkspace.ts']) assert(!privateAgentData(name), name)
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
  console.log('PASS: force-staged private Agents data is rejected; source files are allowed; the real Git index is unchanged.')
} finally { rmSync(directory, { recursive: true, force: true }) }
