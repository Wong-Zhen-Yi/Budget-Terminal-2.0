const { spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const browserDirectories = new Set([
  'partitions', 'budget-terminal-research', 'user data', 'userdata',
  'browser-profile', 'browser-profiles', 'chromium-profile', 'chromium-profiles',
  'network', 'local storage', 'session storage', 'indexeddb', 'service worker',
  'sessions', 'cache', 'code cache', 'gpucache', 'dawncache',
])
const browserExamples = [
  'copies/Partitions/budget-terminal-research/Cookies', 'copies/budget-terminal-research/Preferences',
  'copies/User Data/Default/Login Data', 'copies/userData/Local State',
  'copies/browser-profile/other.bin', 'copies/chromium-profiles/other.bin',
  'copies/Network/Cookies', 'copies/Cookies', 'copies/Cookies-journal',
  'copies/Login Data', 'copies/Login Data-wal', 'copies/Web Data', 'copies/History',
  'copies/Local State', 'copies/Preferences', 'copies/Secure Preferences',
  'copies/Local Storage/leveldb/token.ldb', 'copies/Session Storage/token.ldb',
  'copies/IndexedDB/token.ldb', 'copies/Service Worker/Database/token.ldb',
  'copies/Sessions/Session_123', 'copies/Cache/private.bin', 'copies/Code Cache/private.bin',
  'copies/GPUCache/private.bin', 'copies/DawnCache/private.bin',
  'exports/cookies-export.json', 'exports/cookies.txt', 'exports/passwords-export.csv',
  'exports/credentials-export.json',
]
function privateBrowserData(file) {
  const parts = file.replace(/\\/g, '/').toLowerCase().split('/')
  const basename = parts.pop()
  return parts.some(part => browserDirectories.has(part))
    || /^(?:cookies|login data|web data|history)(?:-(?:journal|wal|shm))?$/.test(basename)
    || /^(?:local state|preferences|secure preferences)$/.test(basename)
    || /^(?:cookies.*\.(?:json|txt)|passwords.*\.csv|credentials.*\.json)$/.test(basename)
}
function privateAgentData(file) {
  const normalized = file.replace(/\\/g, '/').toLowerCase()
  const basename = normalized.split('/').pop()
  return privateBrowserData(file)
    || normalized.split('/').includes('budgetterminalelectron')
    || normalized.split('/').includes('agent-images')
    || /^agents\.json(?:\..*)?$/.test(basename)
    || /^(?:agent-history|chat-history).*\.json$/.test(basename)
}
function git(args, options = {}) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', ...options })
  if (result.error || result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Git privacy check failed')
  return result.stdout
}
function checkPush(input, { cwd = root } = {}) {
  for (const line of input.trim().split(/\r?\n/)) {
    const sha = line.split(/\s+/)[1]
    if (!sha || /^0+$/.test(sha)) continue // Deleted refs publish no new history.
    if (!/^[a-f0-9]{40,64}$/i.test(sha)) throw new Error('Invalid push ref in Agents privacy check')
    const objects = git(['rev-list', '--objects', sha], { cwd }).split(/\r?\n/)
    const blocked = objects.map(object => object.slice(object.indexOf(' ') + 1)).filter(privateAgentData)
    if (blocked.length) throw new Error('Push blocked: private Agents/browser data exists in outgoing Git history, even if later deleted. Remove it from those commits before publishing:\n' + [...new Set(blocked)].join('\n'))
  }
  return 'Agents/browser push privacy checks passed: no private runtime data in outgoing history.'
}
function check({ staged = false, cwd = root } = {}) {
  const files = git(staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'] : ['ls-files', '-z'], { cwd }).split('\0').filter(Boolean)
  const blocked = files.filter(privateAgentData)
  if (blocked.length) throw new Error('Private Agents/browser data must never be committed or published. Remove these files from the Git index (keep local copies):\n' + blocked.join('\n'))
  if (!staged) {
    const examples = ['agents.json', 'copies/agents.json.123.tmp', 'exports/chat-history-local.json', 'AppData/Roaming/BudgetTerminalElectron/agents.json', 'copies/agent-images/private.json', ...browserExamples]
    const ignored = git(['check-ignore', '--no-index', '--stdin'], { cwd, input: examples.join('\n') + '\n' }).trim().split(/\r?\n/)
    for (const file of examples) if (!ignored.includes(file)) throw new Error('Private Agents/browser data is not ignored: ' + file)
  }
  return 'Agents/browser privacy checks passed: no private runtime data ' + (staged ? 'staged for commit.' : 'tracked; chat history, browser login/session profiles and temporary copies are ignored.')
}
if (require.main === module) {
  try { console.log(process.argv.includes('--push') ? checkPush(require('node:fs').readFileSync(0, 'utf8')) : check({ staged: process.argv.includes('--staged') })) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
module.exports = { privateAgentData, privateBrowserData, browserExamples, check, checkPush }
