/**
 * The app-wide keyboard shortcuts, in one place.
 *
 * `SETTINGS_SHORTCUT_ROWS` in the PySide6 `mixins/settings.py` documents these and
 * `window_setup.py` wires them; keeping both off one table here means the Settings page
 * cannot describe a binding the app does not actually have. The arrow keys are wired in
 * the reference too — its own table just omits them.
 */
export interface ShortcutRow {
  keys: string
  behavior: string
}

export const SHORTCUTS: ReadonlyArray<ShortcutRow> = [
  {
    keys: 'Ctrl+Tab',
    behavior:
      'Switch to the next visible main tab and wrap through the current navigation order.',
  },
  {
    keys: '← / →',
    behavior:
      'Step to the previous or next visible main tab. Ignored while a text field, table or dropdown has focus.',
  },
  { keys: 'F5', behavior: 'Refresh the page that is currently open in the main workspace.' },
  {
    keys: '`',
    behavior:
      'Open or refocus the page search. If a text input is focused, exit it first and then open search.',
  },
  { keys: 'Ctrl+Shift+H', behavior: 'Obscure or reveal the pages selected in Privacy settings.' },
  {
    keys: 'Esc',
    behavior: 'Close the page search, or exit the active text input without changing pages.',
  },
]

/**
 * Whether the event landed inside something the user is typing into.
 *
 * The bare-key shortcuts (`, arrows) must not fire while a cell is being edited —
 * the reference walks the focus widget's parents looking for the same set of controls.
 */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
