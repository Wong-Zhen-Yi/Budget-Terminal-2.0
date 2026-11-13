import { setupConvexAuth } from '@convex-dev/auth/server'
import { setupGithub } from '@convex-dev/auth/methods/github/server'
import { components, internal } from './_generated/api'
import { DESKTOP_AUTH_ORIGINS } from '../electron/shared/cloudOAuth'

const auth = setupConvexAuth({ component: components.auth, accessTokenTtlSeconds: 300 })
export const { signOut, refreshSession, isAuthenticated } = auth
export const { startSignInWithGithub, completeSignInWithGithub } = setupGithub(auth, {
  component: components.authGithub,
  allowedRedirectOrigins: DESKTOP_AUTH_ORIGINS,
}).attachUserCallbacks({ createUser: internal.users.createGithubUser })
