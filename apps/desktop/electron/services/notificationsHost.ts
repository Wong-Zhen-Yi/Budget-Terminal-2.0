import { app, BrowserWindow, Notification, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { NotificationCenter } from './notifications.js'
import type { AppNotification, NotificationCommand } from '../shared/notifications.js'
import { failed, ok } from '../shared/envelope.js'

export const NOTIFICATION_APP_ID = 'BudgetTerminal.Desktop'
const desktopNotifications = new Set<Notification>()
let onClick: (() => void) | null = null

export function configureDesktopNotifications() {
  if (process.platform !== 'win32') return
  app.setAppUserModelId(NOTIFICATION_APP_ID)
  // The double-click launcher runs an unpackaged Electron app. Register its identity
  // in a per-user Start Menu shortcut so Windows can attribute native toasts.
  try {
    const directory = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    mkdirSync(directory, { recursive: true })
    if (!shell.writeShortcutLink(join(directory, 'Budget Terminal.lnk'), 'create', {
      target: process.execPath, args: app.isPackaged ? '' : `"${app.getAppPath()}"`,
      cwd: app.getAppPath(), description: 'Budget Terminal', appUserModelId: NOTIFICATION_APP_ID,
    })) throw new Error('Windows could not register the Start Menu shortcut.')
  } catch (error) { notificationCenter.setupError = String(error) }
}

function deliver(value: AppNotification) {
  if (!Notification.isSupported()) return Promise.reject(new Error('Desktop notifications are unavailable on this system.'))
  return new Promise<void>((resolve, reject) => {
    const notification = new Notification({ title: value.title, body: value.body, silent: false })
    desktopNotifications.add(notification)
    const timer = setTimeout(() => {
      notification.close()
      desktopNotifications.delete(notification)
      reject(new Error('Desktop delivery was not confirmed. Check Windows Settings → System → Notifications and Do not disturb.'))
    }, 5000)
    notification.once('show', () => { clearTimeout(timer); resolve() })
    notification.once('failed', (_event, error) => { clearTimeout(timer); desktopNotifications.delete(notification); reject(new Error(error)) })
    notification.once('close', () => desktopNotifications.delete(notification))
    notification.once('click', () => {
      const window = BrowserWindow.getAllWindows()[0]
      if (window && !window.isDestroyed()) {
        if (window.isMinimized()) window.restore()
        window.show(); window.focus()
        onClick?.()
      }
    })
    notification.show()
  })
}
export const notificationCenter = new NotificationCenter({ deliver, supported: () => Notification.isSupported() })
export function onNotificationClick(listener: (() => void) | null) { onClick = listener }
export async function notificationsStatus() {
  try { await notificationCenter.initialize(); return ok(notificationCenter.snapshot(), 'Notifications') }
  catch (error) { return failed(notificationCenter.snapshot(), String(error), 'Notifications') }
}
export async function notificationsCommand(command: NotificationCommand) {
  try { return ok(await notificationCenter.command(command), 'Notifications') }
  catch (error) { return failed(notificationCenter.snapshot(), String(error), 'Notifications') }
}
export async function closeNotifications() {
  await notificationCenter.close()
  for (const notification of desktopNotifications) notification.close()
  desktopNotifications.clear()
}
