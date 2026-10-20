import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AgentsService } from '../electron/services/agents.js'
import { AgentWorkspace } from '../electron/services/agentWorkspace.js'
import { AgentImageStore } from '../electron/services/agentImageStore.js'
import { agentMessageSchema } from '../electron/shared/agentWorkspace.js'
import type { CodexPacket, CodexTransport } from '../electron/services/codexClient.js'

const directory = await mkdtemp(join(tmpdir(), 'budget-agent-images-'))
const previous = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
process.env.APPDATA = directory
process.env.LOCALAPPDATA = directory
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const image = { name: 'Synthetic pixel.png', dataUrl: pixel }
const store = new AgentImageStore(join(directory, 'agent-images'))
const workspace = new AgentWorkspace({ path: join(directory, 'agents.json') })
let receive: (packet: CodexPacket) => void = () => {}
let thread = ''
const calls: Array<{ method: string; params: any }> = []
const transport: CodexTransport = {
  async start() {},
  async request(method, params) {
    calls.push({ method, params })
    if (method === 'account/read') return { account: {} }
    if (method === 'model/list') return { data: [{ model: 'fixture', displayName: 'Fixture', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Quick' }] }] }
    if (method === 'modelProvider/capabilities/read') return { imageGeneration: true }
    if (method === 'thread/start') { thread = randomUUID(); return { thread: { id: thread }, model: 'fixture' } }
    return {}
  },
  write() {}, close() {},
}
const service = new AgentsService({ executable: 'unused', cwd: directory, routes: new Map(), images: store, workspace,
  clientFactory: callback => { receive = callback; return transport } })
const event = (method: string, item?: NonNullable<NonNullable<CodexPacket['params']>['item']>) => receive({ method, params: { threadId: thread, item, turn: { status: 'completed' } } })
const wait = async (check: () => boolean) => {
  const until = Date.now() + 5000
  while (!check() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10))
  assert(check(), 'Timed out waiting for image lifecycle')
}
try {
  const saved = await store.save(image, 'uploaded')
  assert.deepEqual(await store.read(saved.id), image)
  for (const invalid of ['../../private', 'file:///private', 'https://example.com/a.png', '', 'not-an-id']) await assert.rejects(() => store.read(invalid))
  for (const dataUrl of ['https://example.com/pixel.png', 'file:///private/image.png', 'data:image/svg+xml;base64,PHN2Zz4=', pixel.replace('image/png', 'image/jpeg'), 'data:image/png;base64,aaaa']) await assert.rejects(() => store.save({ ...image, dataUrl }, 'generated'))
  const badId = randomUUID()
  await writeFile(join(directory, 'agent-images', `${badId}.json`), '{}')
  await assert.rejects(() => store.read(badId))
  await service.command({ type: 'connect' })
  assert.equal(service.snapshot().imageGeneration, true)
  assert(calls.find(call => call.method === 'thread/start')!.params.config['features.image_generation'])
  assert(calls.find(call => call.method === 'thread/start')!.params.baseInstructions.includes('num_last_images_to_include'))
  await service.command({ type: 'send', text: 'Generate a synthetic blue square' })
  event('item/started', { id: 'native-image', type: 'imageGeneration' })
  assert.equal(service.snapshot().messages.at(-1)?.imageStatus, 'generating')
  assert.equal(service.snapshot().activity, 'generating')
  event('item/completed', { id: 'native-image', type: 'imageGeneration', status: 'completed', result: pixel.split(',')[1] })
  event('item/completed', { id: 'native-image', type: 'imageGeneration', status: 'completed', result: pixel.split(',')[1] })
  event('turn/completed')
  await wait(() => !service.snapshot().busy)
  assert.equal(service.snapshot().activity, 'done')
  const generated = service.snapshot().messages.find(message => message.imageStatus === 'ready')!
  assert.equal(generated.imageArtifacts?.length, 1, 'Duplicate completed events must not save duplicate images')
  assert.equal(generated.imageArtifacts![0].kind, 'generated')
  assert.deepEqual(await service.image(generated.imageArtifacts![0].id), { name: 'Generated image.png', dataUrl: pixel })
  assert(!JSON.stringify(service.snapshot()).includes('base64'), 'No image bytes in status polling/history metadata')
  assert(agentMessageSchema.safeParse(generated).success)
  await assert.rejects(() => service.image(saved.id), /current chat/)
  const generatedId = generated.imageArtifacts![0].id
  await service.command({ type: 'send', text: 'Change this to red', images: [await service.image(generatedId)] })
  assert.equal(calls.at(-1)!.params.input[1].url, pixel, 'Edits send actual pixels as native image inputs')
  event('turn/completed')
  const uploaded = service.snapshot().messages.find(message => message.role === 'user' && message.imageArtifacts?.length)!
  assert.equal(uploaded.imageArtifacts![0].kind, 'uploaded')
  assert.equal((await service.image(uploaded.imageArtifacts![0].id)).dataUrl, pixel)
  await workspace.flush()
  const previousChat = service.snapshot().currentChatId!
  await service.command({ type: 'newChat' })
  await service.command({ type: 'openChat', id: previousChat })
  assert.equal((await service.image(generatedId)).dataUrl, pixel, 'Saved chat image survives reopening')
  await service.command({ type: 'send', text: 'Generate again' })
  event('item/completed', { id: 'quota', type: 'imageGeneration', status: 'failed', failure: { type: 'usageLimitExceeded', resetsAt: 1800000000 } })
  event('turn/completed'); await wait(() => !service.snapshot().busy)
  assert.equal(service.snapshot().activity, 'error', 'Image failures must not show Done')
  assert(service.snapshot().messages.some(message => message.imageStatus === 'failed' && message.text.includes('allowance exceeded') && message.text.includes('Resets at')))
  for (const result of ['https://example.com/private.png', 'file:///private.png', 'data:image/svg+xml;base64,PHN2Zz4=']) {
    await service.command({ type: 'send', text: 'Bad provider fixture' })
    event('item/completed', { id: randomUUID(), type: 'imageGeneration', status: 'completed', result })
    event('turn/completed'); await wait(() => !service.snapshot().busy)
    assert.equal(service.snapshot().messages.at(-1)?.imageStatus, 'failed', 'Native result must contain bounded raster bytes, not paths/URLs/SVG')
  }
  await service.command({ type: 'autonomy', enabled: true, objective: 'Research only', runs: 1 })
  assert.equal(calls.filter(call => call.method === 'thread/start').at(-1)!.params.config['features.image_generation'], false, 'Autonomous runs do not expose native image generation')
  event('turn/completed')
  await service.command({ type: 'send', text: 'Manual images again' })
  assert.equal(calls.filter(call => call.method === 'thread/start').at(-1)!.params.config['features.image_generation'], true)
  event('item/started', { id: 'interrupted', type: 'imageGeneration' })
  await service.command({ type: 'stop' })
  assert.equal(service.snapshot().messages.at(-2)?.imageStatus, 'failed', 'Stop marks pending generation as interrupted')
  event('item/completed', { id: 'interrupted', type: 'imageGeneration', status: 'completed', result: pixel.split(',')[1] })
  assert(!service.snapshot().messages.at(-2)?.imageArtifacts, 'Late native results after Stop cannot revive images')
  await service.command({ type: 'connect' })
  await service.command({ type: 'send', text: 'Delayed image save fixture' })
  const originalSave = store.save.bind(store)
  let releaseSave!: () => void
  const saveGate = new Promise<void>(resolve => { releaseSave = resolve })
  let cancelledId = ''
  store.save = async (...args) => {
    await saveGate
    const result = await originalSave(...args)
    cancelledId = result.id
    return result
  }
  event('item/completed', { id: 'delayed-save', type: 'imageGeneration', status: 'completed', result: pixel.split(',')[1] })
  await service.command({ type: 'stop' })
  releaseSave()
  await wait(() => !!cancelledId)
  await new Promise(resolve => setTimeout(resolve, 30))
  await assert.rejects(() => store.read(cancelledId), 'Cancellation must clean up a late saved artifact')
  store.save = originalSave
  await service.command({ type: 'connect' })
  await service.command({ type: 'send', text: 'Bounded image tool fixture' })
  for (let index = 0; index < 5; index++) event('item/started', { id: 'limit-' + index, type: 'imageGeneration' })
  assert.match(service.snapshot().error, /4-image/)
  await service.command({ type: 'newChat' })
  await service.command({ type: 'deleteChat', id: previousChat })
  await assert.rejects(() => store.read(generatedId), 'Deleting a chat removes unshared app image artifacts')
  const quotaDirectory = join(directory, 'quota')
  await mkdir(quotaDirectory)
  await Promise.all(Array.from({ length: 1000 }, () => writeFile(join(quotaDirectory, `${randomUUID()}.json`), '{}')))
  await assert.rejects(() => new AgentImageStore(quotaDirectory).save(image, 'generated'), /1000 images/)
  console.log('PASS: native generation/edit inputs, capability discovery, in-chat artifacts, private bounded storage, saved/reopened images, deletion, no pixels in snapshots, duplicate/failed/quota/invalid outputs, read-only autonomy, manual tool restoration, cancellation and late-event isolation')

  if (process.argv.includes('--live')) {
    const executable = process.env.BUDGET_TERMINAL_CODEX_PATH ?? (process.platform === 'win32' ? join(previous.LOCALAPPDATA!, 'Programs/OpenAI/Codex/bin/codex.exe') : 'codex')
    const live = new AgentsService({ executable, cwd: directory, routes: new Map(), images: new AgentImageStore(join(directory, 'live-images')) })
    const completeLive = async () => {
      const until = Date.now() + 5 * 60_000
      while (live.snapshot().busy && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 200))
      assert(!live.snapshot().busy, 'Live image run timed out')
      assert.equal(live.snapshot().error, '')
      const last = [...live.snapshot().messages].reverse().find(message => message.imageStatus)
      assert.equal(last?.imageStatus, 'ready', last?.text || live.snapshot().messages.map(message => message.text).join('\n'))
      return last!.imageArtifacts![0]
    }
    try {
      await live.command({ type: 'connect' })
      assert(live.snapshot().connected, live.snapshot().error)
      assert.notEqual(live.snapshot().imageGeneration, false, 'This provider cannot generate images')
      await live.command({ type: 'send', text: 'Image generation integration test. Use the native image_gen tool to generate one simple blue circle centered on a plain white background, no text. Do not use shell tools or files. The app displays the native result automatically.' })
      const first = await completeLive()
      const pixels = await live.image(first.id)
      assert(pixels.dataUrl.startsWith('data:image/png;base64,'))
      console.log('PASS: real signed-in Codex native image generation and private image retrieval')
      await live.command({ type: 'send', text: 'Edit this attached synthetic image using the native image_gen tool with num_last_images_to_include=1: change the blue circle to red. Keep the background white. Return one edited image.', images: [pixels] })
      const edited = await completeLive()
      assert.notEqual((await live.image(edited.id)).dataUrl, pixels.dataUrl, 'Edited result must differ from original')
      console.log('PASS: real Codex native image editing using reattached generated pixels')
    } finally { live.close() }
  }
} finally {
  service.close()
  await workspace.close()
  process.env.APPDATA = previous.APPDATA
  process.env.LOCALAPPDATA = previous.LOCALAPPDATA
  assert(directory.startsWith(join(tmpdir(), 'budget-agent-images-')))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
