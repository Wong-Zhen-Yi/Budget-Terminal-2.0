type Current = { status: 'current'; revision: string }
type Available = { status: 'available'; revision: string; current: string }
type Updated = { status: 'updated'; revision: string }

export function createUpdater(cwd?: string): {
  check(): Promise<Current | Available>
  install(update: Current | Available): Promise<Current | Updated>
}
export const reopenMessage: string
export function updateErrorMessage(error: unknown): string
