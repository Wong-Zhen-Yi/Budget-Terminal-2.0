import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { authTables } from '@convex-dev/auth/server'

export default defineSchema({
  ...authTables,
  syncSnapshots: defineTable({
    userId: v.id('users'),
    revision: v.number(),
    payload: v.string(),
    updatedAt: v.number(),
  }).index('by_user', ['userId']),
})
