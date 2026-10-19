const { spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
function privateAgentData(file) {
  const normalized = file.replace(/\\/g, '/').toLowerCase()
  const basename = normalized.split('/').pop()
  return normalized.split('/').includes('budgetterminalelectron')
    || /^agents\.json(?:\..*)?$/.test(basename)
    || /^(?:agent-history|chat-history).*\.json$/.test(basename)
}
function git(args, options = {}) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', ...options })
  if (result.error || result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Git privacy check failed')
  return result.stdout
}
function checkPush(input) {
  for (const line of input.trim().split(/\r?\n/)) {
    const sha = line.split(/\s+/)[1]
    if (!sha || /^0+$/.test(sha)) continue // Deleted refs publish no new history.
    if (!/^[a-f0-9]{40,64}$/i.test(sha)) throw new Error('Invalid push ref in Agents privacy check')
    const objects = git(['rev-list', '--objects', sha]).split(/\r?\n/)
    const blocked = objects.map(object => object.slice(object.indexOf(' ') + 1)).filter(privateAgentData)
    if (blocked.length) throw new Error('Push blocked: private Agents data exists in outgoing Git history, even if later deleted. Remove it from those commits before publishing:\n' + [...new Set(blocked)].join('\n'))
  }
  return 'Agents push privacy checks passed: no private runtime data in outgoing history.'
}
function check({ staged = false } = {}) {
  const files = git(staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'] : ['ls-files', '-z']).split('\0').filter(Boolean)
  const blocked = files.filter(privateAgentData)
  if (blocked.length) throw new Error('Private Agents data must never be committed or published. Remove these files from the Git index (keep local copies):\n' + blocked.join('\n'))
  if (!staged) {
    const examples = ['agents.json', 'copies/agents.json.123.tmp', 'exports/chat-history-local.json', 'AppData/Roaming/BudgetTerminalElectron/agents.json']
    const ignored = git(['check-ignore', '--no-index', '--stdin'], { input: examples.join('\n') + '\n' }).trim().split(/\r?\n/)
    for (const file of examples) if (!ignored.includes(file)) throw new Error('Private Agents data is not ignored: ' + file)
  }
  return 'Agents privacy checks passed: no private runtime data ' + (staged ? 'staged for commit.' : 'tracked; history, inbox, trackers and temporary copies are ignored.')
}
if (require.main === module) {
  try { console.log(process.argv.includes('--push') ? checkPush(require('node:fs').readFileSync(0, 'utf8')) : check({ staged: process.argv.includes('--staged') })) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
module.exports = { privateAgentData, check, checkPush }
