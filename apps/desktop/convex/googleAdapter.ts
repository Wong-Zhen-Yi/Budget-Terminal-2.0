import { setupGoogle } from '@convex-dev/auth/methods/google/server'
import { v } from 'convex/values'
import { components, internal } from './_generated/api'
import { env, internalMutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { DefaultFunctionArgs, RegisteredMutation } from 'convex/server'
import { authCore } from './authCore'
import { DESKTOP_AUTH_ORIGINS } from '../electron/shared/cloudOAuth'

const google = setupGoogle(authCore, {
  component: components.authGoogle,
  allowedRedirectOrigins: DESKTOP_AUTH_ORIGINS,
}).attachUserCallbacks({ createUser: internal.users.createGoogleUser, onSignIn: internal.users.updateGoogleProfile })

export const tokenBundle = v.object({ accessToken: v.string(), refreshToken: v.string(), refreshTokenExpiresAt: v.number(), userId: v.string() })
export const completion = v.union(
  v.object({ status: v.literal('complete'), tokens: tokenBundle, authorization: v.optional(v.string()) }),
  v.object({ status: v.literal('error'), userError: v.object({ error: v.union(v.literal('INVALID_CODE'), v.literal('ACCOUNT_MISMATCH')) }) }),
)

// The SDK supplies registered functions. Adapt their typed handlers into internal
// registrations so clients cannot bypass the public quota and purpose checks in auth.ts.
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

// Google web client IDs end in .apps.googleusercontent.com. Refuse anything else,
// including a secret pasted into the client ID slot, so it is never published in a redirect.
export function googleOAuthConfigured(): boolean {
  const clientId = env.AUTH_GOOGLE_ID?.trim()
  const clientSecret = env.AUTH_GOOGLE_SECRET?.trim()
  return Boolean(clientId && clientSecret && clientId !== clientSecret &&
    ![clientId, clientSecret].some(value => value === 'null' || value === 'undefined') &&
    /^[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(clientId))
}
