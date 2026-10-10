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
export type ArticlesMutation =
  | ({ type: 'add' } & ArticleFields)
  | ({ type: 'update'; id: string; revision: number } & ArticleFields)
  | { type: 'remove'; id: string; revision: number }
