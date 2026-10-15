import { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { articleFilename } from '../shared/articles.js'
import type { ArticlePdfRequest, ArticlePdfResult } from '../shared/articles.js'

export const articlePdfRequestSchema = z.object({
  all: z.boolean(),
  articles: z.array(z.object({ title: z.string().max(300), html: z.string().min(1).max(8_000_000) })).min(1),
}).refine(request => request.all || request.articles.length === 1, 'Choose one article for a single PDF export.')

export async function renderArticlePdf(html: string): Promise<Buffer> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, partition: 'article-pdf' },
  })
  // Print documents are self-contained. Never load remote assets or local files.
  window.webContents.session.webRequest.onBeforeRequest((details, done) => done({ cancel: !details.url.startsWith('data:text/html,') }))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  try {
    const policy = '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;">'
    await window.loadURL(`data:text/html,${encodeURIComponent(html.replace(/<head>/i, `<head>${policy}`))}`)
    return await window.webContents.printToPDF({
      pageSize: 'A4', printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: '<div style="font:9px Arial;color:#64748b;width:100%;text-align:center">Budget Terminal · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    })
  } finally { window.destroy() }
}

// Bulk writes use exclusive creation, preserving existing PDFs and duplicate titles.
async function writeUnique(directory: string, filename: string, pdf: Buffer): Promise<string> {
  for (let index = 1; ; index++) {
    const path = join(directory, index === 1 ? filename : `${filename.slice(0, -4)} (${index}).pdf`)
    try { await writeFile(path, pdf, { flag: 'wx' }); return path }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  }
}

export async function writeArticlePdfs(request: ArticlePdfRequest, destination: string): Promise<ArticlePdfResult> {
  const result: ArticlePdfResult = { cancelled: false, paths: [], failures: [] }
  for (const article of request.articles) {
    try {
      const pdf = await renderArticlePdf(article.html)
      if (request.all) result.paths.push(await writeUnique(destination, articleFilename(article.title), pdf))
      else { await writeFile(destination, pdf); result.paths.push(destination) }
    } catch (error) {
      result.failures.push({ title: article.title, message: error instanceof Error ? error.message : 'Could not export PDF.' })
    }
  }
  return result
}
