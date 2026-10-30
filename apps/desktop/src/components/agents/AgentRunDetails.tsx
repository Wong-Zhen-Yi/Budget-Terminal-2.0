import { useEffect, useState } from 'react'
import type { AgentRun } from '@shared/agentRuns'

const toolName = (name: string) => name.replace(/^(budget_terminal_|terminal_)/, '').replace(/_/g, ' ')
const duration = (ms: number) => `${Math.floor(ms / 60_000)}m ${Math.floor(ms / 1000) % 60}s`

export function AgentRunDetails({ run }: { run: AgentRun }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (run.status !== 'running') return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [run.status])
  const active = run.tools.filter(tool => tool.status === 'running')
  const completed = run.tools.filter(tool => ['succeeded', 'partial'].includes(tool.status)).length
  const elapsed = Math.max(0, (run.endedAt ?? now) - run.startedAt)
  const label = run.status === 'running' ? run.wrappingUp ? 'Finishing answer' : active.length ? `Fetching ${toolName(active[0].name)}${active.length > 1 ? ` + ${active.length - 1} more` : ''}` : 'Thinking' : {
    completed: 'Completed', partial: 'Incomplete coverage', failed: 'Failed', stopped: 'Stopped',
  }[run.status]

  return <div className={`agents-run ${run.status}`}>
    <p role="status">{label} · {duration(elapsed)} · {completed}/{run.tools.length} calls completed</p>
    {run.error && <p>{run.error}</p>}
    <details><summary>Run details</summary>
      <p>Started {new Date(run.startedAt).toLocaleString()} · {run.limitMinutes} minute limit · {run.runtimeRetries} runtime {run.runtimeRetries === 1 ? 'retry' : 'retries'}</p>
      {!run.tools.length && <p>No tools ran.</p>}
      <ol>{run.tools.map((tool, index) => <li key={index}>
        <span>{toolName(tool.name)} · {tool.status === 'timedOut' ? 'timed out' : tool.status} · {duration(tool.durationMs ?? Math.max(0, now - tool.startedAt))} · {tool.attempts} {tool.attempts === 1 ? 'attempt' : 'attempts'}</span>
        {tool.error && <span>{tool.error}</span>}
      </li>)}</ol>
      <p>Saved privately with this chat.</p>
    </details>
  </div>
}
