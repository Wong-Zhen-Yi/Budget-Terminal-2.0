/* This viewer only renders text. Log content never becomes HTML or executable code. */
const element = id => document.getElementById(id)
let entries = []
let paused = false
let busy = false
let fingerprint = ''
let selected = ''
const identity = entry => `${entry.session}:${entry.time}:${entry.event}:${entry.details.id ?? ''}`
function options(id, values) {
  const select = element(id)
  const current = select.value
  const first = select.options[0].cloneNode(true)
  select.replaceChildren(first)
  for (const value of values) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = id === 'session' ? value.slice(0, 8) : value
    select.append(option)
  }
  if (values.includes(current)) select.value = current
}
function render() {
  const query = element('search').value.toLowerCase()
  const matches = entries.filter(entry => (!element('level').value || entry.level === element('level').value) &&
    (!element('area').value || entry.area === element('area').value) &&
    (!element('session').value || entry.session === element('session').value) && JSON.stringify(entry).toLowerCase().includes(query))
  const fragment = document.createDocumentFragment()
  for (const entry of matches.slice(0, 500)) {
    const row = document.createElement('tr')
    row.tabIndex = 0
    row.setAttribute('aria-selected', String(identity(entry) === selected))
    const choose = () => { selected = identity(entry); element('detail').textContent = JSON.stringify(entry, null, 2); render() }
    row.onclick = choose
    row.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose() } }
    for (const [index, value] of [entry.time.replace('T', ' ').replace('Z', ' UTC'), entry.level, entry.area, entry.event,
      Object.entries(entry.details).map(([key, value]) => `${key}=${value}`).join(' · ')].entries()) {
      const cell = document.createElement('td')
      cell.textContent = value
      if (index === 1) cell.className = entry.level
      row.append(cell)
    }
    fragment.append(row)
  }
  element('rows').replaceChildren(fragment)
  element('empty').hidden = matches.length > 0
  element('counts').textContent = `${matches.length} matching / ${entries.length} loaded · ${entries.filter(entry => entry.level === 'error').length} errors · ${entries.filter(entry => entry.level === 'warn').length} warnings${matches.length > 500 ? ' · showing newest 500 matches; narrow filters for older records' : ''}`
}
async function refresh() {
  if (busy) return
  busy = true
  try {
    if (!window.logs?.read) {
      element('read-error').textContent = 'The log reader did not start. Close this viewer and reopen it from Launch Diagnostic Logs.'
      throw Error('Log reader unavailable')
    }
    const result = await window.logs.read()
    if (result.error) throw Error(result.error)
    const next = JSON.stringify(result.entries)
    if (next !== fingerprint) {
      fingerprint = next
      entries = result.entries
      options('area', [...new Set(entries.map(entry => entry.area))].sort())
      options('session', [...new Set(entries.map(entry => entry.session))])
      render()
    }
    if (!entries.length) { element('empty').hidden = false; element('counts').textContent = 'No application logs yet. Start Budget Terminal to begin recording.' }
    element('read-error').hidden = true
    element('read-error').textContent = ''
    element('updated').textContent = `Last read ${new Date().toLocaleTimeString()} · ${result.files} retained files · local logs only · nothing uploaded`
  } catch {
    element('read-error').textContent ||= 'Unable to read logs. Check the log folder and its permissions, then Refresh.'
    element('read-error').hidden = false
    if (!entries.length) { element('counts').textContent = 'Log loading failed'; element('empty').hidden = true }
  }
  finally { busy = false }
}
for (const id of ['search', 'level', 'area', 'session']) element(id).addEventListener('input', render)
element('pause').onclick = () => { paused = !paused; element('pause').textContent = paused ? 'Resume live' : 'Pause live'; element('live').textContent = paused ? 'Live paused' : 'Live · every 2 seconds'; if (!paused) void refresh() }
element('refresh').onclick = refresh
element('export').onclick = async () => {
  element('export').disabled = true
  try { element('notice').textContent = (await window.logs.export()).message }
  catch { element('notice').textContent = 'Export failed.' }
  finally { element('export').disabled = false }
}
element('folder').onclick = async () => {
  try { element('notice').textContent = (await window.logs.folder()).error || 'Opened log folder.' }
  catch { element('notice').textContent = 'Could not open log folder.' }
}
void refresh()
setInterval(() => { if (!paused) void refresh() }, 2000)
