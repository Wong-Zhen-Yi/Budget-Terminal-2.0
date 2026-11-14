import assert from 'node:assert/strict'
import { getFunctionName } from 'convex/server'
import * as authentication from '../convex/auth.js'
import * as adapter from '../convex/githubAdapter.js'
import { cleanup } from '../convex/authMaintenance.js'
import type { OAuthCompletion } from '../electron/shared/cloudOAuth.js'

type Row = { _id: string; [key: string]: unknown }
const tables = new Map<string, Map<string, Row>>()
const table = (name: string) => { if (!tables.has(name)) tables.set(name, new Map()); return tables.get(name)! }
const sessions = new Map<string, { userId: string; creationTime: number; lastRefreshedAt: number }>()
let subject: string | null = 'original-session', mintedUser = 'owner-a', starts = 0, redemptions = 0, serial = 0
const addSession = (id: string, userId: string) => sessions.set(id, { userId, creationTime: Date.now(), lastRefreshedAt: Date.now() })
addSession('original-session', 'owner-a')
const ctx = {
  auth: { getUserIdentity: async () => subject ? { subject } : null },
  db: {
    query(name: string) {
      let filters: ((row: Row) => boolean)[] = []
      const selection = {
        eq(field: string, value: unknown) { filters.push(row => row[field] === value); return selection },
        gt(field: string, value: number) { filters.push(row => Number(row[field]) > value); return selection },
        lte(field: string, value: number) { filters.push(row => Number(row[field]) <= value); return selection },
      }
      const values = () => [...table(name).values()].filter(row => filters.every(filter => filter(row)))
      const query = {
        withIndex(_index: string, select: (q: typeof selection) => unknown) { select(selection); return query },
        async unique() { const rows = values(); assert(rows.length <= 1); return rows[0] ?? null },
        async take(count: number) { return values().slice(0, count) },
      }
      return query
    },
    async insert(name: string, value: Record<string, unknown>) { const id = `${name}-${++serial}`; table(name).set(id, { _id: id, ...value }); return id },
    async patch(id: string, fields: Record<string, unknown>) { for (const rows of tables.values()) { const row = rows.get(id); if (row) Object.assign(row, fields) } },
    async delete(id: string) { for (const rows of tables.values()) rows.delete(id) },
  },
  async runQuery(_ref: unknown, args: { sessionId?: string; userId?: string }) {
    if (args.sessionId) return sessions.get(args.sessionId) ?? null
    return [...sessions].filter(([, value]) => value.userId === args.userId).map(([sessionId, value]) => ({ sessionId, ...value }))
  },
  async runMutation(ref: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) {
    if ('redirectTo' in args) {
      assert.equal(getFunctionName(ref), 'githubAdapter:start')
      starts++
      return { redirect: 'https://github.com/login/oauth/authorize', state: `fixture-state-${starts}` }
    }
    if ('code' in args) {
      assert.equal(getFunctionName(ref), 'githubAdapter:complete')
      redemptions++
      if (args.code !== 'valid-code') return { status: 'error', userError: { error: 'INVALID_CODE' } }
      const sessionId = `issued-${redemptions}`
      addSession(sessionId, mintedUser)
      return { status: 'complete', tokens: { userId: mintedUser, accessToken: `fixture.${Buffer.from(JSON.stringify({ sub: sessionId })).toString('base64url')}.signature`, refreshToken: `refresh-${sessionId}`, refreshTokenExpiresAt: Date.now() + 60_000 } }
    }
    if ('refreshToken' in args) { assert(typeof args.refreshToken === 'string'); sessions.delete(args.refreshToken.slice('refresh-'.length)); return null }
    const ids = args.sessionIds as string[]
    assert(ids.every(id => sessions.get(id)?.userId === 'owner-a'), 'Revocation cannot include another user')
    for (const id of ids) sessions.delete(id)
    return ids
  },
}
const handler = <Args, Result>(fn: unknown) => (fn as { _handler: (context: unknown, args: Args) => Promise<Result> })._handler
const start = handler<{ redirectTo: string; purpose?: 'signIn' | 'revokeOthers' }, { redirect: string; state: string }>(authentication.startSignInWithGithub)
const complete = handler<{ code: string; state: string }, OAuthCompletion>(authentication.completeSignInWithGithub)
const revoke = handler<{ authorization: string }, number>(authentication.revokeOtherSessions)
const redirectTo = `http://127.0.0.1:43871/convex-sync-callback/${'a'.repeat(64)}`
for (const fn of [adapter.start, adapter.complete]) {
  assert.equal((fn as unknown as { isInternal: boolean }).isInternal, true, 'Raw SDK handlers must not be publicly callable')
}
await assert.rejects(start(ctx, { redirectTo: 'https://example.invalid' }))
subject = null
await assert.rejects(start(ctx, { redirectTo, purpose: 'revokeOthers' }))
assert.equal(starts, 0)
subject = 'original-session'
for (let i = 0; i < 30; i++) await start(ctx, { redirectTo })
await assert.rejects(start(ctx, { redirectTo }), error => Boolean(error && typeof error === 'object' && 'data' in error && (error.data as { code: string }).code === 'AUTH_RATE_LIMITED'))
assert.equal(starts, 30, 'Throttled attempts must not allocate SDK authorization requests')
const budget = [...table('oauthLimits').values()][0]
budget.windowStart = Date.now() - 60_001
await start(ctx, { redirectTo })
assert.equal(budget.count, 1, 'The deployment budget resets after its window')
for (let i = table('oauthRequests').size; i < 120; i++) await ctx.db.insert('oauthRequests', { stateHash: `active-${i}`, purpose: 'signIn', expiresAt: Date.now() + 60_000 })
await assert.rejects(start(ctx, { redirectTo }), 'Active OAuth requests must also be capped')
assert.equal(starts, 31)
// Anonymous exhaustion must not prevent authenticated account security actions.
await start(ctx, { redirectTo, purpose: 'revokeOthers' })
await start(ctx, { redirectTo, purpose: 'revokeOthers' })
await assert.rejects(start(ctx, { redirectTo, purpose: 'revokeOthers' }), 'An account has at most two active verification requests')
addSession('quota-other-session', 'quota-other-user')
subject = 'quota-other-session'
await start(ctx, { redirectTo, purpose: 'revokeOthers' })
subject = 'original-session'
for (const row of table('oauthRequests').values()) if (row.userId === 'owner-a') row.expiresAt = Date.now() - 1
await start(ctx, { redirectTo, purpose: 'revokeOthers' })
await assert.rejects(start(ctx, { redirectTo, purpose: 'revokeOthers' }), 'Account budgets survive expired flows')
const accountBudget = [...table('oauthLimits').values()].find(row => row.key === 'revokeOthers:owner-a')!
accountBudget.windowStart = Date.now() - 60_001
await start(ctx, { redirectTo, purpose: 'revokeOthers' })
assert.equal(accountBudget.count, 1)
table('oauthLimits').clear()
sessions.delete('quota-other-session')
table('oauthRequests').clear()
assert.deepEqual(await complete(ctx, { code: 'valid-code', state: 'unknown-state' }), { status: 'error', userError: { error: 'INVALID_CODE' } })
assert.equal(redemptions, 0, 'Unknown states never reach the SDK')
const normal = await start(ctx, { redirectTo })
const ordinary = await complete(ctx, { code: 'valid-code', state: normal.state })
assert(ordinary.status === 'complete' && !ordinary.authorization, 'Ordinary sign-in cannot mint a sensitive-action grant')
assert.equal(table('sessionActionGrants').size, 0)
await assert.rejects(revoke(ctx, { authorization: 'a'.repeat(64) }), 'A recent access token alone is insufficient')
const management = await start(ctx, { redirectTo, purpose: 'revokeOthers' })
subject = 'foreign-session'; addSession('foreign-session', 'owner-b')
const beforeRedemptions = redemptions
assert.equal((await complete(ctx, { code: 'valid-code', state: management.state })).status, 'error')
assert.equal(redemptions, beforeRedemptions, 'A different initiating session cannot redeem the management flow')
subject = 'original-session'
const approved = await complete(ctx, { code: 'valid-code', state: management.state })
assert(approved.status === 'complete' && approved.authorization)
const grant = [...table('sessionActionGrants').values()][0]
const verifiedSession = grant.sessionId as string
assert.notEqual(grant.secretHash, approved.authorization, 'Only the grant hash is stored')
assert(Number(grant.expiresAt) <= Date.now() + 120_000)
await assert.rejects(revoke(ctx, { authorization: approved.authorization }), 'The grant belongs to the newly verified session')
subject = 'foreign-session'
await assert.rejects(revoke(ctx, { authorization: approved.authorization }), 'A different user cannot consume the grant')
subject = verifiedSession
grant.expiresAt = Date.now() - 1
await assert.rejects(revoke(ctx, { authorization: approved.authorization }), 'Expired grants are rejected')
grant.expiresAt = Date.now() + 60_000
addSession('other-session', 'owner-a')
assert.equal(await revoke(ctx, { authorization: approved.authorization }), 3)
assert(sessions.has(verifiedSession) && sessions.has('foreign-session'))
await assert.rejects(revoke(ctx, { authorization: approved.authorization }), 'Consumed grants cannot be replayed')
assert.equal(table('sessionActionGrants').size, 0)
subject = verifiedSession; mintedUser = 'owner-b'
const wrongAccount = await start(ctx, { redirectTo, purpose: 'revokeOthers' })
assert.deepEqual(await complete(ctx, { code: 'valid-code', state: wrongAccount.state }), { status: 'error', userError: { error: 'ACCOUNT_MISMATCH' } })
assert.equal(table('sessionActionGrants').size, 0)
assert(!sessions.has(`issued-${redemptions}`), 'A wrong-account session created by redemption is revoked')
assert(sessions.has(verifiedSession), 'Wrong-account verification must preserve the existing authenticated session')
await ctx.db.insert('sessionActionGrants', { secretHash: 'expired', expiresAt: Date.now() - 1 })
await ctx.db.insert('oauthRequests', { stateHash: 'expired', expiresAt: Date.now() - 1 })
await ctx.db.insert('oauthLimits', { key: 'expired-account', windowStart: Date.now() - 86_400_001, count: 3 })
await ctx.db.insert('syncWriteLimits', { userId: 'expired-account', dayStart: Date.now() - 86_400_001 })
await handler<Record<string, never>, void>(cleanup)(ctx, {})
assert(![...table('oauthRequests').values()].some(row => row.stateHash === 'expired'))
assert.equal(table('sessionActionGrants').size, 0)
assert(![...table('oauthLimits').values()].some(row => row.key === 'expired-account'))
assert.equal(table('syncWriteLimits').size, 0)
console.log('PASS: reserved security OAuth capacity, per-account verification quotas, internal-only SDK adapters, purpose/session/account binding, grant hashing, expiry, single-use revocation and bounded cleanup')
