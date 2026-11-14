import { setupConvexAuth } from '@convex-dev/auth/server'
import { components } from './_generated/api'

export const authCore = setupConvexAuth({
  component: components.auth,
  accessTokenTtlSeconds: 300,
  refreshInactivityTimeoutSeconds: 30 * 24 * 60 * 60,
  sessionMaxLifetimeSeconds: 30 * 24 * 60 * 60,
})
