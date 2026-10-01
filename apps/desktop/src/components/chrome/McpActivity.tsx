import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'

export function McpActivity() {
  const { data, error } = useQuery({
    queryKey: ['mcpStatus'],
    queryFn: () => api.mcpStatus(),
    refetchInterval: 500,
    staleTime: 0,
    retry: false,
  })
  const available = !error && data?.available === true
  const failed = !!error || data?.available === false
  const active = available && data?.active === true
  const connected = available && data?.connected === true
  const detail = error?.message ?? data?.error

  return (
    <div className="no-drag flex shrink-0 items-center gap-2 border-l border-border pl-2 text-2xs text-text-muted"
      role="status" aria-label={`MCP: ${active ? 'active' : 'idle'}, ${connected ? 'connected' : 'disconnected'}${detail ? `. ${detail}` : ''}`}>
      <span className="text-[10px] font-semibold tracking-wide">MCP</span>
      {([
        ['Active', active, 'bg-blue-400 shadow-[0_0_6px_#60a5fa]', 'Tool request running or completed in the last 1.5 seconds'],
        ['Connected', connected, 'bg-emerald-400 shadow-[0_0_6px_#34d399]', 'Client heartbeat received within 15 seconds'],
      ] as const).map(([label, lit, color, description]) => (
        <span key={label} className="flex items-center gap-1" title={detail ?? `${label}: ${lit ? 'yes' : 'no'}. ${description}.`}>
          <span aria-hidden="true" data-mcp-light={label.toLowerCase()} data-state={failed ? 'error' : lit ? 'on' : 'off'}
            className={`h-2 w-2 rounded-full ${failed ? 'bg-red-400 shadow-[0_0_6px_#f87171]' : lit ? color : 'bg-slate-600'}`} />
          <span className="text-[10px]">{label}</span>
        </span>
      ))}
    </div>
  )
}
