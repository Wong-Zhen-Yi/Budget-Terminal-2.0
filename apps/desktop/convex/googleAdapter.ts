import { setupGoogle } from '@convex-dev/auth/methods/google/server'
import { v } from 'convex/values'
import { components, internal } from './_generated/api'
import { internalMutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { DefaultFunctionArgs, RegisteredMutation } from 'convex/server'
import { completion } from './githubAdapter'
import { authCore } from './authCore'
import { DESKTOP_AUTH_ORIGINS } from '../electron/shared/cloudOAuth'

const google = setupGoogle(authCore, {
  component: components.authGoogle,
  allowedRedirectOrigins: DESKTOP_AUTH_ORIGINS,
}).attachUserCallbacks({ createUser: internal.users.createGoogleUser, onSignIn: internal.users.updateGoogleProfile })


// The SDK supplies registered functions. Adapt their typed handlers into internal
// registrations so clients cannot bypass the public quota and purpose checks.
function sdkHandler<Args extends DefaultFunctionArgs, Result>(fn: RegisteredMutation<'public', Args, Promise<Result>>) {
  const handler = (fn as unknown as { _handler: (ctx: MutationCtx, args: Args) => Promise<Result> })._handler
  if (typeof handler !== 'function') throw new Error('Convex Auth SDK handler adapter is incompatible. Update and verify the adapter before deploying.')
  return handler
}
export const start = internalMutation({
  args: { redirectTo: v.string() },
  returns: v.object({ redirect: v.string(), state: v.string() }),
  handler: sdkHandler(google.startSignInWithGoogle),
})
export const complete = internalMutation({
  args: { code: v.string(), state: v.string() },
  returns: completion,
  handler: sdkHandler(google.completeSignInWithGoogle),
})
export function googleOAuthConfigured(): boolean {
  const id = process.env.AUTH_GOOGLE_CLIENT_ID?.trim()
  const secret = process.env.AUTH_GOOGLE_CLIENT_SECRET?.trim()
  return Boolean(id && secret && id.endsWith('.apps.googleusercontent.com') && id !== secret && !['null', 'undefined'].includes(secret))
}
