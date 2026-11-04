import { stat } from 'node:fs/promises'
import type { AppMetrics, AutomaticBackupStatus, Envelope } from '../shared/contract.js'
import { err, partial } from '../shared/envelope.js'

interface ProcessSample { type: string; memory: { workingSetSize: number } }

/** Numeric diagnostics only: never return process commands, backup paths or file contents. */
export function createAppMetricsReader(dependencies: {
  processes: () => ProcessSample[]
  backup: () => AutomaticBackupStatus | undefined
  stat?: (path: string) => Promise<{ size: number; mtimeMs: number }>
  now?: () => number
}) {
  const memory: AppMetrics['memory'] = []
  return async (): Promise<Envelope<AppMetrics>> => {
    const errors = []
    try {
      const processes = dependencies.processes()
      if (!processes.length || processes.some(item => !Number.isFinite(item.memory.workingSetSize) || item.memory.workingSetSize < 0)) throw Error('Invalid memory sample')
      const sample = { at: (dependencies.now ?? Date.now)(), mainMiB: 0, rendererMiB: 0, otherMiB: 0 }
      for (const process of processes) {
        const key = process.type === 'Browser' ? 'mainMiB' : process.type === 'Tab' ? 'rendererMiB' : 'otherMiB'
        // Electron reports working-set memory in KiB.
        sample[key] += process.memory.workingSetSize / 1024
      }
      memory.push(sample)
      if (memory.length > 120) memory.shift()
    } catch { errors.push(err('App metrics', 'Memory sample unavailable. Showing previous samples.', 'memory')) }
    let backup: AppMetrics['backup'] = { state: 'not-created' }
    const status = dependencies.backup()
    if (status?.path) {
      try {
        const file = await (dependencies.stat ?? stat)(status.path)
        backup = { state: 'available', bytes: file.size, savedAt: file.mtimeMs }
        if (status.error) errors.push(err('App metrics', 'The latest automatic backup update failed.', 'backup'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
          backup = { state: 'unavailable' }
          errors.push(err('App metrics', 'Automatic backup size unavailable.', 'backup'))
        }
      }
    }
    return partial({ memory: memory.map(sample => ({ ...sample })), backup }, errors, 'Local app metrics', errors.length ? errors.map(error => error.reason).join(' ') : '')
  }
}
