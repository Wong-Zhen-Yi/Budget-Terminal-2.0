import { z } from 'zod'
import type { TelegramState } from '../shared/telegram.js'

export const telegramConfigSchema = z.object({
  token: z.string().regex(/^\d+:[A-Za-z0-9_-]{20,}$/),
  chatId: z.string().regex(/^[1-9]\d{0,15}$/),
  enabled: z.boolean(), receive: z.boolean(), offset: z.number().int().nonnegative().default(0),
}).strict()
export type TelegramConfig = z.infer<typeof telegramConfigSchema>
interface Update { update_id: number; message?: { date: number; text?: string; chat: { id: number; type: string }; from?: { id: number; is_bot?: boolean } } }
interface Options {
  load: () => Promise<unknown>
  save: (config: TelegramConfig | null) => Promise<void>
  reply: (text: string, signal: AbortSignal) => Promise<string>
  reset: () => Promise<void>
  fetch?: typeof fetch
}

/** Single private home chat, explicit allowlist, outbound-only HTTP and no token in diagnostics. */
export class TelegramService {
  private config: TelegramConfig | null = null
  private state: TelegramState = { configured: false, enabled: false, receive: false, connected: false, bot: '', chatId: '', error: '' }
  private controller = new AbortController()
  private loop: Promise<void> | null = null
  private sending = false
  constructor(private options: Options) {}
  snapshot() { return { ...this.state } }
  async initialize() {
    try {
      const saved = await this.options.load()
      if (saved) { this.config = telegramConfigSchema.parse(saved); await this.start() }
    } catch { this.state.error = 'Telegram settings could not be opened. Re-enter your settings to reconnect.' }
  }
  private async api<T>(method: string, body: object, signal = this.controller.signal, config = this.config): Promise<T> {
    if (!config) throw new Error('Configure Telegram in Agents first.')
    try {
      const response = await (this.options.fetch ?? fetch)(`https://api.telegram.org/bot${config.token}/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]), redirect: 'error',
      })
      const result = await response.json() as { ok: boolean; result: T }
      if (!response.ok || !result.ok) throw new Error(`Telegram request failed (${response.status}). Check the bot token, chat ID and whether another bot gateway is running.`)
      return result.result
    } catch (error) {
      // Fetch errors may contain the credential-bearing URL; never propagate them.
      if (error instanceof Error && error.message.startsWith('Telegram request failed (')) throw error
      throw new Error('Telegram request could not complete. Check connectivity; delivery may be uncertain. Do not resend automatically.')
    }
  }
  async configure(input: { token?: string; chatId: string; enabled: boolean; receive: boolean }) {
    if (this.sending) throw new Error('Wait for the current Telegram delivery before changing settings.')
    const parsed = telegramConfigSchema.safeParse({ ...input, token: input.token || this.config?.token, offset: 0 })
    if (!parsed.success) throw new Error('Enter a valid BotFather token and your numeric private chat/user ID.')
    const config = parsed.data
    if (config.enabled) await this.api('getMe', {}, undefined, config)
    await this.close()
    this.controller = new AbortController()
    // New configuration drops queued commands so enabling never executes old instructions.
    if (config.enabled && config.receive) {
      const pending = await this.api<Update[]>('getUpdates', { offset: -1, timeout: 0, allowed_updates: ['message'] }, undefined, config)
      config.offset = pending.length ? pending[pending.length - 1].update_id + 1 : 0
    }
    await this.options.save(config)
    this.config = config
    await this.options.reset()
    await this.start()
  }
  private async start() {
    const config = this.config!
    this.controller = new AbortController()
    this.state = { configured: true, enabled: config.enabled, receive: config.receive, connected: false, chatId: config.chatId, bot: '', error: '' }
    if (!config.enabled) return
    try {
      const me = await this.api<{ username: string }>('getMe', {})
      this.state.bot = me.username; this.state.connected = true
      if (config.receive) this.loop = this.poll(this.controller.signal)
    } catch (error) { this.state.error = (error as Error).message }
  }
  async send(text: string, signal = this.controller.signal) {
    if (!this.config?.enabled) throw new Error('Telegram messaging is disabled. Configure it in Agents.')
    if (!text.trim() || text.length > 20_000) throw new Error('Telegram messages must contain 1–20,000 characters.')
    if (this.sending) throw new Error('Another Telegram message is being delivered. Wait before sending again.')
    this.sending = true
    const config = this.config
    signal = AbortSignal.any([signal, this.controller.signal])
    let sent = 0
    try {
      // Plain text avoids Markdown parse failures. Array.from preserves surrogate pairs.
      const characters = Array.from(text)
      for (let at = 0; at < characters.length; at += 3500) {
        await this.api('sendMessage', { chat_id: config.chatId, text: characters.slice(at, at + 3500).join(''), link_preview_options: { is_disabled: true } }, signal, config)
        sent++
      }
      this.state.error = ''
      return { sent: true, parts: sent }
    } catch (error) {
      this.state.error = `${(error as Error).message} ${sent} parts confirmed sent.`
      throw new Error(this.state.error)
    } finally { this.sending = false }
  }
  private async poll(signal: AbortSignal) {
    let failures = 0
    while (!signal.aborted) {
      try {
        const config = this.config!
        const updates = await this.api<Update[]>('getUpdates', { offset: config.offset, timeout: 25, limit: 10, allowed_updates: ['message'] }, signal)
        this.state.connected = true; this.state.error = ''; failures = 0
        for (const update of updates) {
          if (signal.aborted) return
          if (update.update_id < config.offset) continue
          // Persist acknowledgement before dispatch: never replay a remote action after restart.
          config.offset = update.update_id + 1
          await this.options.save(config)
          const message = update.message
          if (!message || message.chat.type !== 'private' || String(message.chat.id) !== config.chatId || String(message.from?.id) !== config.chatId || message.from?.is_bot) continue
          if (Date.now() / 1000 - message.date > 300) continue
          const text = message.text?.trim()
          if (!text) { await this.send('Text messages are supported. Send your research question as text.', signal); continue }
          if (text === '/start' || text === '/help') { await this.send('Budget Terminal research agent. Ask a question, /new to reset this Telegram conversation. Keep the desktop app open. Saved-data edits require the desktop app.', signal); continue }
          if (text === '/new') { await this.options.reset(); await this.send('Started a new Telegram conversation.', signal); continue }
          await this.api('sendChatAction', { chat_id: config.chatId, action: 'typing' }, signal)
          let reply: string
          try { reply = await this.options.reply(text, signal) }
          catch {
            if (signal.aborted) return
            await this.send('Budget Terminal could not complete this research request. Check Codex sign-in and connectivity in the desktop app, then send a new request.', signal)
            this.state.error = 'Telegram research failed. Check Codex sign-in and connectivity.'
            continue
          }
          if (!signal.aborted) await this.send(reply.slice(0, 20_000), signal)
        }
      } catch (error) {
        if (signal.aborted) return
        this.state.connected = false
        this.state.error = error instanceof Error && error.message.startsWith('Telegram') ? error.message : 'Telegram research or settings save failed. Check Codex and local storage in the desktop app.'
        failures++
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
          const timer = setTimeout(done, Math.min(30_000, failures * 3000))
          signal.addEventListener('abort', done, { once: true })
          if (signal.aborted) done()
        })
      }
    }
  }
  async disconnect() {
    await this.close()
    await this.options.save(null)
    this.config = null
    this.state = { configured: false, enabled: false, receive: false, connected: false, bot: '', chatId: '', error: '' }
  }
  async close() { this.controller.abort(); await this.loop; this.loop = null; this.state.connected = false }
}
