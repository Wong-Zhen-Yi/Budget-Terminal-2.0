import { z } from 'zod'

export const MAX_AGENT_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_AGENT_IMAGES = 4
export const agentImageSchema = z.object({ name: z.string().trim().min(1).max(200), dataUrl: z.string().max(Math.ceil(MAX_AGENT_IMAGE_BYTES * 4 / 3) + 100) }).strict()

/** Accept image bytes only; never treat an attachment as a URL or local file path. */
export function validateAgentImages(input: unknown) {
  const images = z.array(agentImageSchema).max(MAX_AGENT_IMAGES).parse(input)
  let total = 0
  for (const image of images) {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl)
    if (!match) throw new Error('Attach PNG, JPEG or WebP images, not links or local paths.')
    const bytes = Buffer.from(match[2], 'base64')
    if (!bytes.length || bytes.length > MAX_AGENT_IMAGE_BYTES || bytes.toString('base64') !== match[2]) throw new Error('Each image must contain valid image data and be at most 8 MB.')
    const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
    if (!valid) throw new Error('The image contents do not match its format. Use a PNG, JPEG or WebP screenshot.')
    total += bytes.length
  }
  if (total > 20 * 1024 * 1024) throw new Error('Attachments must total at most 20 MB per message.')
  return images
}
