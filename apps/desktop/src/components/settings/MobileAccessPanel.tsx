import { useLayoutEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import {
  DEFAULT_MOBILE_VIEWPORT, MOBILE_DIRECT_SERVE_COMMAND, MOBILE_SERVE_COMMAND, MOBILE_VIEWPORTS,
  isMobileViewportId, type MobileViewportId,
} from '@shared/mobileAccess'
import { api } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'

const key = ['mobileAccess'] as const
const button = 'rounded border border-border-strong bg-surface-raised px-2 py-1 text-text hover:bg-surface-hover disabled:opacity-50'
const linkLabels = {
  directUrl: 'Direct link (works without DNS)',
  url: 'HTTPS link (uses MagicDNS)',
} as const
const linkTypes = ['directUrl', 'url'] as const

function MobileLinkQr({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])

  return <dialog ref={dialog} aria-labelledby="mobile-qr-title" aria-describedby="mobile-qr-hint"
    onCancel={event => { event.preventDefault(); onClose() }}
    onKeyDown={event => event.stopPropagation()}
    className="m-auto max-h-[90vh] w-88 max-w-[90vw] overflow-auto rounded border border-border-strong bg-surface p-4 text-xs text-text backdrop:bg-black/60">
    <header className="flex items-center justify-between gap-2">
      <h3 id="mobile-qr-title" className="font-semibold">Open Budget Terminal on your phone</h3>
      <button className={button} type="button" onClick={onClose}>Close</button>
    </header>
    <p id="mobile-qr-hint" className="mt-2 text-text-muted">Connect Tailscale on your phone, then scan with your camera.</p>
    <QRCodeSVG value={url} size={224} marginSize={4} role="img" aria-label={`QR code for ${label}`} className="mx-auto my-4 block h-auto max-w-full" />
    <p className="text-center">{label}</p>
    <p className="break-all text-center text-text-muted">{url}</p>
  </dialog>
}

export function MobileAccessPanel({ active }: { active: boolean }) {
  const client = useQueryClient()
  const [viewportId, setViewportId] = useState<MobileViewportId>(DEFAULT_MOBILE_VIEWPORT)
  const viewport = MOBILE_VIEWPORTS[viewportId]
  const [copyResult, setCopyResult] = useState<{ text: string; ok: boolean }>()
  const [qrLink, setQrLink] = useState<(typeof linkTypes)[number]>()
  const status = useQuery({ queryKey: key, queryFn: () => api.mobileAccessStatus(), enabled: active })
  const change = useMutation({
    mutationFn: (enabled: boolean) => api.configureMobileAccess(enabled),
    onSuccess: state => client.setQueryData(key, state),
  })
  const launch = useMutation({ mutationFn: () => api.launchMobileWindow(viewportId) })
  const state = status.data
  const setupCommands = [!state?.url && MOBILE_SERVE_COMMAND, !state?.directUrl && MOBILE_DIRECT_SERVE_COMMAND]
    .filter(Boolean).join('\n')
  async function copy(text: string) {
    try {
      await api.writeClipboard(text)
      setCopyResult({ text, ok: true })
    } catch {
      setCopyResult({ text, ok: false })
    }
  }
  const copyLabel = (text: string, label: string) =>
    copyResult?.text === text ? (copyResult.ok ? 'Copied' : 'Copy failed. Retry') : label
  return <Panel title="Mobile Access">
    <div className="space-y-2 p-3 text-2xs">
      {api.platform === 'win32' && state?.available && <>
        <div className="obscure-mode-row">
          <div>
            <h3 className="font-semibold">Mobile viewport on this PC</h3>
            <label className="my-1 flex flex-wrap items-center gap-2">
              Phone size
              <select value={viewportId} disabled={launch.isPending} className={button} onChange={event => {
                if (isMobileViewportId(event.target.value)) setViewportId(event.target.value)
              }}>
                {Object.entries(MOBILE_VIEWPORTS).map(([id, profile]) => <option key={id} value={id}>{profile.label} ({profile.width} × {profile.height})</option>)}
              </select>
            </label>
            <p id="mobile-viewport-hint">{viewport.width} × {viewport.height} at {viewport.deviceScaleFactor}×. Resize the window to try other phone sizes. Uses your desktop workspace without Tailscale.</p>
          </div>
          <Button variant="accent" aria-describedby="mobile-viewport-hint" disabled={launch.isPending} onClick={() => launch.mutate()}>
            {launch.isPending ? 'Opening…' : 'Open phone viewport'}
          </Button>
        </div>
        {launch.isError && <p role="alert" className="text-warn">Could not open the viewport. Run <code>btd mobile</code> to rebuild and reopen it.</p>}
      </>}
      <div className="obscure-mode-row">
        <div>
          <h3 id="lab-mobile-access">Mobile Access on your phone</h3>
          <p id="lab-mobile-access-description">Use Tailscale to open Budget Terminal in your phone or tablet browser. The layout adapts to your screen.</p>
        </div>
        <button type="button" className="obscure-switch" role="switch"
          aria-labelledby="lab-mobile-access" aria-describedby="lab-mobile-access-description"
          aria-checked={state?.enabled ?? false} disabled={!state?.available || change.isPending}
          onClick={() => { setCopyResult(undefined); setQrLink(undefined); change.mutate(!state?.enabled) }}>
          <span className="obscure-switch-track" aria-hidden="true" />
          <span aria-hidden="true">{state?.enabled ? 'On' : 'Off'}</span>
        </button>
      </div>
      <p role="status" className={state?.url || state?.directUrl ? 'text-up' : 'text-text-muted'}>
        {change.isError || status.isError ? 'Could not check Mobile Access.' : state?.message ?? 'Checking Mobile Access…'}
      </p>
      {state?.enabled && <>
        {linkTypes.map(type => {
          const url = state[type]
          const label = linkLabels[type]
          return url && <div key={type} className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1"><p>{label}</p><p className="break-all text-text-muted">{url}</p></div>
            <button className={button} type="button" aria-label={`Copy ${label}`} onClick={() => void copy(url)}>
              <span aria-live="polite">{copyLabel(url, 'Copy')}</span>
            </button>
            <button className={button} type="button" aria-haspopup="dialog" aria-label={`Show QR code for ${label}`} onClick={() => setQrLink(type)}>
              QR code
            </button>
          </div>
        })}
        {active && qrLink && state[qrLink] && <MobileLinkQr url={state[qrLink]} label={linkLabels[qrLink]} onClose={() => setQrLink(undefined)} />}
        <button className={button} type="button" disabled={status.isFetching || change.isPending} onClick={() => void status.refetch()}>Check connection</button>
        <p className="text-text-muted">Send <code>/mobile</code> to your Budget Terminal Telegram bot to get the link on your device.</p>
        {state.canSetUpLinks && setupCommands && <details className="text-text-muted" open={!state.url && !state.directUrl}>
          <summary className="cursor-pointer text-text">Set up Tailscale links</summary>
          <p className="mt-1">{api.platform === 'win32' ? 'Run the setup in an Administrator terminal.' : 'Run the setup in a terminal on this computer.'}</p>
          <code className="block whitespace-pre-wrap break-all text-text">{setupCommands}</code>
          <button className={`${button} mt-1`} type="button" aria-label="Copy Tailscale setup commands" onClick={() => void copy(setupCommands)}>
            <span aria-live="polite">{copyLabel(setupCommands, 'Copy setup commands')}</span>
          </button>
        </details>}
        {state.directUrl && <p className="text-text-muted">Connect Tailscale with the same account on both devices. The direct link uses HTTP inside the encrypted Tailscale tunnel.</p>}
      </>}
    </div>
  </Panel>
}
