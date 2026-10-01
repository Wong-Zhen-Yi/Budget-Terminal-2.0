import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { Panel } from '@/components/ui/Panel'

export function McpPanel() {
  const { data, error } = useQuery({ queryKey: ['mcpStatus'], queryFn: () => api.mcpStatus(), refetchInterval: 5_000 })
  return <Panel title="Local MCP" className="p-3">
    <p className={`mt-1 text-2xs ${data?.available ? 'text-up' : 'text-down'}`}>
      {data?.available ? `Ready · ${data.tools} tools for ChatGPT / Codex` : data?.error ?? error?.message ?? 'Checking connection…'}
    </p>
    <p className="mt-1 text-2xs text-text-muted">Available while Budget Terminal is running. Client setup is documented in the repository README.</p>
  </Panel>
}
