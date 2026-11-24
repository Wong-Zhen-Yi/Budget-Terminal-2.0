export const MOBILE_HTTP_PORT = 4387
export const MOBILE_HTTPS_PORT = 8443
export const MOBILE_DIRECT_LOCAL_PORT = 4388
export const MOBILE_DIRECT_PORT = 8081
export const MOBILE_PROXY_TARGET = `http://127.0.0.1:${MOBILE_HTTP_PORT}`
export const MOBILE_SERVE_COMMAND = `tailscale serve --bg --https=${MOBILE_HTTPS_PORT} ${MOBILE_PROXY_TARGET}`
export const MOBILE_DIRECT_TARGET = `127.0.0.1:${MOBILE_DIRECT_LOCAL_PORT}`
export const MOBILE_DIRECT_SERVE_COMMAND = `tailscale serve --bg --tcp=${MOBILE_DIRECT_PORT} --proxy-protocol=1 tcp://${MOBILE_DIRECT_TARGET}`
export const MOBILE_BODY_LIMIT = 8_100_000

export const MOBILE_VIEWPORTS = {
  'compact-phone': { label: 'Compact phone', width: 320, height: 568, deviceScaleFactor: 2 },
  'small-phone': { label: 'Small phone', width: 360, height: 780, deviceScaleFactor: 2 },
  'phone': { label: 'Phone', width: 390, height: 844, deviceScaleFactor: 2 },
  'large-phone': { label: 'Large phone', width: 430, height: 932, deviceScaleFactor: 3 },
} as const

export type MobileViewportId = keyof typeof MOBILE_VIEWPORTS
export const DEFAULT_MOBILE_VIEWPORT: MobileViewportId = 'phone'

export function isMobileViewportId(value: unknown): value is MobileViewportId {
  return typeof value === 'string' && Object.hasOwn(MOBILE_VIEWPORTS, value)
}

export interface MobileAccessStatus {
  enabled: boolean
  available: boolean
  canSetUpLinks: boolean
  url: string
  directUrl: string
  message: string
}
