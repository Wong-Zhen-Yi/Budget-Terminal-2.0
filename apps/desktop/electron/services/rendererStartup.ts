import type { BrowserWindow } from 'electron'
import { access } from 'node:fs/promises'
import { setTimeout } from 'node:timers/promises'

/** A concurrent rebuild can briefly remove index.html; keep the window hidden until it loads. */
export async function loadRenderer(
  window: Pick<BrowserWindow, 'loadFile' | 'loadURL' | 'isDestroyed'>,
  file: string,
  devServerUrl?: string,
  { attempts = 20, retryDelayMs = 250 } = {},
): Promise<void> {
  if (devServerUrl) {
    await window.loadURL(devServerUrl)
    return
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (window.isDestroyed()) return
    try {
      await access(file)
      await window.loadFile(file)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ERR_FILE_NOT_FOUND') throw error
      if (attempt === attempts - 1) {
        throw new Error(`Budget Terminal could not find its built interface:\n${file}\n\nClose Budget Terminal and any running dev/build commands, then run Launch Budget Terminal.cmd again (or npm run build from the repository root).`, { cause: error })
      }
      await setTimeout(retryDelayMs)
    }
  }
}
