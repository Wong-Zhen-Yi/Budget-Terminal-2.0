import { createHash, randomInt, randomUUID, X509Certificate } from 'node:crypto'
import { createSocket, type Socket } from 'node:dgram'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createServer, request, type Server } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { hostname, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import type { TLSSocket } from 'node:tls'
import { generate } from 'selfsigned'
import { z } from 'zod'
import type { Envelope } from '../shared/contract.js'
import type { LocalSendAction, LocalSendDevice, LocalSendStatus } from '../shared/localSend.js'
import { describeError, failed, ok } from '../shared/envelope.js'
import { snapshotHash, validateSyncSnapshot, type SyncSnapshot } from './syncSnapshot.js'

const GROUP = '224.0.0.167'
const DISCOVERY_PORT = 53317
const MAX_BYTES = 20 * 1024 * 1024
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
const fingerprint = (value: string) => value.replaceAll(':', '').toLowerCase()
const portSchema = z.number().int().min(1024).max(65535)
const infoSchema = z.object({
  alias: z.string().min(1).max(100), version: z.string().startsWith('2.'),
  fingerprint: z.string().regex(/^[a-fA-F0-9:]{64,95}$/),
  port: portSchema, protocol: z.enum(['http', 'https']), budgetTerminal: z.boolean().optional(),
})
const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('enable'), enabled: z.boolean(), port: portSchema.optional() }),
  z.object({ type: z.literal('discover') }),
  z.object({ type: z.literal('connect'), address: z.string(), port: portSchema }),
  z.object({ type: z.literal('openPairing') }),
  z.object({ type: z.literal('pair'), fingerprint: z.string(), code: z.string().regex(/^\d{6}$/) }),
  z.object({ type: z.literal('forget'), fingerprint: z.string() }),
  z.object({ type: z.literal('sync') }),
  z.object({ type: z.literal('resolve'), id: z.string(), accept: z.boolean() }),
])

export function isLocalSendAddress(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part, i) => !/^\d{1,3}$/.test(address.split('.')[i]) || part < 0 || part > 255)) return false
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 169 && parts[1] === 254)
}

interface Peer extends LocalSendDevice { baseHash: string }
interface Pending { id: string; alias: string; exportedAt: string; receivedAt: number; sender: string; hash: string }
interface Config {
  enabled: boolean; port: number; alias: string; cert: string; key: string
  peers: Peer[]; pending?: Pending; recoveryPath?: string
}
interface Session {
  id: string; fileId: string; token: string; address: string; sender: string; alias: string
  size: number; sha256: string; baseHash?: string; expiresAt: number; uploading: boolean
}
export interface LocalSendAdapter {
  read(): Promise<SyncSnapshot>
  apply(snapshot: SyncSnapshot, expectedHash?: string): Promise<{ hash: string; recoveryPath: string; warning?: string }>
  onApplied(): void
}

/** LocalSend v2 discovery/upload plus authenticated Budget Terminal pairing and conflict checks. */
export class LocalSendSync {
  private config!: Config
  private server?: Server
  private udp?: Socket
  private timer?: ReturnType<typeof setInterval>
  private debounce?: ReturnType<typeof setTimeout>
  private devices = new Map<string, LocalSendDevice>()
  private seen = new Map<string, number>()
  private discoveryRequests = new Set<string>()
  private discoveryAttempts = new Map<string, number>()
  private lastAnnouncement = 0
  private session?: Session
  private pairing?: { code: string; expiresAt: number; attempts: number }
  private configQueue: Promise<void> = Promise.resolve()
  private actions: Promise<unknown> = Promise.resolve()
  private syncing?: Promise<void>
  private message?: string
  private error?: string
  private ownFingerprint = ''
  private stopping = false
  private requests = new Set<Promise<void>>()

  constructor(private directory: string, private adapter: LocalSendAdapter, private discovery = true) {}

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    try {
      this.config = JSON.parse(await readFile(join(this.directory, 'localsend.json'), 'utf8')) as Config
      if (typeof this.config.enabled !== 'boolean' || !portSchema.safeParse(this.config.port).success ||
        !Array.isArray(this.config.peers) || this.config.peers.length > 16 || !this.config.alias) throw new Error('Invalid LocalSend configuration')
      new X509Certificate(this.config.cert)
      for (const peer of this.config.peers) {
        infoSchema.parse({ ...peer, version: '2.0' })
        if (!isLocalSendAddress(peer.address) || peer.protocol !== 'https' || !/^[a-f0-9]{64}$/.test(peer.baseHash)) throw new Error('Invalid paired device')
      }
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
      const identity = await generate([{ name: 'commonName', value: 'Budget Terminal LocalSend' }], {
        algorithm: 'sha256', keySize: 2048,
        notAfterDate: new Date(Date.now() + 10 * 365 * 86400_000),
      })
      this.config = { enabled: false, port: DISCOVERY_PORT, alias: `Budget Terminal · ${hostname()}`.slice(0, 100), cert: identity.cert, key: identity.private, peers: [] }
      await this.saveConfig()
    }
    this.ownFingerprint = hash(new X509Certificate(this.config.cert).raw)
    if (this.config.enabled) await this.start().catch(error => { this.error = describeError(error) })
  }

  private saveConfig(): Promise<void> {
    const contents = JSON.stringify(this.config, null, 2)
    const run = this.configQueue.then(async () => {
      const target = join(this.directory, 'localsend.json')
      await writeFile(`${target}.tmp`, contents, { mode: 0o600 })
      await rename(`${target}.tmp`, target)
    })
    this.configQueue = run.catch(() => {})
    return run
  }

  private info() {
    return { alias: this.config.alias, version: '2.0', deviceModel: process.platform, deviceType: 'desktop',
      fingerprint: this.ownFingerprint, port: this.config.port, protocol: 'https' as const, budgetTerminal: true }
  }

  status(): Envelope<LocalSendStatus> {
    const addresses = Object.values(networkInterfaces()).flat().filter(entry => entry?.family === 'IPv4' && !entry.internal).map(entry => entry!.address)
    const devices = new Map(this.devices)
    for (const [id, seenAt] of this.seen) {
      if (Date.now() - seenAt > 120_000 && !this.config?.peers.some(peer => peer.fingerprint === id)) {
        this.devices.delete(id); devices.delete(id); this.seen.delete(id); this.discoveryAttempts.delete(id)
      }
    }
    for (const peer of this.config?.peers ?? []) devices.set(peer.fingerprint, { ...peer, paired: true })
    return ok({ enabled: this.config?.enabled ?? false, running: Boolean(this.server?.listening),
      alias: this.config?.alias ?? 'Budget Terminal', port: this.config?.port ?? DISCOVERY_PORT, addresses,
      pairingCode: this.pairing && this.pairing.expiresAt > Date.now() ? this.pairing.code : undefined,
      pairingExpiresAt: this.pairing?.expiresAt, devices: [...devices.values()],
      pending: this.config?.pending, recoveryPath: this.config?.recoveryPath, message: this.message, error: this.error,
    }, 'LocalSend sync')
  }

  action(input: LocalSendAction): Promise<Envelope<LocalSendStatus>> {
    const run = this.actions.then(async () => {
      try {
        const action = actionSchema.parse(input)
        this.error = undefined
        if (action.type === 'enable') {
          await this.stop()
          this.config.enabled = action.enabled
          if (action.port) this.config.port = action.port
          await this.saveConfig()
          if (action.enabled) await this.start()
        } else if (action.type === 'forget') {
          this.config.peers = this.config.peers.filter(peer => peer.fingerprint !== action.fingerprint)
          await this.saveConfig()
          this.message = 'Device unpaired. Unpair it on the other device too.'
        } else if (!this.server?.listening) throw new Error('Enable LocalSend sync first.')
        else if (action.type === 'openPairing') {
          this.pairing = { code: String(randomInt(100000, 1000000)), expiresAt: Date.now() + 120_000, attempts: 0 }
          this.message = 'Pairing is open for two minutes. Enter this code on the device whose data you want to use.'
        } else if (action.type === 'discover') this.announce(true)
        else if (action.type === 'connect') {
          if (!isLocalSendAddress(action.address)) throw new Error('Enter a private LAN IPv4 address.')
          const target: LocalSendDevice = { address: action.address, port: action.port, protocol: 'https', fingerprint: '', alias: '', budgetTerminal: false }
          const reply = await this.call(target, '/api/localsend/v2/register', this.info())
          this.remember(reply.body, target.address, target.port, reply.fingerprint)
        } else if (action.type === 'pair') {
          const device = this.devices.get(action.fingerprint)
          if (!device?.budgetTerminal || device.protocol !== 'https') throw new Error('Choose another Budget Terminal device.')
          const reply = await this.call(device, `/api/budget-terminal/pair?pin=${action.code}`, this.info())
          const baseHash = z.object({ baseHash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(reply.body).baseHash
          this.addPeer(device, baseHash)
          await this.saveConfig()
          this.message = `Paired with ${device.alias}. Sending this device's data.`
          await this.syncNow()
        } else if (action.type === 'sync') await this.syncNow()
        else if (action.type === 'resolve') await this.resolve(action.id, action.accept)
        return this.status()
      } catch (error) {
        this.error = describeError(error)
        return failed(this.status().data, this.error, 'LocalSend sync')
      }
    })
    this.actions = run.catch(() => {})
    return run
  }

  private addPeer(device: LocalSendDevice, baseHash: string): void {
    const existing = this.config.peers.find(peer => peer.fingerprint === device.fingerprint)
    if (existing) Object.assign(existing, device, { baseHash })
    else {
      if (this.config.peers.length >= 16) throw new Error('Unpair a device before adding another (maximum 16).')
      this.config.peers.push({ ...device, baseHash })
    }
  }

  private remember(value: unknown, address: string, fallbackPort = DISCOVERY_PORT, certified?: string): LocalSendDevice | undefined {
    const parsed = infoSchema.safeParse(value && typeof value === 'object' ? { port: fallbackPort, protocol: 'https', ...value } : value)
    if (!parsed.success || !isLocalSendAddress(address)) return
    const id = certified || fingerprint(parsed.data.fingerprint)
    if (id === this.ownFingerprint) return
    const device: LocalSendDevice = { fingerprint: id, address, port: parsed.data.port,
      protocol: parsed.data.protocol, alias: parsed.data.alias, budgetTerminal: parsed.data.budgetTerminal === true }
    if (this.devices.size >= 64 && !this.devices.has(id)) return
    this.devices.set(id, device)
    this.seen.set(id, Date.now())
    // Address changes become trusted only after a TLS handshake matches the saved identity.
    const peer = certified && this.config.peers.find(entry => entry.fingerprint === id)
    if (peer) Object.assign(peer, { address, port: device.port, alias: device.alias })
    return device
  }

  private async start(): Promise<void> {
    this.stopping = false
    const server = createServer({ cert: this.config.cert, key: this.config.key, requestCert: true, rejectUnauthorized: false },
      (req, res) => {
        const run = this.route(req, res).catch(error => this.respond(res, error instanceof HttpError ? error.code : 400, { message: describeError(error) }))
        this.requests.add(run)
        void run.finally(() => this.requests.delete(run))
      })
    server.requestTimeout = 30_000
    server.headersTimeout = 10_000
    server.maxConnections = 16
    server.on('error', error => { this.error = describeError(error) })
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.config.port, '0.0.0.0', () => { server.removeListener('error', reject); resolve() })
    }).catch(error => { this.server = undefined; throw new Error(`LocalSend could not listen on port ${this.config.port}: ${describeError(error)}. Choose a different port if LocalSend is already running.`) })
    if (this.discovery) {
      const udp = createSocket({ type: 'udp4', reuseAddr: true })
      this.udp = udp
      udp.on('error', error => { this.error = `Device discovery: ${describeError(error)}. Connect by IP address instead.` })
      udp.on('message', (bytes, remote) => {
        if (bytes.length > 4096) return
        try {
          const value = JSON.parse(bytes.toString())
          const device = this.remember(value, remote.address)
          if (device && value.announce === true) {
            this.announce(false)
            if (device.protocol === 'https' && this.discoveryRequests.size < 8 && !this.discoveryRequests.has(device.fingerprint) &&
              Date.now() - (this.discoveryAttempts.get(device.fingerprint) ?? 0) > 10_000) {
              this.discoveryRequests.add(device.fingerprint)
              this.discoveryAttempts.set(device.fingerprint, Date.now())
              void this.call(device, '/api/localsend/v2/register', this.info())
                .then(reply => this.remember(reply.body, remote.address, device.port, reply.fingerprint)).catch(() => {})
                .finally(() => this.discoveryRequests.delete(device.fingerprint))
            }
          }
        } catch { /* Ignore unrelated multicast packets. */ }
      })
      udp.bind(DISCOVERY_PORT, () => {
        try { udp.addMembership(GROUP); udp.setMulticastTTL(1); this.announce(true) }
        catch (error) { this.error = `Device discovery: ${describeError(error)}. Connect by IP address instead.` }
      })
    }
    this.timer = setInterval(() => { this.announce(true); void this.syncNow() }, 30_000)
    this.scheduleSync()
  }

  private announce(announce: boolean): void {
    if (!this.udp) return
    if (!announce && Date.now() - this.lastAnnouncement < 1000) return
    this.lastAnnouncement = Date.now()
    try { this.udp.send(Buffer.from(JSON.stringify({ ...this.info(), announce })), DISCOVERY_PORT, GROUP) }
    catch (error) { this.error = describeError(error) }
  }

  scheduleSync(): void {
    if (!this.server?.listening || this.stopping) return
    clearTimeout(this.debounce)
    this.debounce = setTimeout(() => { void this.syncNow() }, 750)
  }

  private async call(device: LocalSendDevice, path: string, value: unknown) {
    if (!isLocalSendAddress(device.address) || device.protocol !== 'https') throw new Error('Sync requires an encrypted connection to a private LAN address.')
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))
    return new Promise<{ body: unknown; fingerprint: string }>((resolve, reject) => {
      const req = request({ hostname: device.address, port: device.port, path, method: 'POST',
        cert: this.config.cert, key: this.config.key, rejectUnauthorized: false, agent: false,
        headers: { 'content-type': Buffer.isBuffer(value) ? 'application/octet-stream' : 'application/json', 'content-length': bytes.length },
      }, res => {
        void readBody(res, 256 * 1024).then(data => {
          const body = data.length ? JSON.parse(data.toString()) as unknown : {}
          if (!res.statusCode || res.statusCode >= 300) {
            const message = z.object({ message: z.string() }).safeParse(body)
            throw new Error(message.success ? message.data.message : `LocalSend returned HTTP ${res.statusCode}.`)
          }
          resolve({ body, fingerprint: remoteFingerprint })
        }).catch(reject)
      })
      let remoteFingerprint = ''
      req.on('socket', socket => {
        const tls = socket as TLSSocket
        tls.once('secureConnect', () => {
          const raw = tls.getPeerCertificate().raw
          remoteFingerprint = raw ? hash(raw) : ''
          if (!remoteFingerprint || (device.fingerprint && fingerprint(device.fingerprint) !== remoteFingerprint)) {
            req.destroy(new Error('Device certificate changed. Unpair and verify this device again.'))
          } else req.end(bytes)
        })
      })
      const timeout = setTimeout(() => req.destroy(new Error(`${device.alias || device.address} did not respond. Sync will retry when it is available.`)), 15_000)
      req.on('close', () => clearTimeout(timeout))
      req.on('error', reject)
    })
  }

  private respond(res: ServerResponse, code: number, body: unknown = {}): void {
    if (res.destroyed || res.writableEnded) return
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const address = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '')
    if (!isLocalSendAddress(address)) throw new HttpError(403, 'Only local network devices are allowed.')
    const url = new URL(req.url ?? '/', 'https://localhost')
    const raw = (req.socket as TLSSocket).getPeerCertificate().raw
    const sender = raw ? hash(raw) : ''
    if (req.method === 'GET' && url.pathname === '/api/localsend/v2/info') return this.respond(res, 200, this.info())
    if (req.method !== 'POST') throw new HttpError(404, 'Unknown LocalSend route.')
    if (url.pathname === '/api/localsend/v2/register') {
      this.remember(JSON.parse((await readBody(req, 4096)).toString()), address, DISCOVERY_PORT, sender)
      return this.respond(res, 200, this.info())
    }
    if (url.pathname === '/api/budget-terminal/pair') {
      this.checkPairing(url.searchParams.get('pin'))
      if (!sender) throw new HttpError(403, 'Pairing requires a device certificate.')
      const device = this.remember(JSON.parse((await readBody(req, 4096)).toString()), address, DISCOVERY_PORT, sender)
      if (!device?.budgetTerminal || device.protocol !== 'https') throw new HttpError(400, 'Pair with another Budget Terminal device.')
      const baseHash = snapshotHash(await this.adapter.read())
      this.addPeer(device, baseHash)
      await this.saveConfig()
      this.pairing = undefined
      this.message = `Paired with ${device.alias}. Waiting for its initial snapshot.`
      return this.respond(res, 200, { baseHash })
    }
    if (url.pathname === '/api/budget-terminal/state') {
      if (!this.config.peers.some(peer => peer.fingerprint === sender)) throw new HttpError(403, 'This device is not paired. Pair it again in Settings.')
      await readBody(req, 4096)
      return this.respond(res, 200, { hash: snapshotHash(await this.adapter.read()) })
    }
    if (url.pathname === '/api/localsend/v2/prepare-upload') {
      const peer = this.config.peers.find(entry => entry.fingerprint === sender)
      if (!peer) this.checkPairing(url.searchParams.get('pin'))
      if (this.config.pending || (this.session && this.session.expiresAt > Date.now())) throw new HttpError(409, 'Review the pending transfer before syncing again.')
      const body = z.object({ info: infoSchema, syncBaseHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
        files: z.record(z.string(), z.object({ id: z.string(), fileName: z.literal('budget-terminal-backup.json'), size: z.number().int().min(1).max(MAX_BYTES), sha256: z.string().regex(/^[a-fA-F0-9]{64}$/) })),
      }).parse(JSON.parse((await readBody(req, 16384)).toString()))
      const entries = Object.entries(body.files)
      if (entries.length !== 1 || entries[0][0] !== entries[0][1].id) throw new HttpError(400, 'Send one Budget Terminal snapshot.')
      const [fileId, file] = entries[0]
      this.session = { id: randomUUID(), fileId, token: randomUUID(), address, sender, alias: body.info.alias,
        size: file.size, sha256: file.sha256.toLowerCase(), baseHash: peer ? body.syncBaseHash : undefined, expiresAt: Date.now() + 60_000, uploading: false }
      return this.respond(res, 200, { sessionId: this.session.id, files: { [fileId]: this.session.token } })
    }
    if (url.pathname === '/api/localsend/v2/cancel') {
      if (this.session?.id === url.searchParams.get('sessionId') && this.session.address === address && this.session.sender === sender && !this.session.uploading) this.session = undefined
      return this.respond(res, 200)
    }
    if (url.pathname === '/api/localsend/v2/upload') {
      const session = this.session
      if (!session || session.uploading || session.expiresAt < Date.now() || session.address !== address || session.sender !== sender || session.id !== url.searchParams.get('sessionId') ||
        session.fileId !== url.searchParams.get('fileId') || session.token !== url.searchParams.get('token')) throw new HttpError(403, 'Invalid transfer token or sender.')
      session.uploading = true
      try {
        const bytes = await readBody(req, session.size)
        if (bytes.length !== session.size || hash(bytes) !== session.sha256) throw new HttpError(422, 'Snapshot checksum or size mismatch.')
        const snapshot = validateSyncSnapshot(JSON.parse(bytes.toString()))
        const peer = this.config.peers.find(entry => entry.fingerprint === sender)
        const current = snapshotHash(await this.adapter.read())
        const incoming = snapshotHash(snapshot)
        if (incoming === current) {
          if (peer) { peer.baseHash = current; peer.lastSyncedAt = Date.now(); peer.error = undefined; await this.saveConfig() }
          return this.respond(res, 200, { syncHash: current })
        }
        if (!peer || !session.baseHash || current !== session.baseHash || peer.baseHash !== session.baseHash) {
          await this.stage(snapshot, session)
          throw new HttpError(409, 'Both devices have changed or the sender is unpaired. Review the incoming snapshot in Settings.')
        }
        try {
          const result = await this.adapter.apply(snapshot, current)
          peer.baseHash = result.hash
          peer.lastSyncedAt = Date.now()
          peer.error = undefined
          this.config.recoveryPath = result.recoveryPath
          await this.saveConfig()
          this.message = result.warning ?? `Synced from ${session.alias}.`
          this.adapter.onApplied()
          this.scheduleSync()
          return this.respond(res, 200, { syncHash: result.hash })
        } catch (error) {
          await this.stage(snapshot, session)
          throw new HttpError(409, describeError(error))
        }
      } finally { this.session = undefined }
    }
    throw new HttpError(404, 'Unknown LocalSend route.')
  }

  private checkPairing(pin: string | null): void {
    if (!this.pairing || this.pairing.expiresAt < Date.now() || this.pairing.attempts >= 10) throw new HttpError(403, 'Open pairing in Settings on the receiving device.')
    this.pairing.attempts += 1
    if (pin !== this.pairing.code) throw new HttpError(401, 'PIN required or invalid pairing code.')
  }

  private async stage(snapshot: SyncSnapshot, session: Session): Promise<void> {
    await writeFile(join(this.directory, 'incoming.json'), JSON.stringify(snapshot), { mode: 0o600 })
    this.config.pending = { id: randomUUID(), alias: session.alias, exportedAt: snapshot.exportedAt, receivedAt: Date.now(), sender: session.sender, hash: snapshotHash(snapshot) }
    await this.saveConfig()
    this.message = 'Incoming data needs review. Automatic replacement is paused.'
  }

  private async resolve(id: string, accept: boolean): Promise<void> {
    const pending = this.config.pending
    if (!pending || pending.id !== id) throw new Error('That incoming snapshot is no longer available.')
    if (accept) {
      const snapshot = validateSyncSnapshot(JSON.parse(await readFile(join(this.directory, 'incoming.json'), 'utf8')))
      if (snapshotHash(snapshot) !== pending.hash) throw new Error('The staged snapshot has changed. Refuse it and sync again.')
      const result = await this.adapter.apply(snapshot)
      this.config.recoveryPath = result.recoveryPath
      const peer = this.config.peers.find(entry => entry.fingerprint === pending.sender)
      if (peer) { peer.baseHash = result.hash; peer.lastSyncedAt = Date.now(); peer.error = undefined }
      this.message = result.warning ?? 'Incoming snapshot applied. The previous data is saved in a recovery backup.'
      this.adapter.onApplied()
    } else this.message = 'Kept local data. The sender must accept this device’s snapshot to resolve the conflict.'
    this.config.pending = undefined
    await this.saveConfig()
    await rm(join(this.directory, 'incoming.json'), { force: true })
    this.scheduleSync()
  }

  private syncNow(): Promise<void> {
    if (this.syncing) return this.syncing
    if (!this.server?.listening || this.stopping || this.config.pending) return Promise.resolve()
    const run = (async () => {
      const snapshot = await this.adapter.read()
      const current = snapshotHash(snapshot)
      const bytes = Buffer.from(JSON.stringify(snapshot))
      if (bytes.length > MAX_BYTES) throw new Error('The snapshot exceeds the 20 MB transfer limit.')
      for (const peer of this.config.peers) {
        if (this.stopping) break
        try {
          // Poll unchanged peers too: this catches offline edits after reconnection and acknowledges conflict resolution.
          const reply = await this.call(peer, '/api/budget-terminal/state', this.info())
          const remoteHash = z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(reply.body).hash
          if (remoteHash === current) {
            peer.baseHash = current; peer.lastSyncedAt = Date.now(); peer.error = undefined
            continue
          }
          if (peer.baseHash === current) { peer.error = undefined; continue }
          const fileId = randomUUID()
          const prepared = await this.call(peer, '/api/localsend/v2/prepare-upload', {
            info: this.info(), syncBaseHash: peer.baseHash,
            files: { [fileId]: { id: fileId, fileName: 'budget-terminal-backup.json', size: bytes.length, fileType: 'application/json', sha256: hash(bytes) } },
          })
          const transfer = z.object({ sessionId: z.string(), files: z.record(z.string(), z.string()) }).parse(prepared.body)
          const token = transfer.files[fileId]
          if (!token) throw new Error('The receiving device rejected the snapshot.')
          const params = new URLSearchParams({ sessionId: transfer.sessionId, fileId, token })
          const uploaded = await this.call(peer, `/api/localsend/v2/upload?${params}`, bytes)
          peer.baseHash = z.object({ syncHash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(uploaded.body).syncHash
          peer.lastSyncedAt = Date.now()
          peer.error = undefined
          this.message = `Synced to ${peer.alias}.`
        } catch (error) { peer.error = describeError(error) }
      }
      await this.saveConfig()
    })().catch(error => { this.error = describeError(error) }).finally(() => { this.syncing = undefined })
    this.syncing = run
    return run
  }

  async stop(): Promise<void> {
    this.stopping = true
    clearTimeout(this.debounce)
    clearInterval(this.timer)
    this.pairing = undefined
    if (this.udp) { try { this.udp.close() } catch { /* Already closed. */ } this.udp = undefined }
    await this.syncing
    const server = this.server
    this.server = undefined
    if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() })
    await Promise.allSettled([...this.requests])
    this.session = undefined
    await this.configQueue
  }
}

class HttpError extends Error {
  constructor(readonly code: number, message: string) { super(message) }
}

async function readBody(message: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let length = 0
  const timer = setTimeout(() => message.destroy(new Error('LocalSend transfer timed out.')), 30_000)
  try {
    for await (const chunk of message) {
      const bytes = Buffer.from(chunk)
      length += bytes.length
      if (length > limit) throw new HttpError(400, 'Transfer is too large.')
      chunks.push(bytes)
    }
    return Buffer.concat(chunks)
  } finally { clearTimeout(timer) }
}
