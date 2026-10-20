import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { agentImageArtifactSchema } from '../shared/agentImageArtifacts.js'
import type { AgentImageArtifact } from '../shared/agentImageArtifacts.js'
import type { AgentImage } from '../shared/agents.js'
import { agentWorkspacePath } from './agentWorkspace.js'
import { agentImageSchema, decodeAgentImage, MAX_AGENT_IMAGE_BYTES } from './agentImages.js'

const MAX_FILE_BYTES = Math.ceil(MAX_AGENT_IMAGE_BYTES * 4 / 3) + 2048
const MAX_STORE_BYTES = 512 * 1024 * 1024
const MAX_STORE_IMAGES = 1000
const imageId = agentImageArtifactSchema.shape.id

/** Private, bounded raster artifacts. IDs only cross the status/history boundary. */
export class AgentImageStore {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private directory = join(dirname(agentWorkspacePath()), 'agent-images')) {}

  save(image: AgentImage, kind: AgentImageArtifact['kind']): Promise<AgentImageArtifact> {
    const task = this.queue.then(async () => {
      const value = agentImageSchema.parse(image)
      decodeAgentImage(value.dataUrl)
      const artifact = agentImageArtifactSchema.parse({ id: randomUUID(), name: value.name, kind })
      const payload = JSON.stringify(value)
      const length = Buffer.byteLength(payload)
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      if (!(await lstat(this.directory)).isDirectory()) throw new Error('Image storage must be a private directory, not a link.')
      const files = (await readdir(this.directory)).filter(file => /^[0-9a-f-]{36}\.json$/.test(file))
      if (files.length >= MAX_STORE_IMAGES) throw new Error('Chat image storage is full (1000 images). Delete old chats to free space.')
      let total = 0
      for (const file of files) total += (await lstat(join(this.directory, file))).size
      if (total + length > MAX_STORE_BYTES) throw new Error('Chat image storage is full (512 MB). Delete old chats to free space.')
      const path = join(this.directory, `${artifact.id}.json`)
      const temporary = `${path}.tmp`
      try {
        await writeFile(temporary, payload, { flag: 'wx', mode: 0o600 })
        await rename(temporary, path)
      } catch (error) { await rm(temporary, { force: true }).catch(() => {}); throw error }
      return artifact
    })
    this.queue = task.catch(() => {})
    return task
  }

  async read(id: string): Promise<AgentImage> {
    imageId.parse(id)
    const path = join(this.directory, `${id}.json`)
    const stats = await lstat(path)
    if (!stats.isFile() || stats.size > MAX_FILE_BYTES) throw new Error('The saved chat image is invalid or too large.')
    const image = agentImageSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    decodeAgentImage(image.dataUrl)
    return image
  }

  async remove(id: string) {
    imageId.parse(id)
    await rm(join(this.directory, `${id}.json`), { force: true })
  }
}
