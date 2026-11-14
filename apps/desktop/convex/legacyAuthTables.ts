// Archived Convex Auth v1 schema (Apache-2.0) retained for ownership migration and rollback.
import { defineTable } from 'convex/server'
import { v } from 'convex/values'

export const legacyAuthTables = {
  users: defineTable({
    // Active v2 sign-ins retain only the public login needed by account settings.
    githubLogin: v.optional(v.string()),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
  })
    .index('email', ['email'])
    .index('phone', ['phone']),
  authSessions: defineTable({
    userId: v.id('users'),
    expirationTime: v.number(),
  }).index('userId', ['userId']),
  authAccounts: defineTable({
    userId: v.id('users'),
    provider: v.string(),
    providerAccountId: v.string(),
    secret: v.optional(v.string()),
    emailVerified: v.optional(v.string()),
    phoneVerified: v.optional(v.string()),
  })
    .index('userIdAndProvider', ['userId', 'provider'])
    .index('providerAndAccountId', ['provider', 'providerAccountId']),
  authRefreshTokens: defineTable({
    sessionId: v.id('authSessions'),
    expirationTime: v.number(),
    firstUsedTime: v.optional(v.number()),
    parentRefreshTokenId: v.optional(v.id('authRefreshTokens')),
  })
    .index('sessionId', ['sessionId'])
    .index('sessionIdAndParentRefreshTokenId', [
      'sessionId',
      'parentRefreshTokenId',
    ]),
  authVerificationCodes: defineTable({
    accountId: v.id('authAccounts'),
    provider: v.string(),
    code: v.string(),
    expirationTime: v.number(),
    verifier: v.optional(v.string()),
    emailVerified: v.optional(v.string()),
    phoneVerified: v.optional(v.string()),
  })
    .index('accountId', ['accountId'])
    .index('code', ['code']),
  authVerifiers: defineTable({
    sessionId: v.optional(v.id('authSessions')),
    signature: v.optional(v.string()),
  }).index('signature', ['signature']),
  authRateLimits: defineTable({
    identifier: v.string(),
    lastAttemptTime: v.number(),
    attemptsLeft: v.number(),
  }).index('identifier', ['identifier']),
}
