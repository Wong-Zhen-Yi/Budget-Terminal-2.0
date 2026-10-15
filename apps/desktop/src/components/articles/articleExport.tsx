import { renderToStaticMarkup } from 'react-dom/server'
import type { ArticleFields, ArticlePdfDocument } from '@shared/articles'
import { ArticleContent, articleBlocks } from './ArticleContent'

// The same safe content renderer as the reader, in a continuous print layout.
const styles = `
  @page { size: A4; margin: 18mm 17mm 20mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #172033; background: white; font: 11pt/1.65 'Segoe UI', Arial, sans-serif; overflow-wrap: anywhere; }
  h1 { font-size: 25pt; line-height: 1.2; margin: 8pt 0 12pt; }
  header { border-bottom: 1px solid #cbd5e1; padding-bottom: 14pt; margin-bottom: 20pt; }
  header p { margin: 4pt 0; color: #475569; }
  .brand, .articles-eyebrow { color: #475569; font-size: 8pt; letter-spacing: .1em; }
  h3 { font-size: 15pt; line-height: 1.4; margin: 22pt 0 10pt; break-after: avoid; }
  p { margin: 0 0 12pt; white-space: pre-wrap; orphans: 3; widows: 3; }
  ul { padding-left: 20pt; }
  li { margin: 5pt 0; }
  a { color: #1754a6; text-decoration: underline; }
  .article-visual { margin: 18pt 0; padding: 14pt; border: 1px solid #cbd5e1; border-radius: 6pt; break-inside: avoid; }
  h4 { font-size: 14pt; line-height: 1.35; margin: 6pt 0; }
  h5 { font-size: 10pt; margin: 0 0 6pt; }
  figcaption p, .article-visual-note, .article-visual-sources { font-size: 8pt; line-height: 1.5; }
  .article-chart-metric + .article-chart-metric { margin-top: 15pt; }
  .article-chart-row { display: grid; grid-template-columns: 58pt minmax(0, 1fr) 68pt; align-items: center; gap: 6pt; font-size: 9pt; margin-top: 4pt; }
  .article-chart-row svg { width: 100%; height: 22pt; }
  .article-chart-row > span { text-align: right; }
  .article-chart-axis { display: flex; justify-content: space-between; margin: 0 74pt 3pt 64pt; font-size: 7pt; }
  .article-visual-note { margin: 14pt 0 6pt; }
  .article-visual-sources { display: flex; flex-wrap: wrap; gap: 4pt 10pt; }
  .article-visual-data { display: none; }
  .article-flow-lane { border-left: 2pt solid #cbd5e1; padding-left: 10pt; margin: 12pt 0; }
  .article-flow-lane ol { display: flex; flex-wrap: wrap; gap: 5pt; list-style: none; padding: 0; }
  .article-flow-lane li { border: 1px solid #cbd5e1; padding: 4pt 6pt; font-size: 9pt; }
  .article-flow-lane li:not(:last-child)::after { content: ' →'; }
  .article-flow-lane p, .article-matrix p { font-size: 9pt; }
  table { border-collapse: collapse; width: 100%; font-size: 8pt; table-layout: fixed; }
  th, td { padding: 6pt 4pt; border: 1px solid #cbd5e1; text-align: right; }
  th:first-child { text-align: left; }
  .article-matrix-scale { display: flex; justify-content: space-between; font-size: 8pt; margin-top: 6pt; }
  .article-visual-error { border: 1px solid #a16207; padding: 10pt; }
  pre { white-space: pre-wrap; font-size: 8pt; }
  svg, table, .article-chart-metric, .article-flow-lane { break-inside: avoid; }
  body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
`

export function articleExport(article: ArticleFields): ArticlePdfDocument {
  const title = article.title.trim() || 'Untitled article'
  const document = <html lang="en"><head><meta charSet="utf-8" /><title>{title}</title><style>{styles}</style></head>
    <body><header><span className="brand">BUDGET TERMINAL · ARTICLES</span><h1>{title}</h1>{article.topic && <p>{article.topic}</p>}<p>Status: {article.status}</p></header>
      <ArticleContent blocks={articleBlocks(article.content, title)} /></body></html>
  return { title, html: '<!doctype html>' + renderToStaticMarkup(document) }
}
