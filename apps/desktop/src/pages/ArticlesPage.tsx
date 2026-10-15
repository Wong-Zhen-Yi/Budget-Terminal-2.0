import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import type { Article, ArticleFields } from '@shared/articles'
import { useArticles, useArticlesMutation } from '@/api/articlesQueries'
import { api } from '@/api/client'
import { ArticleContent, articleBlocks, articlePages, headingText } from '@/components/articles/ArticleContent'
import { articleExport } from '@/components/articles/articleExport'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import '@/styles/articles.css'

const blank = (): ArticleFields => ({ title: '', topic: '', content: '', status: 'draft' })
const fieldsOf = ({ title, topic, content, status }: Article): ArticleFields => ({ title, topic, content, status })
const wordCount = (text: string) => text.replace(/```article-visual\s*\n[\s\S]*?```/g, '').trim().split(/\s+/).filter(Boolean).length
// Keep unsaved work and the reading mode when the page cache evicts this page.
const useEditor = create<{
  selected: Article | null
  draft: ArticleFields | null
  reading: boolean
  set: (selected: Article | null, draft: ArticleFields | null) => void
  setReading: (reading: boolean) => void
}>((set) => ({ selected: null, draft: null, reading: true, set: (selected, draft) => set({ selected, draft }), setReading: reading => set({ reading }) }))

export function ArticlesPage({ onStatusChange }: { onStatusChange: (panels: PanelStatus[], path: string) => void }) {
  const query = useArticles()
  const mutate = useArticlesMutation()
  const { selected, draft, reading, set, setReading } = useEditor()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [libraryOpen, setLibraryOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState<'one' | 'all' | null>(null)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState<{ article: Article | null } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [largeText, setLargeText] = useState(false)
  const [dualPage, setDualPage] = useState(true)
  const viewport = useRef<HTMLDivElement>(null)
  const articles = useMemo(() => query.data?.data.articles ?? [], [query.data])
  const dirty = draft !== null && (selected === null || (['title', 'topic', 'content', 'status'] as const).some(key => draft[key] !== selected[key]))
  const unavailable = query.isPending || !!query.error || query.data?.meta.freshness === 'failed'
  const blocks = useMemo(() => articleBlocks(draft?.content ?? '', draft?.title ?? ''), [draft?.content, draft?.title])
  const sections = blocks.filter(block => block.heading)
  const pages = useMemo(() => dualPage ? articlePages(blocks) : [blocks], [blocks, dualPage])

  useEffect(() => {
    if (dirty || unavailable) return
    if (!selected) {
      if (!draft && articles.length) { set(articles[0], fieldsOf(articles[0])); setReading(true) }
      return
    }
    const latest = articles.find(row => row.id === selected.id)
    if (!latest) set(null, null)
    else if (latest.revision !== selected.revision) set(latest, fieldsOf(latest))
  }, [articles, selected, draft, dirty, unavailable, set, setReading])

  useEffect(() => {
    onStatusChange([{ label: 'Articles', envelope: query.data, loading: query.isPending, error: query.error }], query.data?.data.sourcePath ?? '')
  }, [query.data, query.isPending, query.error, onStatusChange])

  useEffect(() => { viewport.current?.scrollTo({ top: 0 }) }, [selected?.id, reading])

  const open = (article: Article | null) => {
    set(article, article ? fieldsOf(article) : blank())
    setReading(!!article)
    setMessage('')
    setDeleting(false)
    setPending(null)
    // On small workspaces the library is a drawer over the reader.
    if ((viewport.current?.closest('.articles-page')?.clientWidth ?? 1000) < 760) setLibraryOpen(false)
    viewport.current?.scrollTo({ top: 0 })
  }
  const choose = (article: Article | null) => {
    if (dirty) setPending({ article })
    else open(article)
  }
  const save = async () => {
    if (!draft || !draft.title.trim() || busy) return
    setBusy(true)
    setMessage('')
    try {
      const result = await mutate(selected
        ? { type: 'update', id: selected.id, revision: selected.revision, ...draft }
        : { type: 'add', ...draft })
      const saved = selected ? result.articles.find(row => row.id === selected.id) : result.articles[0]
      if (saved) { set(saved, fieldsOf(saved)); setMessage('Saved in Articles.') }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save article.') }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!selected || busy) return
    setBusy(true)
    try { await mutate({ type: 'remove', id: selected.id, revision: selected.revision }); set(null, null); setDeleting(false); setMessage('Article deleted.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not delete article.') }
    finally { setBusy(false) }
  }
  const exportArticles = async (all: boolean) => {
    if (exporting || busy || (!all && !draft) || (all && (unavailable || !articles.length))) return
    setExporting(all ? 'all' : 'one')
    setMessage(all ? `Exporting ${articles.length} articles as separate PDFs…` : 'Exporting article as PDF…')
    try {
      const result = await api.exportArticlesPdf({ all, articles: (all ? articles : [draft!]).map(articleExport) })
      const { cancelled, paths, failures } = result.data
      if (cancelled) setMessage('Export cancelled.')
      else if (failures.length) setMessage(`Exported ${paths.length} of ${paths.length + failures.length} PDFs. ${failures.map(failure => `${failure.title}: ${failure.message}`).join('; ')}`)
      else setMessage(all ? `Exported all ${paths.length} articles as individual PDFs.` : `Article exported to ${paths[0]}`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not export PDFs.') }
    finally { setExporting(null) }
  }
  const visible = articles.filter(row => (filter === 'all' || row.status === filter) && `${row.title} ${row.topic} ${row.content}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const words = wordCount(draft?.content ?? '')
  const update = (fields: Partial<ArticleFields>) => { if (draft) set(selected, { ...draft, ...fields }) }
  const counts = { draft: articles.filter(row => row.status === 'draft').length, finished: articles.filter(row => row.status === 'finished').length }

  return <div className="articles-page">
    <div className={`articles-layout ${libraryOpen ? 'articles-library-open' : ''}`}>
      <header className="articles-header">
        <div><span className="articles-eyebrow">RESEARCH & IDEAS</span><h1>Articles</h1></div>
        <p>Your library. Your thinking.</p>
        <button className="articles-button" disabled={busy || !!exporting || unavailable || !articles.length} title="Choose a folder for one PDF per saved article, including drafts and articles hidden by filters" onClick={() => void exportArticles(true)}>{exporting === 'all' ? 'Exporting all…' : 'Export all Articles'}</button>
        <button className="articles-button articles-primary" disabled={busy || unavailable} onClick={() => choose(null)}>New article</button>
      </header>
      {unavailable && <div role="alert" className="articles-notice">{query.isPending ? 'Loading articles…' : query.data?.meta.failureReason ?? query.error?.message ?? 'Could not load articles.'}{!query.isPending && <button className="articles-button" onClick={() => void query.refetch()}>Retry</button>}</div>}
      <div className="articles-workspace">
        <aside className="articles-library" aria-label="Article library" id="article-library">
          <div className="articles-library-controls">
            <div className="articles-library-heading"><h2>Library <span>{articles.length}</span></h2><button className="articles-link" onClick={() => setLibraryOpen(false)} aria-label="Hide library">Hide</button></div>
            <input aria-label="Search articles" placeholder="Search your articles" className="articles-input" value={search} onChange={event => setSearch(event.target.value)} />
            <select aria-label="Filter articles" className="articles-input" value={filter} onChange={event => setFilter(event.target.value)}>
              <option value="all">All articles ({articles.length})</option><option value="draft">Drafts ({counts.draft})</option><option value="finished">Finished ({counts.finished})</option>
            </select>
          </div>
          <div className="articles-list" tabIndex={0} aria-label="Saved articles">
            {visible.map(article => <button key={article.id} disabled={busy || unavailable} onClick={() => choose(article)} aria-pressed={selected?.id === article.id} className={`articles-card ${selected?.id === article.id ? 'is-selected' : ''}`}>
              <span className={`articles-badge ${article.status}`}>{article.status}</span>
              <strong>{article.title}</strong>
              <span className="articles-card-topic">{article.topic || 'No topic'}</span>
              <span className="articles-card-excerpt">{article.content.replace(/```article-visual\s*\n[\s\S]*?```/g, '').replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').slice(0, 150) || 'Start writing your next idea.'}</span>
              <span className="articles-card-meta">{new Date(article.updatedAt).toLocaleDateString()} · {Math.max(1, Math.ceil(wordCount(article.content) / 200))} min read</span>
            </button>)}
            {!visible.length && !unavailable && <div className="articles-list-empty"><strong>{articles.length ? 'No matching articles' : 'A fresh page awaits'}</strong><p>{articles.length ? 'Try another search or filter.' : 'Create a draft to start your library.'}</p>{search && <button className="articles-link" onClick={() => { setSearch(''); setFilter('all') }}>Clear search & filter</button>}</div>}
          </div>
          <div className="articles-library-footer">{counts.finished} finished · {counts.draft} drafts</div>
        </aside>
        <main className="articles-main">
          <div className="articles-toolbar">
            <button className="articles-button" aria-expanded={libraryOpen} aria-controls="article-library" onClick={() => setLibraryOpen(!libraryOpen)}>{libraryOpen ? 'Hide library' : 'Show library'}</button>
            {draft && <>
              <div className="articles-mode" aria-label="Article view"><button aria-pressed={reading} onClick={() => setReading(true)}>Read article</button><button aria-pressed={!reading} onClick={() => setReading(false)}>Edit article</button></div>
              <span className={`articles-save-state ${dirty ? 'is-dirty' : ''}`}>{dirty ? 'Unsaved changes' : 'Saved'}</span>
              <button className="articles-button articles-primary" disabled={busy || unavailable || !dirty || !draft.title.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save article'}</button>
              <button className="articles-button" disabled={busy || !!exporting} title="Save the current article, including unsaved edits, as PDF" onClick={() => void exportArticles(false)}>{exporting === 'one' ? 'Exporting…' : 'Export article'}</button>
              {reading && <button className="articles-button" aria-pressed={largeText} onClick={() => setLargeText(!largeText)}>{largeText ? 'Standard text' : 'Larger text'}</button>}
              {reading && <div className="articles-mode" aria-label="Reading layout"><button aria-pressed={!dualPage} onClick={() => setDualPage(false)}>Single page</button><button aria-pressed={dualPage} onClick={() => setDualPage(true)}>Dual page</button></div>}
            </>}
          </div>
          {(pending || deleting || message) && <div className="articles-notices">
            {pending && <div role="alert" className="articles-notice articles-warning"><span>You have unsaved changes.</span><button className="articles-button" onClick={() => open(pending.article)}>Discard changes and continue</button><button className="articles-button articles-primary" onClick={() => setPending(null)}>Keep editing</button></div>}
            {deleting && <div role="alert" className="articles-notice articles-warning"><span>Delete “{selected?.title}”? This cannot be undone.</span><button className="articles-button articles-danger" disabled={busy} onClick={() => void remove()}>Confirm delete</button><button className="articles-button" disabled={busy} onClick={() => setDeleting(false)}>Cancel</button></div>}
            {message && <p role="status" className="articles-notice">{message}</p>}
          </div>}
          {draft && reading && sections.length > 0 && <nav className="articles-section-nav" aria-label="Article sections"><label>Jump to section<select className="articles-input" value="" onChange={event => {
            const target = viewport.current?.querySelector<HTMLElement>(`#${event.target.value}`)
            if (target && viewport.current) { viewport.current.scrollTo({ top: target.getBoundingClientRect().top - viewport.current.getBoundingClientRect().top + viewport.current.scrollTop - 24 }); target.tabIndex = -1; target.focus({ preventScroll: true }) }
          }}><option value="">Contents ({sections.length} sections)</option>{sections.map(section => <option key={section.id} value={section.id}>{headingText(section.text)}</option>)}</select></label></nav>}
          <div ref={viewport} className="articles-viewport" tabIndex={0} role="region" aria-label={reading ? 'Article reader' : 'Article editor'}>
            {!draft ? <div className="articles-empty"><span className="articles-empty-symbol" aria-hidden="true">✎</span><span className="articles-eyebrow">WRITING WORKSPACE</span><h2>A home for your ideas</h2><p>Keep research, work through a thesis, or capture your next idea. Select an article from your library or start with a blank page.</p><button className="articles-button articles-primary" disabled={busy || unavailable} onClick={() => choose(null)}>Create your first draft</button></div>
              : reading ? <article className={`articles-reading ${dualPage ? 'articles-dual-page' : ''} ${largeText ? 'articles-large-text' : ''}`}>
                <div className="articles-sheets">{pages.map((page, index) => <section key={index} className="articles-paper articles-sheet" aria-label={`Article page ${index + 1} of ${pages.length}`}>
                {index === 0 ? <>
                <div className="articles-paper-meta"><span className={`articles-badge ${draft.status}`}>{draft.status}</span><span>{words.toLocaleString()} words · {Math.max(1, Math.ceil(words / 200))} min read</span></div>
                <h2>{draft.title || 'Untitled article'}</h2>
                {draft.topic && <p className="articles-topic">{draft.topic}</p>}
                {selected && <p className="articles-updated">Updated {new Date(selected.updatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</p>}
                </> : <p className="articles-running-title">{draft.title || 'Untitled article'}</p>}
                {page.length ? <ArticleContent blocks={page} /> : <p className="articles-topic">This article has no content yet. Open the editor to start writing.</p>}
                {dualPage && <div className="articles-page-number">{index + 1} / {pages.length}</div>}
                </section>)}</div>
                <div className="articles-end">End of article<button className="articles-link" onClick={() => viewport.current?.scrollTo({ top: 0 })}>Back to top ↑</button></div>
              </article> : <fieldset disabled={busy || unavailable} className="articles-editor">
                <div className="articles-editor-intro"><span className="articles-eyebrow">{selected ? 'EDIT YOUR ARTICLE' : 'A NEW IDEA'}</span><h2>{selected ? 'Make it your own' : 'Start with a thought'}</h2><p>Plain text or Markdown. Preview your work in the reader.</p></div>
                <label>Title<input className="articles-input articles-title-input" value={draft.title} maxLength={300} onChange={event => update({ title: event.target.value })} placeholder="Article title" /></label>
                <div className="articles-editor-details"><label>Topic<input className="articles-input" value={draft.topic} maxLength={500} onChange={event => update({ topic: event.target.value })} placeholder="What is this article about?" /></label><label>Status<select className="articles-input" value={draft.status} onChange={event => update({ status: event.target.value as ArticleFields['status'] })}><option value="draft">Draft</option><option value="finished">Finished</option></select></label></div>
                <label>Article<textarea className="articles-input articles-body-input" value={draft.content} maxLength={1_000_000} onChange={event => update({ content: event.target.value })} placeholder="Write here or paste your AI-generated article…" /></label>
                <div className="articles-editor-actions"><button className="articles-button" onClick={() => void api.writeClipboard(`Write an article titled "${draft.title || 'Untitled'}" about ${draft.topic || 'the topic I provide'}. Save it in Budget Terminal’s Articles workspace.\n\n${draft.content}`).then(() => setMessage('Writing brief copied. Paste it into your AI chat.'), () => setMessage('Could not copy writing brief.'))}>Copy AI writing brief</button></div>
              </fieldset>}
          </div>
          {draft && <footer className="articles-footer"><span>{words.toLocaleString()} words · {Math.max(1, Math.ceil(words / 200))} min read</span>{selected && <div><button className="articles-link" disabled={busy || unavailable} onClick={() => {
            const latest = articles.find(row => row.id === selected.id)
            if (latest) choose(latest)
            else setMessage('This article is no longer in the library. Save your text as a new article.')
          }}>Reload saved version</button><button className="articles-link articles-danger" disabled={busy || unavailable} onClick={() => { setPending(null); setDeleting(true) }}>Delete</button></div>}</footer>}
        </main>
      </div>
    </div>
  </div>
}
