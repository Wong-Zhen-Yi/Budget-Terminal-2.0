import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { articleVisualSchema, parseArticleVisual, sensitivityReturn } from '../src/components/articles/articleVisuals.js'
import { appZetaVisuals } from './fixtures/app-zeta-visuals.js'

const directory = await mkdtemp(join(tmpdir(), 'budget-articles-'))
const original = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory
try {
  appZetaVisuals.forEach(visual => assert(articleVisualSchema.safeParse(visual).success))
  assert(Math.abs(sensitivityReturn(20, -25) - (-10)) < 1e-9)
  assert.equal(parseArticleVisual('```article-visual\n{broken}\n```'), null)
  assert.equal(parseArticleVisual('```article-visual\n' + JSON.stringify({ ...appZetaVisuals[0], sources: [{ label: 'Unsafe', url: 'javascript:alert(1)' }] }) + '\n```'), null)
  const { articlesPath, readArticles, mutateArticles, getArticles, saveArticles } = await import('../electron/services/articlesStore.js')
  const { configureAutomaticBackup, writeUserDataBackup } = await import('../electron/services/automaticBackup.js')
  const { createServiceRoutes } = await import('../electron/mcp/routes.js')
  const { validateCall } = await import('../mcp/catalog.js')
  const { startupPages, workspaceFor } = await import('../electron/shared/navigation.js')
  assert(startupPages('dashboard', [], []).includes('articles'))
  assert.equal(workspaceFor('articles')?.id, 'articles')
  assert.deepEqual((await readArticles()).articles, [])
  const fields = { title: 'AI infrastructure', topic: 'Technology', content: '# Thesis\n\nCapacity & demand <script>plain text</script>', status: 'draft' as const }
  const created = (await mutateArticles({ type: 'add', ...fields })).articles[0]
  assert.equal((await readArticles()).articles[0].content, fields.content)
  const results = await Promise.allSettled([
    mutateArticles({ type: 'update', ...fields, title: 'Updated', id: created.id, revision: 1 }),
    mutateArticles({ type: 'update', ...fields, title: 'Stale', id: created.id, revision: 1 }),
  ])
  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[1].status, 'rejected')
  await assert.rejects(mutateArticles({ type: 'remove', id: created.id, revision: 1 }), /changed elsewhere/)
  await assert.rejects(mutateArticles({ type: 'add', ...fields, title: ' ' }))
  const routes = createServiceRoutes()
  assert(routes.has('articles') && routes.has('mutateArticles'))
  assert.equal(validateCall('budget_terminal_mutate_articles', { request: { type: 'add', ...fields }, requestId: 'article-add' }).operation, 'mutateArticles')
  configureAutomaticBackup(join(directory, 'downloads'))
  const saved = await saveArticles({ type: 'update', ...fields, id: created.id, revision: 2, status: 'finished' })
  assert.notEqual(saved.meta.freshness, 'failed')
  const backup = join(directory, 'backup.json')
  await writeUserDataBackup(backup)
  assert.equal(JSON.parse(await readFile(backup, 'utf8')).articles.articles[0].status, 'finished')
  await mutateArticles({ type: 'remove', id: created.id, revision: 3 })
  assert.deepEqual((await readArticles()).articles, [])
  await writeFile(articlesPath(), '{broken', 'utf8')
  const before = await readFile(articlesPath(), 'utf8')
  assert.equal((await getArticles()).meta.freshness, 'failed')
  assert.equal((await saveArticles({ type: 'add', ...fields })).meta.freshness, 'failed')
  assert.equal(await readFile(articlesPath(), 'utf8'), before, 'Unreadable storage must not be overwritten')
  console.log('PASS: article persistence, validation, concurrent edit protection, AI routes, backup and damaged-file safety')
} finally {
  for (const key of ['APPDATA', 'LOCALAPPDATA'] as const) {
    if (original[key] === undefined) delete process.env[key]
    else process.env[key] = original[key]
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
