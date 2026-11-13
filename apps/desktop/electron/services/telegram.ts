import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import type { TelegramState } from '../shared/telegram.js'
import { formatTelegramText, TelegramError } from '../shared/telegram.js'
import { agentsChanged, observableStatus } from './liveStatusEvents.js'
import type { Envelope } from '../shared/contract.js'
import type { ScreenshotPayload } from '../shared/screenshot.js'

export const telegramCommands = [
  { command: 'new', description: 'Start a fresh chat: /new [question]' },
  { command: 'model', description: 'Choose a model, then its reasoning level' },
]
export type TelegramResearchCommand = 'model' | 'reasoning'
const help = 'Budget Terminal research agent.\n' + telegramCommands.map(command => `/${command.command} — ${command.description}`).join('\n')
  + '\nMessages retain context in the current Telegram chat, including after app restart. /new keeps old chats in history but starts without their conversation context. Keep the desktop app open. Saved-data edits require the desktop app. Commands run after any current answer finishes.'

export const telegramConfigSchema = z.object({
  token: z.string().regex(/^\d+:[A-Za-z0-9_-]{20,}$/),
  chatId: z.string().regex(/^[1-9]\d{0,15}$/),
  enabled: z.boolean(), receive: z.boolean(), offset: z.number().int().nonnegative().default(0),
}).strict()
export type TelegramConfig = z.infer<typeof telegramConfigSchema>
interface TelegramMessage { message_id?: number; date: number; text?: string; chat: { id: number; type: string }; from?: { id: number; is_bot?: boolean } }
interface Update {
  update_id: number
  message?: TelegramMessage
  callback_query?: { id: string; data?: string; from: { id: number; is_bot?: boolean }; message?: TelegramMessage }
}
export interface TelegramPickerChoice { id: string; name: string; current: boolean }
export interface TelegramModelChoice extends TelegramPickerChoice { reasoning: TelegramPickerChoice[] }
type InlineKeyboard = { inline_keyboard: { text: string; callback_data: string }[][] }
interface Options {
  load: () => Promise<unknown>
  save: (config: TelegramConfig | null) => Promise<void>
  reply: (text: string, signal: AbortSignal) => Promise<string>
  reset: () => Promise<void>
  command?: (command: TelegramResearchCommand, argument: string) => Promise<string>
  models?: () => Promise<TelegramModelChoice[]>
  screenshot?: (page: string, signal: AbortSignal) => Promise<Envelope<ScreenshotPayload>>
  fetch?: typeof fetch
}

/** Single private home chat, explicit allowlist, outbound-only HTTP and no token in diagnostics. */
export class TelegramService {
  private config: TelegramConfig | null = null
  private currentState: TelegramState = observableStatus({ configured: false, enabled: false, receive: false, connected: false, bot: '', chatId: '', error: '' }, agentsChanged)
  private get state() { return this.currentState }
  private set state(value: TelegramState) { this.currentState = observableStatus(value, agentsChanged); agentsChanged() }
  private controller = new AbortController()
  private loop: Promise<void> | null = null
  private sending = false
  private photosSent = 0
  private deliveryError = ''
  private modelPicker: { nonce: string; choices: TelegramPickerChoice[]; kind: 'model' | 'reasoning'; modelId?: string; expiresAt: number; messageId?: number } | null = null
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
        method: 'POST', ...(body instanceof FormData ? { body } : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]), redirect: 'error',
      })
      const result = await response.json() as { ok: boolean; result: T; error_code?: number; description?: string }
      if (!response.ok || !result.ok) {
        const code = result.error_code ?? response.status
        // Match provider reasons, but never expose raw descriptions or URLs.
        const reason = String(result.description ?? '').toLowerCase()
        const advice = code === 401 || code === 404 ? 'The bot token was rejected. Update the token from BotFather.'
          : code === 409 ? 'Another gateway or webhook is using this bot. Stop the other gateway or use a separate bot token.'
            : code === 429 ? 'Telegram rate limit reached. Wait before trying again.'
              : reason.includes('blocked') ? 'Your bot is blocked. Unblock it in Telegram and send /start.'
                : reason.includes('chat not found') || reason.includes('initiate conversation') ? 'The private chat is unavailable to this bot. Check your personal numeric user ID, open this exact bot in Telegram, and send /start.'
                  : reason.includes('bots') ? 'The recipient is a bot. Enter your personal numeric Telegram user ID, not the bot ID.'
                    : code === 403 ? 'Telegram denied access to this chat. Check the user ID and unblock/start this exact bot.'
                      : 'Telegram rejected the request. Check the bot and private chat settings.'
        throw new TelegramError(`Telegram ${method} failed (${code}). ${advice}`)
      }
      return result.result
    } catch (error) {
      // Fetch errors may contain the credential-bearing URL; never propagate them.
      if (error instanceof TelegramError) throw error
      throw new TelegramError('Telegram request could not complete. Check connectivity; delivery may be uncertain. Do not resend automatically.')
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
      const pending = await this.api<Update[]>('getUpdates', { offset: -1, timeout: 0, allowed_updates: ['message', 'callback_query'] }, undefined, config)
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
    this.deliveryError = ''
    this.state = { configured: true, enabled: config.enabled, receive: config.receive, connected: false, chatId: config.chatId, bot: '', error: '' }
    if (!config.enabled) return
    try {
      const me = await this.api<{ username: string }>('getMe', {})
      this.state.bot = me.username; this.state.connected = true
      await this.checkChat()
      if (config.receive) {
        // Only publish the menu in the authorized private chat.
        try { await this.api('setMyCommands', { commands: telegramCommands, scope: { type: 'chat', chat_id: config.chatId } }) }
        catch { this.state.error = 'Telegram command menu could not be updated. Typed commands still work.' }
        this.loop = this.poll(this.controller.signal)
      }
    } catch (error) { this.state.error = (error as Error).message }
  }
  async checkChat() {
    if (!this.config?.enabled) throw new TelegramError('Telegram messaging is disabled. Enable it in Agents first.')
    try {
      const chat = await this.api<{ id: number; type: string }>('getChat', { chat_id: this.config.chatId })
      if (chat.type !== 'private' || String(chat.id) !== this.config.chatId) throw new TelegramError('Telegram requires your personal private chat ID. Check the configured user ID.')
      this.deliveryError = ''; this.state.error = ''
    } catch (error) {
      this.deliveryError = (error as Error).message; this.state.error = this.deliveryError
      // Keep polling available: /start can make a previously unknown private chat accessible.
    }
  }
  async send(text: string, signal = this.controller.signal, keyboard?: InlineKeyboard) {
    if (!this.config?.enabled) throw new Error('Telegram messaging is disabled. Configure it in Agents.')
    if (!text.trim() || text.length > 20_000) throw new Error('Telegram messages must contain 1–20,000 characters.')
    text = formatTelegramText(text)
    if (!text) throw new Error('Telegram messages must contain readable text.')
    if (this.sending) throw new Error('Another Telegram message is being delivered. Wait before sending again.')
    this.sending = true
    const config = this.config
    signal = AbortSignal.any([signal, this.controller.signal])
    let sent = 0
    let messageId: number | undefined
    try {
      // Plain text avoids Markdown parse failures. Array.from preserves surrogate pairs.
      const characters = Array.from(text)
      for (let at = 0; at < characters.length; at += 3500) {
        const result = await this.api<{ message_id?: number }>('sendMessage', { chat_id: config.chatId, text: characters.slice(at, at + 3500).join(''), link_preview_options: { is_disabled: true },
          ...(keyboard && at + 3500 >= characters.length ? { reply_markup: keyboard } : {}) }, signal, config)
        messageId = result.message_id
        sent++
      }
      this.deliveryError = ''; this.state.error = ''
      return { sent: true, parts: sent, messageId }
    } catch (error) {
      this.deliveryError = `${(error as Error).message} ${sent} parts confirmed sent.`
      this.state.error = this.deliveryError
      throw new TelegramError(this.state.error)
    } finally { this.sending = false }
  }
  async sendScreenshot(page = 'current', signal = this.controller.signal) {
    if (!this.options.screenshot) throw new TelegramError('Telegram screenshot capture is unavailable.')
    if (!/^[a-z][a-z0-9-]{0,79}$/.test(page)) throw new TelegramError('Use an implemented page ID, current or all.')
    return this.deliverScreenshots(signal => this.options.screenshot!(page, signal), signal)
  }
  async sendScreenshots(result: Envelope<ScreenshotPayload>, signal = this.controller.signal) {
    return this.deliverScreenshots(async () => result, signal)
  }
  private async deliverScreenshots(capture: (signal: AbortSignal) => Promise<Envelope<ScreenshotPayload>>, signal: AbortSignal) {
    if (!this.config?.enabled) throw new TelegramError('Telegram messaging is disabled. Configure it in Agents.')
    if (this.sending) throw new TelegramError('Another Telegram message is being delivered. Wait before sending again.')
    this.sending = true
    const config = this.config
    signal = AbortSignal.any([signal, this.controller.signal])
    let sent = 0
    try {
      if (signal.aborted) throw new TelegramError('Telegram screenshot cancelled.')
      const result = await capture(signal)
      if (signal.aborted) throw new TelegramError('Telegram screenshot cancelled.')
      if (!result.data.screenshots.length) throw new TelegramError('No screenshot was captured. Check the page ID, screenshot permissions and desktop window in Budget Terminal Settings.')
      for (const image of result.data.screenshots) {
        const bytes = Buffer.from(image.base64, 'base64')
        if (!bytes.length || bytes.length > 10_000_000 || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1 || image.width + image.height > 10000 || Math.max(image.width, image.height) / Math.min(image.width, image.height) > 20) {
          throw new TelegramError('Screenshot exceeds Telegram photo limits. Use a smaller desktop window and request a new screenshot.')
        }
        const form = new FormData()
        form.set('chat_id', config.chatId)
        form.set('photo', new Blob([bytes], { type: 'image/png' }), 'screenshot.png')
        await this.api('sendPhoto', form, signal, config)
        sent++
        this.photosSent++
      }
      this.deliveryError = ''; this.state.error = ''
      return { sent: true, photos: sent, incomplete: result.errors.length > 0 }
    } catch (error) {
      // Capture/provider errors can contain private content. Only expose safe delivery errors.
      this.deliveryError = `${error instanceof TelegramError ? error.message : 'Screenshot capture failed. Check screenshot permissions and the desktop window in Budget Terminal Settings.'} ${sent} photos confirmed sent. Do not resend automatically.`
      this.state.error = this.deliveryError
      throw new TelegramError(this.deliveryError)
    } finally { this.sending = false }
  }
  private async showModelPicker(signal: AbortSignal) {
    this.modelPicker = null
    if (!this.options.models) throw new Error('Model choices are unavailable.')
    const models = await this.options.models()
    if (!models.length) { await this.send('No models are available. Check Codex in the desktop app.', signal); return }
    await this.showPicker('Choose a model below. Next, choose its reasoning level.', models, 'model', signal)
  }
  private async showPicker(text: string, choices: TelegramPickerChoice[], kind: 'model' | 'reasoning', signal: AbortSignal, modelId?: string) {
    const picker = { nonce: randomBytes(12).toString('hex'), choices, kind, modelId, expiresAt: Date.now() + 5 * 60_000, messageId: undefined as number | undefined }
    const result = await this.send(text, signal, {
      inline_keyboard: choices.map((choice, index) => [{ text: formatTelegramText(`${choice.name || choice.id}${choice.current ? ' (current)' : ''}`), callback_data: `m:${picker.nonce}:${index}` }]),
    })
    picker.messageId = result.messageId
    this.modelPicker = picker
  }
  private async selectModel(query: NonNullable<Update['callback_query']>, signal: AbortSignal) {
    const config = this.config!
    const message = query.message
    if (query.from.is_bot || String(query.from.id) !== config.chatId || message?.chat.type !== 'private' || String(message.chat.id) !== config.chatId) return
    const picker = this.modelPicker
    const match = /^m:([a-f\d]{24}):(\d+)$/.exec(query.data ?? '')
    const choice = match && picker?.nonce === match[1] ? picker.choices[Number(match[2])] : undefined
    if (!picker || !choice || !picker.messageId || message.message_id !== picker.messageId || Date.now() > picker.expiresAt) {
      await this.api('answerCallbackQuery', { callback_query_id: query.id, text: 'This menu has expired. Send /model for new buttons.' }, signal)
      return
    }
    this.modelPicker = null
    await this.api('answerCallbackQuery', { callback_query_id: query.id, text: picker.kind === 'model' ? 'Selecting model.' : 'Selecting reasoning.' }, signal)
    try {
      if (!this.options.command || !this.options.models) throw new Error('Model selection unavailable.')
      if (picker.kind === 'model') {
        await this.options.command('model', choice.id)
        const selected = (await this.options.models()).find(model => model.id === choice.id && model.current)
        if (!selected) throw new Error('Model selection could not be verified.')
        await this.showPicker(`Model: ${selected.name || selected.id}. Choose its reasoning level below.`, selected.reasoning, 'reasoning', signal, selected.id)
      } else {
        const selected = (await this.options.models()).find(model => model.id === picker.modelId && model.current)
        if (!selected?.reasoning.some(mode => mode.id === choice.id)) throw new Error('Reasoning selection is no longer valid.')
        const result = await this.options.command('reasoning', choice.id)
        await this.send(result.slice(0, 20_000), signal)
      }
    } catch { await this.send('Could not complete model and reasoning selection. Check Codex in the desktop app, then send /model to try again.', signal) }
    try { await this.api('editMessageReplyMarkup', { chat_id: config.chatId, message_id: picker.messageId, reply_markup: { inline_keyboard: [] } }, signal) }
    catch { /* Consumed tokens remain invalid even if Telegram cannot remove the buttons. */ }
  }
  private async poll(signal: AbortSignal) {
    let failures = 0
    while (!signal.aborted) {
      try {
        const config = this.config!
        const updates = await this.api<Update[]>('getUpdates', { offset: config.offset, timeout: 25, limit: 10, allowed_updates: ['message', 'callback_query'] }, signal)
        this.state.connected = true; this.state.error = this.deliveryError; failures = 0
        for (const update of updates) {
          if (signal.aborted) return
          if (update.update_id < config.offset) continue
          // Persist acknowledgement before dispatch: never replay a remote action after restart.
          config.offset = update.update_id + 1
          await this.options.save(config)
          if (update.callback_query) { await this.selectModel(update.callback_query, signal); continue }
          const message = update.message
          if (!message || message.chat.type !== 'private' || String(message.chat.id) !== config.chatId || String(message.from?.id) !== config.chatId || message.from?.is_bot) continue
          if (Date.now() / 1000 - message.date > 300) continue
          let text = message.text?.trim()
          if (!text) { await this.send('Text messages are supported. Send your research question as text.', signal); continue }
          if (text.startsWith('/')) {
            const match = /^\/([a-z_]+)(?:@([a-z\d_]+))?(?:\s+([\s\S]*))?$/i.exec(text)
            if (match?.[2] && match[2].toLowerCase() !== this.state.bot.toLowerCase()) continue
            const command = match?.[1].toLowerCase()
            const argument = match?.[3]?.trim() ?? ''
            if (command === 'start') { await this.send(help, signal); continue }
            if (command === 'new') {
              this.modelPicker = null
              try { await this.options.reset() }
              catch { await this.send('Could not confirm a new chat. Check local history and Codex in the desktop app.', signal); continue }
              await this.send('Started a new Telegram conversation without previous conversation context. Old chats remain in desktop Agents History.', signal)
              if (!argument) continue
              text = argument
            } else if (command === 'model') {
              try {
                await this.showModelPicker(signal)
              }
              catch { await this.send('Telegram command could not complete. Check Codex and local history in the desktop app. No research request was sent.', signal) }
              continue
            } else { await this.send('Available commands: /new, /model. Ask naturally for a screenshot of a page.', signal); continue }
          }
          await this.api('sendChatAction', { chat_id: config.chatId, action: 'typing' }, signal)
          const photosBeforeReply = this.photosSent
          let reply: string
          try { reply = await this.options.reply(text, signal) }
          catch {
            if (signal.aborted) return
            if (this.photosSent === photosBeforeReply) await this.send('Budget Terminal could not complete this research request. Check Codex sign-in and connectivity in the desktop app, then send a new request.', signal)
            this.state.error = 'Telegram research failed. Check Codex sign-in and connectivity.'
            continue
          }
          // A screenshot response is photo-only, even if the model writes a delivery summary.
          if (!signal.aborted && this.photosSent === photosBeforeReply) await this.send(reply.slice(0, 20_000), signal)
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
  async close() { this.modelPicker = null; this.controller.abort(); await this.loop; this.loop = null; this.state.connected = false }
}
