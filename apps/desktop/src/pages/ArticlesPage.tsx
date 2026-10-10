import { useEffect, useState } from 'react'
import { create } from 'zustand'
import type { Article, ArticleFields } from '@shared/articles'
import { useArticles, useArticlesMutation } from '@/api/articlesQueries'
import { api } from '@/api/client'
import type { PanelStatus } from '@/components/chrome/StatusBar'

const blank = (): ArticleFields => ({ title: '', topic: '', content: '', status: 'draft' })
// Retain an unsaved editor even when the page cache evicts this page.
const useEditor = create<{
  selected: Article | null
  draft: ArticleFields | null
  set: (selected: Article | null, draft: ArticleFields | null) => void
}>((set) => ({ selected: null, draft: null, set: (selected, draft) => set({ selected, draft }) }))
const button = 'rounded border border-border px-3 py-2 text-2xs hover:bg-surface-hover disabled:opacity-40'
const input = 'w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent'

export function ArticlesPage({ onStatusChange }: { onStatusChange: (panels: PanelStatus[], path: string) => void }) {
  const query = useArticles()
  const mutate = useArticlesMutation()
  const { selected, draft, set } = useEditor()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState<{ article: Article | null } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const articles = query.data?.data.articles ?? []
  const dirty = draft !== null && (selected === null || ['title', 'topic', 'content', 'status'].some(key => draft[key as keyof ArticleFields] !== selected[key as keyof ArticleFields]))
  const unavailable = query.isPending || !!query.error || query.data?.meta.freshness === 'failed'

  useEffect(() => {
    if (!selected || dirty || unavailable) return
    const latest = articles.find(row => row.id === selected.id)
    if (!latest) set(null, null)
    else if (latest.revision !== selected.revision) set(latest, { title: latest.title, topic: latest.topic, content: latest.content, status: latest.status })
  }, [query.data, selected, dirty, unavailable, set])

  useEffect(() => {
    onStatusChange([{ label: 'Articles', envelope: query.data, loading: query.isPending, error: query.error }], query.data?.data.sourcePath ?? '')
  }, [query.data, query.isPending, query.error, onStatusChange])

  const open = (article: Article | null) => {
    set(article, article ? { title: article.title, topic: article.topic, content: article.content, status: article.status } : blank())
    setReading(!!article)
    setMessage('')
    setDeleting(false)
    setPending(null)
  }
  const choose = (article: Article | null) => {
    if (dirty) setPending({ article })
    else open(article)
  }
  const save = async () => {
    if (!draft || !draft.title.trim()) return
    setBusy(true)
    setMessage('')
    try {
      const result = await mutate(selected
        ? { type: 'update', id: selected.id, revision: selected.revision, ...draft }
        : { type: 'add', ...draft })
      const saved = selected ? result.articles.find(row => row.id === selected.id) : result.articles[0]
      if (saved) { set(saved, { title: saved.title, topic: saved.topic, content: saved.content, status: saved.status }); setMessage('Saved in Articles.') }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save article.') }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!selected) return
    setBusy(true)
    try { await mutate({ type: 'remove', id: selected.id, revision: selected.revision }); set(null, null); setDeleting(false); setMessage('Article deleted.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not delete article.') }
    finally { setBusy(false) }
  }
  const visible = articles.filter(row => (filter === 'all' || row.status === filter) && `${row.title} ${row.topic} ${row.content}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const words = (draft?.content.trim() ?? '').split(/\s+/).filter(Boolean).length
  const update = (fields: Partial<ArticleFields>) => { if (draft) set(selected, { ...draft, ...fields }) }

  return <div className="flex min-h-0 flex-1 flex-col text-text">
    <header className="flex items-center justify-between border-b border-border px-5 py-4">
      <div><h1 className="text-lg font-semibold">Articles</h1><p className="mt-1 text-2xs text-text-muted">Your topics, drafts and finished articles, saved in Budget Terminal.</p></div>
      <button className={`${button} bg-accent-dim`} disabled={busy || unavailable} onClick={() => choose(null)}>New article</button>
    </header>
    {unavailable ? <div role="alert" className="p-5 text-sm">{query.isPending ? 'Loading articles…' : query.data?.meta.failureReason ?? query.error?.message ?? 'Could not load articles.'}{!query.isPending && <button className={`${button} ml-3`} onClick={() => void query.refetch()}>Retry</button>}</div> : null}
    <div className="flex min-h-0 flex-1 flex-wrap">
      <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-surface">
        <div className="space-y-3 border-b border-border p-4">
          <input aria-label="Search articles" placeholder="Search titles, topics or text" className={input} value={search} onChange={event => setSearch(event.target.value)} />
          <select aria-label="Filter articles" className={input} value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All articles ({articles.length})</option><option value="draft">Drafts</option><option value="finished">Finished</option></select>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {visible.map(article => <button key={article.id} disabled={busy} onClick={() => choose(article)} className={`mb-1 w-full rounded p-3 text-left hover:bg-surface-hover ${selected?.id === article.id ? 'bg-accent-dim' : ''}`}>
            <span className="block break-words text-sm font-medium">{article.title}</span>
            <span className="mt-1 block text-2xs text-text-muted">{article.topic || 'No topic'} · {article.status}</span>
            <span className="mt-2 block text-2xs text-text-dim">{new Date(article.updatedAt).toLocaleDateString()}</span>
          </button>)}
          {!visible.length && !unavailable && <p className="p-3 text-2xs text-text-muted">{articles.length ? 'No articles match this search.' : 'Your article library starts here.'}</p>}
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        {pending && <div role="alert" className="mb-4 rounded border border-warn p-3 text-sm">You have unsaved changes. <button className={`${button} ml-2`} onClick={() => open(pending.article)}>Discard changes and continue</button> <button className={button} onClick={() => setPending(null)}>Keep editing</button></div>}
        {message && <p role="status" className="mb-4 text-sm">{message}</p>}
        {!draft ? <div className="mx-auto mt-12 max-w-xl rounded border border-border bg-surface p-8">
          <p className="text-2xs text-text-muted">WRITING WORKSPACE</p><h2 className="mt-3 text-xl">A home for your ideas</h2>
          <p className="mt-4 text-sm leading-6 text-text-muted">Create an article, give it a topic and write or paste your draft. You can also ask your connected AI to write an article and save it to Budget Terminal’s Articles workspace.</p>
          <p className="mt-4 text-sm text-text-muted">Select a saved article to read it or continue editing.</p>
          <button className={`${button} mt-6`} disabled={unavailable} onClick={() => choose(null)}>Create your first draft</button>
        </div> : <div className="mx-auto max-w-4xl">
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <button className={button} onClick={() => setReading(!reading)}>{reading ? 'Edit article' : 'Read article'}</button>
            <button className={`${button} bg-accent-dim`} disabled={busy || unavailable || !dirty || !draft.title.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save article'}</button>
            <span className="mr-auto text-2xs text-text-muted">{dirty ? 'Unsaved changes' : 'Saved'} · {words} words · {Math.max(1, Math.ceil(words / 200))} min read</span>
            {selected && <button className={button} disabled={busy} onClick={() => setDeleting(true)}>Delete</button>}
            {selected && <button className={button} disabled={busy} onClick={() => {
              const latest = articles.find(row => row.id === selected.id)
              if (latest) choose(latest)
              else setMessage('This article is no longer in the library. Save your text as a new article.')
            }}>Reload saved version</button>}
          </div>
          {deleting && <div role="alert" className="mb-4 rounded border border-border p-3 text-sm">Delete this saved article? <button className={`${button} ml-2 text-down`} disabled={busy} onClick={() => void remove()}>Confirm delete</button> <button className={button} onClick={() => setDeleting(false)}>Cancel</button></div>}
          {reading ? <article className="select-text rounded border border-border bg-surface p-8">
            <p className="text-2xs text-text-muted">{draft.topic || 'Article'} · {draft.status}</p>
            <h2 className="mt-3 break-words text-2xl font-semibold">{draft.title || 'Untitled article'}</h2>
            <div className="mt-6 whitespace-pre-wrap break-words text-sm leading-7">{draft.content || 'This article has no content yet.'}</div>
          </article> : <fieldset disabled={busy} className="space-y-4">
            <label className="block text-2xs text-text-muted">Title<input className={`${input} mt-2`} value={draft.title} maxLength={300} onChange={event => update({ title: event.target.value })} placeholder="Article title" /></label>
            <div className="flex gap-4"><label className="block flex-1 text-2xs text-text-muted">Topic<input className={`${input} mt-2`} value={draft.topic} maxLength={500} onChange={event => update({ topic: event.target.value })} placeholder="What is this article about?" /></label>
              <label className="block text-2xs text-text-muted">Status<select className={`${input} mt-2`} value={draft.status} onChange={event => update({ status: event.target.value as ArticleFields['status'] })}><option value="draft">Draft</option><option value="finished">Finished</option></select></label></div>
            <label className="block text-2xs text-text-muted">Article<textarea className={`${input} mt-2 min-h-80 leading-7`} value={draft.content} maxLength={1_000_000} onChange={event => update({ content: event.target.value })} placeholder="Write here or paste your AI-generated article…" /></label>
            <button className={button} onClick={() => void api.writeClipboard(`Write an article titled "${draft.title || 'Untitled'}" about ${draft.topic || 'the topic I provide'}. Save it in Budget Terminal’s Articles workspace.\n\n${draft.content}`).then(() => setMessage('Writing brief copied. Paste it into your AI chat.'), () => setMessage('Could not copy writing brief.'))}>Copy AI writing brief</button>
          </fieldset>}
        </div>}
      </main>
    </div>
  </div>
}
