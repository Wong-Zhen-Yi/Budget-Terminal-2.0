import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { legacyAuthTables } from './legacyAuthTables'

export default defineSchema({
  oauthLimits: defineTable({ key: v.string(), windowStart: v.number(), count: v.number() })
    .index('by_key', ['key']).index('by_window', ['windowStart']),
  oauthRequests: defineTable({ stateHash: v.string(), purpose: v.union(v.literal('signIn'), v.literal('revokeOthers')),
    expiresAt: v.number(), userId: v.optional(v.id('users')), sessionId: v.optional(v.string()) })
    .index('by_state', ['stateHash']).index('by_expiry', ['expiresAt'])
    .index('by_purpose_expiry', ['purpose', 'expiresAt'])
    .index('by_user_purpose_expiry', ['userId', 'purpose', 'expiresAt']),
  sessionActionGrants: defineTable({ secretHash: v.string(), sessionId: v.string(), userId: v.id('users'),
    purpose: v.literal('revokeOtherSessions'), expiresAt: v.number() }).index('by_secret', ['secretHash']).index('by_expiry', ['expiresAt']),
  ...legacyAuthTables,
  // Retain record-era tables and indexes as an archive when restoring snapshot sync.
  // The active sync API only reads/writes syncSnapshots; do not discard archived data.
  authVerifiers: defineTable({ sessionId: v.optional(v.id('authSessions')), signature: v.optional(v.string()) })
    .index('signature', ['signature']).index('by_session', ['sessionId']),
  authRateLimits: defineTable({ identifier: v.string(), lastAttemptTime: v.number(), attemptsLeft: v.number() })
    .index('identifier', ['identifier']).index('by_attempt', ['lastAttemptTime']),
  syncAccounts: defineTable({
    userId: v.id('users'), epoch: v.string(), seq: v.number(), updatedAt: v.number(),
    migrated: v.boolean(), migrationOffset: v.number(), deleted: v.boolean(),
    recordCount: v.number(), bytes: v.number(), windowStart: v.number(), writes: v.number(),
    dayStart: v.number(), dailyBytes: v.number(), historyBytes: v.number(),
    domainCounts: v.record(v.string(), v.number()),
  }).index('by_user', ['userId']),
  syncRecords: defineTable({
    userId: v.id('users'), key: v.string(), kind: v.string(), data: v.union(v.string(), v.null()),
    revision: v.number(), seq: v.number(), updatedAt: v.number(),
  }).index('by_user_key', ['userId', 'key']).index('by_user_seq', ['userId', 'seq']),
  syncHistory: defineTable({
    userId: v.id('users'), key: v.string(), kind: v.string(), data: v.union(v.string(), v.null()),
    revision: v.number(), seq: v.number(), updatedAt: v.number(), expiresAt: v.number(),
  }).index('by_user', ['userId']).index('by_expiry', ['expiresAt']),
  syncAuthLimits: defineTable({ key: v.string(), start: v.number(), count: v.number() }).index('by_key', ['key']).index('by_start', ['start']),
  syncWriteLimits: defineTable({ userId: v.id('users'), windowStart: v.number(), writes: v.number(),
    dayStart: v.number(), dailyBytes: v.number() }).index('by_user', ['userId']).index('by_day', ['dayStart']),
  syncSnapshots: defineTable({
    userId: v.id('users'),
    revision: v.number(),
    payload: v.string(),
    updatedAt: v.number(),
  }).index('by_user', ['userId']),
})
