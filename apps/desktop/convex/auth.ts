import { getAuthUserId } from '@convex-dev/auth/server'
import { ConvexError, v } from 'convex/values'
import { components, internal } from './_generated/api'
import { mutation } from './_generated/server'
import { authCore } from './authCore'
import { completion } from './githubAdapter'
import { DESKTOP_AUTH_ORIGINS, desktopOAuthRedirect, type OAuthCompletion } from '../electron/shared/cloudOAuth'

export const { signOut, refreshSession, isAuthenticated } = authCore

const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
  .map(byte => byte.toString(16).padStart(2, '0')).join('')
const randomSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(32))).map(byte => byte.toString(16).padStart(2, '0')).join('')
const invalidCode = { status: 'error' as const, userError: { error: 'INVALID_CODE' as const } }

/** Trusted deployment-wide budgets; caller-supplied IDs cannot create fresh buckets. */
export const startSignInWithGithub = mutation({
  args: { redirectTo: v.string(), purpose: v.optional(v.union(v.literal('signIn'), v.literal('revokeOthers'))) },
  returns: v.object({ redirect: v.string(), state: v.string() }),
  handler: async (ctx, args): Promise<{ redirect: string; state: string }> => {
    const redirectTo = desktopOAuthRedirect(args.redirectTo)
    if (!DESKTOP_AUTH_ORIGINS.includes(new URL(redirectTo).origin)) throw new Error('Invalid desktop return origin.')
    const purpose = args.purpose ?? 'signIn'
    const userId = purpose === 'revokeOthers' ? await getAuthUserId(ctx) : null
    const identity = purpose === 'revokeOthers' ? await ctx.auth.getUserIdentity() : null
    if (purpose === 'revokeOthers' && (!userId || !identity)) throw new Error('Sign in first.')
    const now = Date.now()
    // Anonymous traffic cannot consume the capacity reserved for authenticated security actions.
    const key = purpose === 'signIn' ? 'start' : 'start:revokeOthers'
    const budget = await ctx.db.query('oauthLimits').withIndex('by_key', q => q.eq('key', key)).unique()
    const count = budget && now - budget.windowStart < 60_000 ? budget.count : 0
    const activeLimit = purpose === 'signIn' ? 120 : 40
    const active = await ctx.db.query('oauthRequests').withIndex('by_purpose_expiry', q => q.eq('purpose', purpose).gt('expiresAt', now)).take(activeLimit)
    if (count >= 30 || active.length >= activeLimit) throw new ConvexError({ code: 'AUTH_RATE_LIMITED', message: 'Too many sign-in requests. Try again shortly.' })
    if (userId) {
      const accountKey = `revokeOthers:${userId}`
      const accountBudget = await ctx.db.query('oauthLimits').withIndex('by_key', q => q.eq('key', accountKey)).unique()
      const accountCount = accountBudget && now - accountBudget.windowStart < 60_000 ? accountBudget.count : 0
      const accountActive = await ctx.db.query('oauthRequests').withIndex('by_user_purpose_expiry',
        q => q.eq('userId', userId).eq('purpose', 'revokeOthers').gt('expiresAt', now)).take(2)
      if (accountCount >= 3 || accountActive.length >= 2) throw new ConvexError({ code: 'AUTH_RATE_LIMITED', message: 'Too many account verification requests. Try again shortly.' })
      if (accountBudget) await ctx.db.patch(accountBudget._id, { windowStart: accountCount ? accountBudget.windowStart : now, count: accountCount + 1 })
      else await ctx.db.insert('oauthLimits', { key: accountKey, windowStart: now, count: 1 })
    }
    if (budget) await ctx.db.patch(budget._id, { windowStart: count ? budget.windowStart : now, count: count + 1 })
    else await ctx.db.insert('oauthLimits', { key, windowStart: now, count: 1 })
    for (const expired of await ctx.db.query('oauthRequests').withIndex('by_expiry', q => q.lte('expiresAt', now)).take(25)) await ctx.db.delete(expired._id)
    const started = await ctx.runMutation(internal.githubAdapter.start, { redirectTo })
    await ctx.db.insert('oauthRequests', { stateHash: await hash(started.state), purpose, expiresAt: now + 5 * 60_000,
      userId: userId ?? undefined, sessionId: identity?.subject })
    return started
  },
})

/** Only redemption of a purpose-bound one-time OAuth code may issue an action grant. */
export const completeSignInWithGithub = mutation({
  args: { code: v.string(), state: v.string() },
  returns: completion,
  handler: async (ctx, args): Promise<OAuthCompletion> => {
    if (args.code.length > 2048 || args.state.length > 2048) return invalidCode
    const stateHash = await hash(args.state)
    const request = await ctx.db.query('oauthRequests').withIndex('by_state', q => q.eq('stateHash', stateHash)).unique()
    if (!request || request.expiresAt <= Date.now()) return invalidCode
    if (request.purpose === 'revokeOthers') {
      const userId = await getAuthUserId(ctx)
      const identity = await ctx.auth.getUserIdentity()
      if (!userId || userId !== request.userId || identity?.subject !== request.sessionId) return invalidCode
    }
    const result = await ctx.runMutation(internal.githubAdapter.complete, args)
    if (result.status !== 'complete') return result
    await ctx.db.delete(request._id)
    if (request.purpose !== 'revokeOthers') return result
    if (result.tokens.userId !== request.userId) {
      await ctx.runMutation(components.auth.public.signOut, { refreshToken: result.tokens.refreshToken })
      return { status: 'error', userError: { error: 'ACCOUNT_MISMATCH' } }
    }
    // These tokens come directly from the auth component, not from a client claim.
    const encoded = result.tokens.accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const sessionId = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))).sub as string
    const session = await ctx.runQuery(components.auth.public.getSession, { sessionId })
    if (session?.userId !== request.userId) throw new Error('Reauthentication identity mismatch.')
    const authorization = randomSecret()
    await ctx.db.insert('sessionActionGrants', { secretHash: await hash(authorization), sessionId, userId: request.userId!,
      purpose: 'revokeOtherSessions', expiresAt: Date.now() + 2 * 60_000 })
    return { ...result, authorization }
  },
})

export const revokeOtherSessions = mutation({
  args: { authorization: v.string() },
  returns: v.number(),
  handler: async (ctx, { authorization }): Promise<number> => {
    const userId = await getAuthUserId(ctx)
    const identity = await ctx.auth.getUserIdentity()
    if (!userId || !identity || !/^[a-f0-9]{64}$/.test(authorization)) throw new Error('Verify with GitHub first.')
    const secretHash = await hash(authorization)
    const grant = await ctx.db.query('sessionActionGrants').withIndex('by_secret', q => q.eq('secretHash', secretHash)).unique()
    if (!grant || grant.expiresAt <= Date.now() || grant.purpose !== 'revokeOtherSessions' || grant.userId !== userId || grant.sessionId !== identity.subject) throw new Error('GitHub verification expired or was already used.')
    const sessions = await ctx.runQuery(components.auth.public.listSessions, { userId })
    await ctx.db.delete(grant._id)
    const revoked = await ctx.runMutation(components.auth.public.revokeSessions, {
      sessionIds: sessions.filter(session => session.sessionId !== identity.subject).map(session => session.sessionId),
    })
    return revoked.length
  },
})
