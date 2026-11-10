import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { authTables } from '@convex-dev/auth/server'

export default defineSchema({
  ...authTables,
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
  syncSnapshots: defineTable({
    userId: v.id('users'),
    revision: v.number(),
    payload: v.string(),
    updatedAt: v.number(),
  }).index('by_user', ['userId']),
})
