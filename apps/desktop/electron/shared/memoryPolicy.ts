import { MIB } from './cachePolicy.js'

export const SERVICE_MEMORY_BUDGET = { bytes: 128 * MIB, entries: 5_000 }
export const QUERY_MEMORY_BUDGET = { bytes: 64 * MIB, entries: 1_000 }
export const MEMORY_SAMPLE_MS = 15_000

interface SystemMemorySample {
  total: number
  free: number
  available?: number
  fileBacked?: number
  purgeable?: number
}

/** Scale reusable cache space using Electron's KiB samples. */
export function createMemoryScaleReader(read: () => SystemMemorySample, platform: string, clock = () => performance.now()) {
  let scale = 1
  let pressured = false
  let nextSample = -Infinity
  return () => {
    const now = clock()
    if (now < nextSample) return scale
    nextSample = now + MEMORY_SAMPLE_MS
    try {
      const memory = read()
      const totalMiB = memory.total / 1024
      if (!Number.isFinite(totalMiB) || totalMiB <= 0) return scale
      const base = totalMiB <= 4096 ? 0.25 : totalMiB <= 8192 ? 0.5 : 1
      // Linux free excludes reclaimable buffers. macOS reclaimable categories
      // can overlap, so use the larger category without adding both.
      const available = platform === 'linux' ? memory.available : platform === 'darwin'
        ? memory.free + Math.max(memory.fileBacked ?? 0, memory.purgeable ?? 0)
        : memory.free
      if (available !== undefined && Number.isFinite(available) && available >= 0) {
        const reserveMiB = Math.min(1536, Math.max(512, totalMiB * 0.08))
        pressured = available / 1024 < reserveMiB * (pressured ? 1.5 : 1)
      }
      scale = base * (pressured ? 0.5 : 1)
    } catch { /* Keep the last budget if sampling is temporarily unavailable. */ }
    return scale
  }
}
