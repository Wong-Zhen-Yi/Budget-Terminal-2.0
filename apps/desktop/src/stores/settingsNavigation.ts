import { create } from 'zustand'

export const useSettingsNavigation = create<{ diagnosticsRequest: number; openDiagnostics: () => void }>(set => ({
  diagnosticsRequest: 0,
  openDiagnostics: () => set(state => ({ diagnosticsRequest: state.diagnosticsRequest + 1 })),
}))
