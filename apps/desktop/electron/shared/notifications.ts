import { z } from 'zod'

export const notificationInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(4000),
  eventKey: z.string().trim().min(1).max(160),
}).strict()
export const notificationSchema = notificationInputSchema.extend({
  id: z.string().min(1).max(100), at: z.number().finite().nonnegative(), read: z.boolean(),
  source: z.enum(['chat', 'autonomy', 'tracker', 'movement', 'market-open', 'test']),
  trackerId: z.string().max(100).optional(), deliveryError: z.string().optional(),
  desktopStatus: z.enum(['pending', 'shown', 'failed']).optional(),
}).strict()
export type AppNotification = z.infer<typeof notificationSchema>
export type NotificationInput = z.infer<typeof notificationInputSchema>
export const notificationStoreSchema = z.object({
  version: z.literal(1), notifications: z.array(notificationSchema).max(500),
  movement: z.object({ enabled: z.boolean(), nextAt: z.number().finite().nonnegative().nullable(), lastAt: z.number().finite().nonnegative().nullable() }).strict(),
  marketOpen: z.object({ enabled: z.boolean(), nextAt: z.number().finite().nonnegative().nullable(), lastAt: z.number().finite().nonnegative().nullable() }).strict().default({ enabled: false, nextAt: null, lastAt: null }),
}).strict()
export type NotificationData = z.infer<typeof notificationStoreSchema>
export interface NotificationsState extends NotificationData {
  supported: boolean
  storageError: string
  setupError: string
}
export const notificationCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('movement'), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('marketOpen'), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('test') }).strict(),
  z.object({ type: z.literal('read'), id: z.string().min(1).max(100).optional() }).strict(),
  z.object({ type: z.literal('dismiss'), id: z.string().min(1).max(100) }).strict(),
])
export type NotificationCommand = z.infer<typeof notificationCommandSchema>

/** A new draw for every reminder, uniformly covering 30 through 45 minutes. */
export function movementDelay(random = Math.random): number {
  return 30 * 60_000 + Math.floor(Math.max(0, Math.min(1, random())) * 15 * 60_000)
}
