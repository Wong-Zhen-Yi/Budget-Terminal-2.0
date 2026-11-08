export type ControllerAction = 'up' | 'down' | 'left' | 'right' | 'activate' | 'back' | 'previousPage' | 'nextPage' | 'picker'

export const CONTROLLER_SHORTCUTS = [
  { keys: 'D-pad / left stick', label: 'Move focus' },
  { keys: 'A / Cross', label: 'Activate focused control' },
  { keys: 'B / Circle', label: 'Dismiss / leave text field' },
  { keys: 'LB / RB · L1 / R1', label: 'Previous / next page' },
  { keys: 'Menu / Options', label: 'Open / close page picker' },
  { keys: 'Right stick', label: 'Scroll focused panel' },
] as const

const deadZone = 0.35
const directionThreshold = 0.55
const repeatDelay = 350
const repeatInterval = 130

/** Standard Gamepad mapping only: unknown device layouts must not trigger app actions. */
export class ControllerReader {
  private index: number | null = null
  private previous = new Set<ControllerAction>()
  private repeatAt = new Map<ControllerAction, number>()

  reset() {
    this.index = null
    this.previous.clear()
    this.repeatAt.clear()
  }

  read(pad: Gamepad | undefined, now: number): { actions: ControllerAction[]; scroll: [number, number] } {
    if (!pad || !pad.connected || pad.mapping !== 'standard') {
      this.reset()
      return { actions: [], scroll: [0, 0] }
    }
    const pressed = (index: number) => pad.buttons[index]?.pressed ?? false
    const axis = (index: number) => Number.isFinite(pad.axes[index]) ? pad.axes[index] : 0
    const x = axis(0), y = axis(1)
    const held = new Set<ControllerAction>()
    if (pressed(12) || (y < -directionThreshold && Math.abs(y) >= Math.abs(x))) held.add('up')
    if (pressed(13) || (y > directionThreshold && Math.abs(y) >= Math.abs(x))) held.add('down')
    if (pressed(14) || (x < -directionThreshold && Math.abs(x) > Math.abs(y))) held.add('left')
    if (pressed(15) || (x > directionThreshold && Math.abs(x) > Math.abs(y))) held.add('right')
    const buttons = { activate: 0, back: 1, previousPage: 4, nextPage: 5, picker: 9 } as const
    for (const [action, index] of Object.entries(buttons)) if (pressed(index)) held.add(action as ControllerAction)
    // Baseline held buttons on connection/refocus. A held confirm must never click on return.
    if (this.index !== pad.index) {
      this.index = pad.index
      this.previous = held
      for (const action of held) this.repeatAt.set(action, Infinity)
      return { actions: [], scroll: [0, 0] }
    }
    const actions: ControllerAction[] = []
    for (const action of held) {
      const repeatable = ['up', 'down', 'left', 'right'].includes(action)
      if (!this.previous.has(action)) {
        actions.push(action)
        this.repeatAt.set(action, now + repeatDelay)
      } else if (repeatable && now >= (this.repeatAt.get(action) ?? Infinity)) {
        actions.push(action)
        this.repeatAt.set(action, now + repeatInterval)
      }
    }
    this.previous = held
    const scrollAxis = (value: number) => Math.abs(value) <= deadZone ? 0 : Math.sign(value) * (Math.min(1, Math.abs(value)) - deadZone) / (1 - deadZone)
    return { actions, scroll: [scrollAxis(axis(2)), scrollAxis(axis(3))] }
  }
}
