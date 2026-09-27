import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { DISCOVERY_DEFAULT_SECONDS, parseDiscoveryInterval } from '@shared/discovery'
import { profileStorage } from './profileStorage'

interface DiscoverySettings {
  intervalSeconds: number
  setIntervalSeconds: (seconds: number) => void
}

export const useDiscoverySettings = create<DiscoverySettings>()(
  persist(
    (set) => ({
      intervalSeconds: DISCOVERY_DEFAULT_SECONDS,
      setIntervalSeconds: (seconds) => {
        const valid = parseDiscoveryInterval(seconds)
        if (valid !== null) set({ intervalSeconds: valid })
      },
    }),
    {
      name: 'stock-discovery-settings',
      version: 1,
      storage: profileStorage,
      partialize: (state) => ({ intervalSeconds: state.intervalSeconds }),
      merge: (persisted, current) => ({
        ...current,
        intervalSeconds: parseDiscoveryInterval((persisted as Partial<DiscoverySettings> | null)?.intervalSeconds)
          ?? DISCOVERY_DEFAULT_SECONDS,
      }),
    },
  ),
)
