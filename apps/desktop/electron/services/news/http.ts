import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'

import { createPublicLookup, publicNewsUrl } from './publicNetwork.js'

/**
 * A byte-capped GET for the two places the News page reaches a publisher directly.
 *
 * `fetch` cannot do this job, for two reasons found the hard way:
 *
 * 1. **Header size.** Node's `fetch` is undici, whose `maxHeaderSize` is fixed at 16KB and
 *    not settable per request. Yahoo answers an article URL with a wall of `Set-Cookie`
 *    headers well past that, and the whole request dies as an opaque `fetch failed` whose
 *    cause is `Headers Overflow Error`. `node:https` takes `maxHeaderSize` as an option, so
 *    it can simply be raised.
 * 2. **Body size.** `fetch` has to buffer the whole response before anything can be
 *    truncated. Streaming lets the request be destroyed the moment it passes the cap, which
 *    is what keeps a twenty-megabyte page from being downloaded to read six kilobytes of it.
 *
 * The rest of the app's non-Yahoo calls stay on `fetch` — they read small JSON and XML from
 * hosts that behave.
 */

const MAX_HEADER_BYTES = 64 * 1024
const MAX_REDIRECTS = 5
const publicLookup = createPublicLookup()

export interface HttpResponse {
  status: number
  contentType: string
  body: Buffer
  /** True when the response was longer than `maxBytes` and got cut off. */
  truncated: boolean
  /** Where the response actually came from, after redirects. */
  url: string
}

export interface HttpGetOptions {
  headers: Record<string, string>
  timeoutMs: number
  maxBytes: number
}

function once(url: string, options: HttpGetOptions): Promise<HttpResponse | { redirect: string }> {
  return new Promise((resolve, reject) => {
    const target = publicNewsUrl(url)
    const send = target.protocol === 'http:' ? httpRequest : httpsRequest

    const request = send(
      target,
      { method: 'GET', headers: options.headers, maxHeaderSize: MAX_HEADER_BYTES,
        lookup: publicLookup, agent: false, signal: AbortSignal.timeout(options.timeoutMs) },
      (response: IncomingMessage) => {
        const status = response.statusCode ?? 0
        const location = response.headers.location

        if (status >= 300 && status < 400 && location) {
          response.resume()
          resolve({ redirect: new URL(location, target).toString() })
          return
        }

        const chunks: Buffer[] = []
        let size = 0
        let truncated = false

        response.on('data', (chunk: Buffer) => {
          if (truncated) return
          size += chunk.length
          if (size > options.maxBytes) {
            truncated = true
            chunks.push(chunk.subarray(0, chunk.length - (size - options.maxBytes)))
            response.destroy()
            return
          }
          chunks.push(chunk)
        })
        // `close` rather than `end`: a destroyed response never emits `end`, and the bytes
        // gathered up to the cap are exactly what the caller asked for.
        response.on('close', () =>
          resolve({
            status,
            contentType: String(response.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '',
            body: Buffer.concat(chunks),
            truncated,
            url: target.toString(),
          }),
        )
        response.on('error', reject)
      },
    )

    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new Error(`Timed out after ${options.timeoutMs}ms.`))
    })
    request.on('error', reject)
    request.end()
  })
}

/** Every redirect and socket lookup must stay on the public network. */
export async function httpGet(url: string, options: HttpGetOptions): Promise<HttpResponse> {
  let target = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const result = await once(target, options)
    if ('redirect' in result) {
      target = result.redirect
      continue
    }
    return result
  }
  throw new Error('Too many redirects.')
}
