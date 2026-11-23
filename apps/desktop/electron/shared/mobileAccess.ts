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
  'iphone-17': { label: 'iPhone 17', width: 402, height: 874, deviceScaleFactor: 3 },
} as const

export type MobileViewportId = keyof typeof MOBILE_VIEWPORTS
export const DEFAULT_MOBILE_VIEWPORT: MobileViewportId = 'iphone-17'

export function isMobileViewportId(value: unknown): value is MobileViewportId {
  return typeof value === 'string' && Object.hasOwn(MOBILE_VIEWPORTS, value)
}

export interface MobileAccessStatus {
  enabled: boolean
  available: boolean
  url: string
  directUrl: string
  message: string
}
