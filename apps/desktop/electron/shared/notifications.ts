import { z } from 'zod'

export const notificationInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(4000),
  eventKey: z.string().trim().min(1).max(160),
}).strict()
export const notificationSchema = notificationInputSchema.extend({
  id: z.string().min(1).max(100), at: z.number().finite().nonnegative(), read: z.boolean(),
  source: z.enum(['chat', 'autonomy', 'tracker', 'market-open', 'test']),
  trackerId: z.string().max(100).optional(), deliveryError: z.string().optional(),
  desktopStatus: z.enum(['pending', 'shown', 'failed']).optional(),
}).strict()
export type AppNotification = z.infer<typeof notificationSchema>
export type NotificationInput = z.infer<typeof notificationInputSchema>
export const notificationStoreSchema = z.object({
  version: z.literal(2), notifications: z.array(notificationSchema).max(500),
  marketOpen: z.object({ enabled: z.boolean(), nextAt: z.number().finite().nonnegative().nullable(), lastAt: z.number().finite().nonnegative().nullable() }).strict().default({ enabled: false, nextAt: null, lastAt: null }),
}).strict()
export type NotificationData = z.infer<typeof notificationStoreSchema>
export interface NotificationsState extends NotificationData {
  supported: boolean
  storageError: string
  setupError: string
}
export const notificationCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('marketOpen'), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('test') }).strict(),
  z.object({ type: z.literal('read'), id: z.string().min(1).max(100).optional() }).strict(),
  z.object({ type: z.literal('dismiss'), id: z.string().min(1).max(100) }).strict(),
])
export type NotificationCommand = z.infer<typeof notificationCommandSchema>


/** Read old stores once, retiring movement settings and movement-only history. */
export function parseNotificationStore(input: unknown): NotificationData {
  const legacy = z.object({
    version: z.literal(1),
    notifications: z.array(z.unknown()).max(500),
    movement: z.unknown().optional(),
    marketOpen: z.unknown().optional(),
  }).strict()
  if (input && typeof input === 'object' && 'version' in input && input.version === 1) {
    const value = legacy.parse(input)
    return notificationStoreSchema.parse({
      version: 2,
      notifications: value.notifications.filter(item => !(item && typeof item === 'object' && 'source' in item && item.source === 'movement')),
      ...(value.marketOpen === undefined ? {} : { marketOpen: value.marketOpen }),
    })
  }
  return notificationStoreSchema.parse(input)
}
