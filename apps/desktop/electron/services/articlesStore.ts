import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import type { ArticlesMutation, ArticlesPayload } from '../shared/articles.js'
import { describeError, failed, ok } from '../shared/envelope.js'
import { withAutomaticBackup } from './automaticBackup.js'

const fields = z.object({
  title: z.string().trim().min(1).max(300),
  topic: z.string().max(500),
  content: z.string().max(1_000_000),
  status: z.enum(['draft', 'finished']),
})
const article = fields.extend({ id: z.string().min(1), createdAt: z.number(), updatedAt: z.number(), revision: z.number().int().positive() })
const document = z.object({ articles: z.array(article) }).refine(value => new Set(value.articles.map(row => row.id)).size === value.articles.length, 'Duplicate article IDs')
const mutationSchema = z.discriminatedUnion('type', [
  fields.extend({ type: z.literal('add') }),
  fields.extend({ type: z.literal('update'), id: z.string(), revision: z.number().int().positive() }),
  z.object({ type: z.literal('remove'), id: z.string(), revision: z.number().int().positive() }),
])

export function articlesPath(): string {
  return join(process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming'), 'BudgetTerminalElectron', 'articles.json')
}

export async function readArticles(target = articlesPath()): Promise<ArticlesPayload> {
  try {
    return { ...document.parse(JSON.parse(await readFile(target, 'utf8'))), sourcePath: target }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { articles: [], sourcePath: target }
    throw error
  }
}

async function persist(value: unknown, target: string): Promise<void> {
  const parsed = document.parse(value)
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(parsed, null, 2), 'utf8')
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
}

let writes: Promise<unknown> = Promise.resolve()
function enqueue<T>(run: () => Promise<T>): Promise<T> {
  const result = writes.then(run)
  writes = result.catch(() => {})
  return result
}

export function mutateArticles(input: ArticlesMutation, target = articlesPath()): Promise<ArticlesPayload> {
  return enqueue(async () => {
    const mutation = mutationSchema.parse(input)
    const state = await readArticles(target)
    const now = Date.now()
    if (mutation.type === 'add') {
      state.articles.unshift({ ...fields.parse(mutation), id: randomUUID(), createdAt: now, updatedAt: now, revision: 1 })
    } else {
      const index = state.articles.findIndex(row => row.id === mutation.id)
      if (index < 0) throw new Error('This article no longer exists. Reload the library.')
      const current = state.articles[index]
      if (current.revision !== mutation.revision) throw new Error('This article changed elsewhere. Reload the saved version before editing again.')
      if (mutation.type === 'remove') state.articles.splice(index, 1)
      else state.articles[index] = { ...current, ...fields.parse(mutation), updatedAt: now, revision: current.revision + 1 }
    }
    await persist(state, target)
    return state
  })
}

export function replaceArticles(value: unknown): Promise<void> {
  return enqueue(() => persist(value, articlesPath()))
}

export async function getArticles() {
  try { return ok(await readArticles(), 'articles store') }
  catch (error) { return failed({ articles: [], sourcePath: articlesPath() }, describeError(error), 'articles store') }
}

export async function saveArticles(mutation: ArticlesMutation) {
  return withAutomaticBackup(async () => {
    try { return ok(await mutateArticles(mutation), 'articles store') }
    catch (error) {
      const current = await readArticles().catch(() => ({ articles: [], sourcePath: articlesPath() }))
      return failed(current, describeError(error), 'articles store')
    }
  })
}
