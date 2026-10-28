import { createContext, useContext, type ReactNode } from 'react'

/** Scoped to finance pages so other pages retain their existing privacy behavior. */
export const NumberPrivacy = createContext(false)

export function useNumberPrivacy() {
  return useContext(NumberPrivacy)
}

export function PrivateNumber({ children }: { children: ReactNode }) {
  return useNumberPrivacy() ? '****' : children
}
