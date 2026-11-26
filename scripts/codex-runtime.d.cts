export function findCodex(options?: {
  platform?: NodeJS.Platform
  architecture?: string
  environment?: NodeJS.ProcessEnv
  exists?: (path: string) => boolean
}): string | null

export function findClaude(options?: {
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
  exists?: (path: string) => boolean
}): string | null
