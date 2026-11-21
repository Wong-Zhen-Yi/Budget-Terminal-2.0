import { app, dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const requireUpdateScript = createRequire(import.meta.url)

export async function checkForUpdates(window: BrowserWindow): Promise<void> {
  const show = (type: 'info' | 'error', message: string, detail?: string) =>
    dialog.showMessageBox(window, { type, title: 'Budget Terminal Updates', message, detail })

  if (app.isPackaged) {
    await show('info', 'Updates are available for Git checkouts of Budget Terminal.')
    return
  }

  const root = resolve(app.getAppPath(), '..', '..')
  let scripts: typeof import('../../../../scripts/update.cjs')
  try {
    scripts = requireUpdateScript(resolve(root, 'scripts', 'update.cjs'))
  } catch {
    await show('error', 'The update script could not load.', 'Open Budget Terminal from a Git clone to use the updater.')
    return
  }

  try {
    const updater = scripts.createUpdater(root)
    const update = await updater.check()
    if (window.isDestroyed()) return
    if (update.status === 'current') {
      await show('info', 'Budget Terminal source is up to date.')
      return
    }
    const result = await dialog.showMessageBox(window, {
      type: 'info',
      title: 'Budget Terminal Updates',
      message: 'A Budget Terminal update is available.',
      detail: `Revision ${update.revision.slice(0, 12)} will be applied the next time you launch Budget Terminal.`,
      buttons: ['Install update', 'Later'],
      defaultId: 0,
      cancelId: 1,
    })
    if (result.response !== 0 || window.isDestroyed()) return
    await updater.install(update)
    if (!window.isDestroyed()) await show('info', 'Budget Terminal source updated.', scripts.reopenMessage)
  } catch (error) {
    if (!window.isDestroyed()) await show('error', 'Budget Terminal update failed.', scripts.updateErrorMessage(error))
  }
}
