import { useEffect, useId, useState } from 'react'
import { CONTROLLER_SHORTCUTS } from '@/input/controller'
import '@/styles/controller-controls.css'

interface InputState {
  connection: 'disconnected' | 'connected' | 'unsupported' | 'unavailable'
  buttons: number[]
  axes: number[]
}
const emptyInput: InputState = { connection: 'disconnected', buttons: [], axes: [0, 0, 0, 0] }
const keycaps = ['D-pad / L', 'A / ×', 'B / ○', 'LB / RB', 'Menu', 'R']

/** Display the standard mapping only, matching ControllerReader's device policy. */
export function ControllerControls({ active }: { active: boolean }) {
  const [input, setInput] = useState<InputState>(emptyInput)
  const [testing, setTesting] = useState(false)
  const gradient = useId().replace(/:/g, '')
  useEffect(() => {
    if (!active) { setTesting(false); setInput(emptyInput); return }
    let frame = 0
    let signature = ''
    const sample = () => {
      let next = emptyInput
      if (!navigator.getGamepads) next = { ...emptyInput, connection: 'unavailable' }
      else if (!document.hidden && document.hasFocus()) {
        try {
          const pads = Array.from(navigator.getGamepads()).filter((pad): pad is Gamepad => Boolean(pad?.connected))
          const pad = pads.find(pad => pad.mapping === 'standard')
          if (pad) next = {
            connection: 'connected',
            buttons: pad.buttons.flatMap((button, index) => button.pressed ? [index] : []),
            axes: Array.from({ length: 4 }, (_, index) => {
              const value = pad.axes[index]
              return Number.isFinite(value) && Math.abs(value) > 0.35 ? Math.round(value * 20) / 20 : 0
            }),
          }
          else if (pads.length) next = { ...emptyInput, connection: 'unsupported' }
        } catch { next = { ...emptyInput, connection: 'unavailable' } }
      }
      const nextSignature = JSON.stringify(next)
      if (signature !== nextSignature) { signature = nextSignature; setInput(next) }
      frame = requestAnimationFrame(sample)
    }
    frame = requestAnimationFrame(sample)
    return () => cancelAnimationFrame(frame)
  }, [active])
  useEffect(() => {
    if (!testing || !active) return
    const finish = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setTesting(false) }
    }
    window.addEventListener('keydown', finish)
    return () => window.removeEventListener('keydown', finish)
  }, [testing, active])

  const pressed = (index: number) => input.buttons.includes(index)
  const left = Boolean(input.axes[0] || input.axes[1] || pressed(10))
  const right = Boolean(input.axes[2] || input.axes[3] || pressed(11))
  const dpad = [12, 13, 14, 15].some(pressed)
  const lit = (value: boolean) => value ? ' is-pressed' : ''
  const highlights = [left || dpad, pressed(0), pressed(1), pressed(4) || pressed(5), pressed(9), right]
  const status = { connected: 'Controller connected', disconnected: 'Connect a controller', unsupported: 'Standard layout required', unavailable: 'Gamepad access unavailable' }[input.connection]
  return <section className="controller-controls" aria-labelledby="controller-heading" data-controller-test={active && testing ? '' : undefined}>
    <header className="controller-heading">
      <div><h1 id="controller-heading">Controller controls</h1><p>Your terminal. On a controller.</p></div>
      <span className={`controller-connection${input.connection === 'connected' ? ' is-connected' : ''}`} role="status"><i />{status}</span>
    </header>
    <div className="controller-layout">
      <div className="controller-stage">
        <svg className="controller-diagram" viewBox="0 0 920 500" role="img" aria-label="Controller diagram: shoulders switch pages, D-pad and left stick move focus, A activates, B dismisses, Menu opens the page picker, right stick scrolls.">
          <defs>
            <linearGradient id={`${gradient}-body`} x1="0" y1="0" x2="0.7" y2="1"><stop stopColor="var(--color-border-strong)" /><stop offset="0.5" stopColor="var(--color-surface-raised)" /><stop offset="1" stopColor="var(--color-bg)" /></linearGradient>
            <radialGradient id={`${gradient}-stick`}><stop stopColor="var(--color-surface-hover)" /><stop offset="0.8" stopColor="var(--color-surface-raised)" /><stop offset="1" stopColor="var(--color-bg)" /></radialGradient>
          </defs>
          <ellipse cx="460" cy="434" rx="235" ry="19" className="controller-shadow" />
          <path className={`controller-part${lit(pressed(6))}`} d="M285 154 Q280 100 323 103 L360 116 L352 155Z" />
          <path className={`controller-part${lit(pressed(7))}`} d="M565 155 L560 116 L597 103 Q640 100 635 154Z" />
          <path className={`controller-part${lit(pressed(4))}`} d="M271 165 Q269 120 326 124 L368 143 L354 177Z" />
          <path className={`controller-part${lit(pressed(5))}`} d="M566 177 L552 143 L594 124 Q651 120 649 165Z" />
          <path fill={`url(#${gradient}-body)`} className="controller-shell" d="M327 145 Q283 133 262 186 Q233 252 223 362 Q214 441 259 439 Q284 439 326 376 L359 337 Q460 317 561 337 L594 376 Q636 439 661 439 Q706 441 697 362 Q687 252 658 186 Q637 133 593 145 Q460 173 327 145Z" />
          <path className="controller-grip" d="M267 243 Q249 319 249 376 Q246 406 261 409 L331 327Z M653 243 Q671 319 671 376 Q674 406 659 409 L589 327Z" />
          <circle cx="460" cy="199" r="17" className="controller-part" /><path d="M452 199h16m-8-8v16" className="controller-mark" />
          <g className={`controller-stick${lit(left)}`} transform={`translate(${323 + input.axes[0] * 9} ${228 + input.axes[1] * 9})`}><circle r="43" fill={`url(#${gradient}-stick)`} /><circle r="32" /></g>
          <g className={`controller-stick${lit(right)}`} transform={`translate(${535 + input.axes[2] * 9} ${315 + input.axes[3] * 9})`}><circle r="43" fill={`url(#${gradient}-stick)`} /><circle r="32" /></g>
          <g transform="translate(363 320)">
            <path className={`controller-part${lit(pressed(12))}`} d="M-13-36H13V-13L0 0L-13-13Z" />
            <path className={`controller-part${lit(pressed(13))}`} d="M-13 36H13V13L0 0L-13 13Z" />
            <path className={`controller-part${lit(pressed(14))}`} d="M-36-13V13H-13L0 0L-13-13Z" />
            <path className={`controller-part${lit(pressed(15))}`} d="M36-13V13H13L0 0L13-13Z" />
          </g>
          <g className={`controller-small-button${lit(pressed(8))}`}><circle cx="421" cy="249" r="14" /><path d="M415 243h9v9h-9z m5-4h9v9" /></g>
          <g className={`controller-small-button${lit(pressed(9))}`}><circle cx="489" cy="249" r="14" /><path d="M482 244h14m-14 5h14m-14 5h14" /></g>
          {([{ index: 0, x: 606, y: 274, label: 'A', tone: 'up' }, { index: 1, x: 642, y: 238, label: 'B', tone: 'down' }, { index: 2, x: 570, y: 238, label: 'X', tone: 'accent-hover' }, { index: 3, x: 606, y: 202, label: 'Y', tone: 'warn' }]).map(button => <g key={button.index} className={`controller-face${lit(pressed(button.index))}`} style={{ color: `var(--color-${button.tone})` }}><circle cx={button.x} cy={button.y} r="20" /><text x={button.x} y={button.y + 7}>{button.label}</text></g>)}
          <g className="controller-callouts">
            <path d="M191 91H255L290 139M730 91H665L630 139M489 235V100M128 228H279M662 238H733M626 274L672 302H733M578 315L651 373H733" />
            <g transform="translate(44 76)"><text>LB</text><text y="23" className="controller-caption">Previous page</text></g>
            <g transform="translate(737 76)"><text>RB</text><text y="23" className="controller-caption">Next page</text></g>
            <g transform="translate(489 59)" textAnchor="middle"><text>Menu / Options</text><text y="23" className="controller-caption">Page picker</text></g>
            <g transform="translate(35 202)"><text>D-pad / Left stick</text><text y="55" className="controller-caption">Move focus</text></g>
            <g transform="translate(740 229)"><text>B / Circle</text><text y="23" className="controller-caption">Back / dismiss</text></g>
            <g transform="translate(740 297)"><text>A / Cross</text><text y="23" className="controller-caption">Activate</text></g>
            <g transform="translate(740 369)"><text>Right stick</text><text y="23" className="controller-caption">Scroll panel</text></g>
          </g>
        </svg>
        <div className={`controller-tester${testing ? ' is-testing' : ''}`}>
          <div><h2>Try your controller</h2><p>{testing ? 'Navigation paused. B or Esc to finish.' : 'Test inputs to see each button light up.'}</p></div>
          <div className="controller-inputs" aria-label="Live controller inputs">{['LB', 'RB', 'D-pad', 'L', 'R', 'A', 'B', 'Menu'].map((key, index) => <kbd key={key} className={lit([pressed(4), pressed(5), dpad, left, right, pressed(0), pressed(1), pressed(9)][index])}>{key}</kbd>)}</div>
          <button type="button" aria-pressed={testing} onClick={() => setTesting(!testing)}>{testing ? 'Finish test' : 'Test inputs'}</button>
        </div>
      </div>
      <aside className="controller-map" aria-labelledby="controller-map-heading"><h2 id="controller-map-heading">Control map</h2>
        <dl>{CONTROLLER_SHORTCUTS.map((row, index) => <div key={row.keys} className={lit(highlights[index])}><dt><kbd>{keycaps[index]}</kbd><span>{row.keys}</span></dt><dd>{row.label}</dd></div>)}</dl>
        <p className="controller-guidance">Connect a standard gamepad and press a button. On Steam Deck, select a Gamepad layout in Steam Input.</p>
        <p className="controller-guidance">In select fields, use up/down to change and left/right to leave. Text entry uses a keyboard, touch or mouse. Controls work while the terminal has focus.</p>
      </aside>
    </div>
  </section>
}
