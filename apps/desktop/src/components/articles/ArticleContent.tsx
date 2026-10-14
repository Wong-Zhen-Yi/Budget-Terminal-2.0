import type { ReactNode } from 'react'
import { api } from '@/api/client'
import { ArticleVisual } from './ArticleVisual'
import { parseArticleVisual } from './articleVisuals'
import type { ArticleVisualData } from './articleVisuals'

export interface ArticleBlock {
  text: string
  heading: boolean
  id: string
  visual?: ArticleVisualData | null
}

// Interpret presentation only. The original saved text remains the editor's source of truth.
export function articleBlocks(content: string, title: string): ArticleBlock[] {
  return content.replace(/\r\n/g, '\n').split(/(```article-visual\s*\n[\s\S]*?```)/g)
    .flatMap(part => part.startsWith('```article-visual') ? [part] : part.split(/\n\s*\n/)).filter(block => block.trim()).map((text, index) => {
    const trimmed = text.trim()
    return {
      text: trimmed,
      heading: !trimmed.includes('\n') && (/^#{1,6}\s+/.test(trimmed) || /^\d+\.\s+\D/.test(trimmed) || trimmed === 'Sources'),
      id: `article-section-${index}`,
      ...(trimmed.startsWith('```article-visual') ? { visual: parseArticleVisual(trimmed) } : {}),
    }
  }).filter((block, index) => index !== 0 || block.text.replace(/^#+\s+/, '') !== title)
}

export function articlePages(blocks: ArticleBlock[]): ArticleBlock[][] {
  const pages: ArticleBlock[][] = [[]]
  let weight = 0
  const cost = (block: ArticleBlock) => block.visual ? 300 : block.heading ? 30 : block.text.split(/\s+/).length
  blocks.forEach((block, index) => {
    const budget = pages.length === 1 ? 300 : 450
    const nextCost = block.heading && blocks[index + 1] ? cost(blocks[index + 1]) : 0
    if (weight && weight + cost(block) + nextCost > budget) { pages.push([]); weight = 0 }
    pages[pages.length - 1].push(block)
    weight += cost(block)
  })
  return pages
}

export function headingText(text: string): string {
  return text.replace(/^#{1,6}\s+/, '')
}

function inline(text: string): ReactNode[] {
  const tokens = text.split(/(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>]+|\*\*[^*\n]+\*\*)/g)
  return tokens.map((token, index) => {
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token)
    const url = link?.[2] ?? (/^https?:\/\//.test(token) ? token.replace(/[.,;!?]+$/, '') : null)
    if (url) return <a key={index} href={url} title={url} onClick={event => {
      event.preventDefault()
      void api.openExternal(url)
    }}>{link?.[1] ?? url}</a>
    if (token.startsWith('**') && token.endsWith('**')) return <strong key={index}>{token.slice(2, -2)}</strong>
    return token
  })
}

export function ArticleContent({ blocks }: { blocks: ArticleBlock[] }) {
  return <div className="articles-prose">{blocks.map(block => {
    if (block.visual) return <ArticleVisual key={block.id} visual={block.visual} />
    if (block.visual === null) return <div className="article-visual-error" key={block.id}><strong>Could not display this visual.</strong><p>The saved chart definition needs correcting in the editor. Your original text is preserved.</p><pre>{block.text}</pre></div>
    if (block.heading) return <h3 id={block.id} key={block.id}>{inline(headingText(block.text))}</h3>
    const lines = block.text.split('\n')
    if (lines.every(line => /^[-*]\s+/.test(line))) return <ul key={block.id}>{lines.map((line, index) => <li key={index}>{inline(line.replace(/^[-*]\s+/, ''))}</li>)}</ul>
    return <p key={block.id}>{inline(block.text)}</p>
  })}</div>
}
