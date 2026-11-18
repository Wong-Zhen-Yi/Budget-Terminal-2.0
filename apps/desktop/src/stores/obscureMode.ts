import { create } from 'zustand'

export const useObscureMode = create<{ enabled: boolean; toggle: () => void }>((set) => ({
  enabled: true,
  toggle: () => set(({ enabled }) => ({ enabled: !enabled })),
}))
