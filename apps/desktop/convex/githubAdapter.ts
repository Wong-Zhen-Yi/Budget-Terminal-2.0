import { setupGithub } from '@convex-dev/auth/methods/github/server'
import { v } from 'convex/values'
import { components, internal } from './_generated/api'
import { internalMutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { DefaultFunctionArgs, RegisteredMutation } from 'convex/server'
import { authCore } from './authCore'
import { DESKTOP_AUTH_ORIGINS } from '../electron/shared/cloudOAuth'

const github = setupGithub(authCore, {
  component: components.authGithub,
  allowedRedirectOrigins: DESKTOP_AUTH_ORIGINS,
}).attachUserCallbacks({ createUser: internal.users.createGithubUser, onSignIn: internal.users.updateGithubProfile })

export const tokenBundle = v.object({ accessToken: v.string(), refreshToken: v.string(), refreshTokenExpiresAt: v.number(), userId: v.string() })
export const completion = v.union(
  v.object({ status: v.literal('complete'), tokens: tokenBundle, authorization: v.optional(v.string()) }),
  v.object({ status: v.literal('error'), userError: v.object({ error: v.union(v.literal('INVALID_CODE'), v.literal('ACCOUNT_MISMATCH')) }) }),
)

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
  handler: sdkHandler(github.startSignInWithGithub),
})
export const complete = internalMutation({
  args: { code: v.string(), state: v.string() },
  returns: completion,
  handler: sdkHandler(github.completeSignInWithGithub),
})
