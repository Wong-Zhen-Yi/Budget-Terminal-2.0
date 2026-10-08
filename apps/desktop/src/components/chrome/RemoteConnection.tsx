import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWebAccessStatus } from '@/api/webAccessQueries'
import { WebAccessPanel } from '@/components/settings/WebAccessPanel'

export function RemoteConnection() {
  const { data, error } = useWebAccessStatus(true)
  const [open, setOpen] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const requests = data?.accessRequests?.length ?? 0
  const connected = data?.connectionCount ?? 0
  const failed = !!error || !!data?.error
  const state = failed ? 'Error' : !data ? 'Checking…' : connected ? `Connected (${connected})` : data.running ? 'Ready' : data.enabled ? 'Stopped' : 'Off'

  useEffect(() => {
    if (open) dialog.current?.showModal()
    else dialog.current?.close()
  }, [open])

  return <>
    <div className="no-drag flex shrink-0 items-center gap-2 border-l border-border pl-2 text-2xs" data-remote-connection>
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-text-muted hover:bg-surface-hover" title="Remote connection and remembered browsers">
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${failed ? 'bg-down' : connected ? 'bg-up' : data?.running ? 'bg-accent' : 'bg-slate-600'}`} />
        <span>Remote</span><span role="status" className="text-[10px]">{state}</span>
      </button>
      {requests > 0 ? <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}
        className="rounded border border-accent bg-accent-dim px-2 py-1 text-text" aria-label={`Review ${requests} Remote access request${requests === 1 ? '' : 's'}`}>
        Review access ({requests})
      </button> : null}
    </div>
    {createPortal(<dialog ref={dialog} aria-label="Remote connection" onCancel={() => setOpen(false)} onClose={() => setOpen(false)}
      onClick={(event) => { if (event.target === event.currentTarget) setOpen(false) }}
      className="no-drag fixed inset-0 m-auto max-h-[85vh] w-[560px] max-w-[calc(100vw-32px)] overflow-y-auto rounded border border-border-strong bg-surface p-3 text-text backdrop:bg-black/60">
      <div className="mb-2 flex justify-end"><button type="button" autoFocus onClick={() => setOpen(false)} className="rounded border border-border-strong px-3 py-1 text-2xs hover:bg-surface-hover">Close</button></div>
      <WebAccessPanel />
    </dialog>, document.body)}
  </>
}
