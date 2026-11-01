export function findCodex(options?: {
  platform?: NodeJS.Platform
  architecture?: string
  environment?: NodeJS.ProcessEnv
  exists?: (path: string) => boolean
}): string | null
