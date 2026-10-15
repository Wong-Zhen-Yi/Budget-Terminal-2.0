export interface Article {
  id: string
  title: string
  topic: string
  content: string
  status: 'draft' | 'finished'
  createdAt: number
  updatedAt: number
  revision: number
}

export interface ArticlesPayload {
  articles: Article[]
  sourcePath: string
}

export type ArticleFields = Pick<Article, 'title' | 'topic' | 'content' | 'status'>

export interface ArticlePdfDocument { title: string; html: string }
export interface ArticlePdfRequest { articles: ArticlePdfDocument[]; all: boolean }
export interface ArticlePdfResult {
  cancelled: boolean
  paths: string[]
  failures: { title: string; message: string }[]
}

export function articleFilename(title: string): string {
  let name = title.trim().replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-').slice(0, 120).replace(/[. ]+$/g, '') || 'article'
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) name = `article-${name}`
  return `${name}.pdf`
}
export type ArticlesMutation =
  | ({ type: 'add' } & ArticleFields)
  | ({ type: 'update'; id: string; revision: number } & ArticleFields)
  | { type: 'remove'; id: string; revision: number }
