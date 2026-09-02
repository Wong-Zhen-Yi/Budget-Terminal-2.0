// Renders the chart-pattern cheat sheet to PNG examples on disk.
//
//   npm run patterns:png            # 3 examples per pattern plus an overview sheet
//   npm run patterns:png -- --check # regenerate into a temp dir and diff, no writes
//
// The rasterizer is hand-rolled on node:zlib for the same reason services/etf/xlsx.ts
// is: one output format does not justify a dependency, and a PNG is a zlib stream of
// filtered scanlines wrapped in four chunks. Geometry comes from the same
// layoutPattern() the on-screen SVG uses, so a PNG cannot disagree with the app.

import { deflateSync } from 'node:zlib'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CHART_PATTERN_CATALOG, type ChartPattern } from '../electron/shared/chartPatterns.js'
import { layoutPattern, type ChartPatternExample } from '../electron/shared/patternCandles.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = join(HERE, '..', 'docs', 'chart-patterns')

type Rgb = [number, number, number]

const COLORS = {
  background: hex('#0d1420'),
  panel: hex('#080b12'),
  grid: hex('#141d2c'),
  border: hex('#1e2b3f'),
  up: hex('#26c281'),
  down: hex('#f0554e'),
  guide: hex('#7d8ea6'),
  breakout: hex('#d6b25e'),
  text: hex('#d5dee9'),
  dim: hex('#56677f'),
  bullish: hex('#26c281'),
  bearish: hex('#f0554e'),
  neutral: hex('#d6b25e'),
} satisfies Record<string, Rgb>

function hex(value: string): Rgb {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ]
}

// --- a 3x5 bitmap font, one row string per scanline ------------------------

const GLYPHS: Record<string, string[]> = {
  A: ['010', '101', '111', '101', '101'],
  B: ['110', '101', '110', '101', '110'],
  C: ['011', '100', '100', '100', '011'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'],
  F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  J: ['001', '001', '001', '101', '010'],
  K: ['101', '101', '110', '101', '101'],
  L: ['100', '100', '100', '100', '111'],
  M: ['1001', '1111', '1111', '1001', '1001'],
  N: ['1001', '1101', '1111', '1011', '1001'],
  O: ['010', '101', '101', '101', '010'],
  P: ['110', '101', '110', '100', '100'],
  Q: ['010', '101', '101', '111', '011'],
  R: ['110', '101', '110', '101', '101'],
  S: ['011', '100', '010', '001', '110'],
  T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '011'],
  V: ['101', '101', '101', '101', '010'],
  W: ['1001', '1001', '1111', '1111', '0110'],
  X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'],
  Z: ['111', '001', '010', '100', '111'],
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['110', '001', '010', '100', '111'],
  '3': ['110', '001', '010', '001', '110'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '110', '001', '110'],
  '6': ['011', '100', '110', '101', '010'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['010', '101', '010', '101', '010'],
  '9': ['010', '101', '011', '001', '110'],
  ' ': ['000', '000', '000', '000', '000'],
  '.': ['000', '000', '000', '000', '010'],
  ',': ['000', '000', '000', '010', '100'],
  '-': ['000', '000', '111', '000', '000'],
  ':': ['000', '010', '000', '010', '000'],
  '/': ['001', '001', '010', '100', '100'],
  '&': ['010', '101', '010', '101', '011'],
  '(': ['001', '010', '010', '010', '001'],
  ')': ['100', '010', '010', '010', '100'],
  '%': ['101', '001', '010', '100', '101'],
}

/** The font is uppercase-only; the dashes a caption carries are folded onto '-'. */
function normalizeText(value: string): string {
  return value.toUpperCase().replace(/[‐-―]/g, '-').replace(/[‘’]/g, "'")
}

class Surface {
  readonly width: number
  readonly height: number
  private readonly pixels: Uint8Array

  constructor(width: number, height: number, background: Rgb) {
    this.width = width
    this.height = height
    this.pixels = new Uint8Array(width * height * 3)
    this.rect(0, 0, width, height, background)
  }

  set(x: number, y: number, color: Rgb): void {
    const px = Math.round(x)
    const py = Math.round(y)
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return
    const offset = (py * this.width + px) * 3
    this.pixels[offset] = color[0]
    this.pixels[offset + 1] = color[1]
    this.pixels[offset + 2] = color[2]
  }

  rect(x: number, y: number, width: number, height: number, color: Rgb): void {
    const left = Math.round(x)
    const top = Math.round(y)
    const right = Math.round(x + width)
    const bottom = Math.round(y + height)
    for (let py = top; py < bottom; py += 1) for (let px = left; px < right; px += 1) this.set(px, py, color)
  }

  line(x1: number, y1: number, x2: number, y2: number, color: Rgb, dash = 0): void {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))))
    for (let step = 0; step <= steps; step += 1) {
      if (dash > 0 && Math.floor(step / dash) % 2 === 1) continue
      const ratio = step / steps
      this.set(x1 + (x2 - x1) * ratio, y1 + (y2 - y1) * ratio, color)
    }
  }

  frame(x: number, y: number, width: number, height: number, color: Rgb): void {
    this.rect(x, y, width, 1, color)
    this.rect(x, y + height - 1, width, 1, color)
    this.rect(x, y, 1, height, color)
    this.rect(x + width - 1, y, 1, height, color)
  }

  text(x: number, y: number, value: string, color: Rgb, scale = 2): number {
    let cursor = Math.round(x)
    for (const character of normalizeText(value)) {
      const glyph = GLYPHS[character] ?? GLYPHS[' ']
      for (let row = 0; row < glyph.length; row += 1) {
        for (let column = 0; column < glyph[row].length; column += 1) {
          if (glyph[row][column] !== '1') continue
          this.rect(cursor + column * scale, y + row * scale, scale, scale, color)
        }
      }
      cursor += (glyph[0].length + 1) * scale
    }
    return cursor - x
  }

  textWidth(value: string, scale = 2): number {
    let width = 0
    for (const character of normalizeText(value)) {
      const glyph = GLYPHS[character] ?? GLYPHS[' ']
      width += (glyph[0].length + 1) * scale
    }
    return width
  }

  toPng(): Buffer {
    const stride = this.width * 3
    const raw = Buffer.alloc((stride + 1) * this.height)
    for (let row = 0; row < this.height; row += 1) {
      raw[row * (stride + 1)] = 0
      Buffer.from(this.pixels.buffer, row * stride, stride).copy(raw, row * (stride + 1) + 1)
    }
    const header = Buffer.alloc(13)
    header.writeUInt32BE(this.width, 0)
    header.writeUInt32BE(this.height, 4)
    header[8] = 8 // bit depth
    header[9] = 2 // truecolour
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ])
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

// --- drawing ---------------------------------------------------------------

/** Trim a line to the width it has. The font is fixed-width per glyph, so this is exact. */
function fit(surface: Surface, value: string, maxWidth: number, scale: number): string {
  if (surface.textWidth(value, scale) <= maxWidth) return value
  let text = value
  while (text.length > 1 && surface.textWidth(`${text}...`, scale) > maxWidth) text = text.slice(0, -1)
  return `${text.trimEnd()}...`
}

function biasColor(pattern: ChartPattern): Rgb {
  return pattern.bias === 'Bullish' ? COLORS.bullish : pattern.bias === 'Bearish' ? COLORS.bearish : COLORS.neutral
}

interface PlotOptions {
  x: number
  y: number
  width: number
  height: number
  labels: boolean
  scale: number
}

function drawPlot(surface: Surface, example: ChartPatternExample, options: PlotOptions): void {
  const { x, y, width, height } = options
  surface.rect(x, y, width, height, COLORS.background)
  surface.frame(x, y, width, height, COLORS.border)

  const layout = layoutPattern(example, {
    width,
    height,
    padTop: 10,
    padBottom: 10,
    padLeft: 8,
    padRight: options.labels ? 124 : 10,
    labelGap: 14,
  })

  for (const gridline of layout.gridlines) surface.rect(x + 1, y + gridline, width - 2, 1, COLORS.grid)

  for (const guide of layout.guides) {
    surface.line(x + guide.x1, y + guide.y1, x + guide.x2, y + guide.y2, COLORS.guide, 3)
    if (!options.labels) continue
    const labelX = x + guide.x2 + 6
    surface.text(labelX, y + guide.labelY - 5, guide.label, COLORS.guide, options.scale)
  }

  if (layout.breakout) {
    const markerX = x + layout.breakout.x
    surface.line(markerX, y + 4, markerX, y + height - 4, COLORS.breakout, 4)
    if (options.labels) {
      const text = layout.breakout.label
      const textX = Math.min(markerX + 4, x + width - surface.textWidth(text, options.scale) - 4)
      surface.text(textX, y + 6, text, COLORS.breakout, options.scale)
    }
  }

  for (const candle of layout.candles) {
    const color = candle.up ? COLORS.up : COLORS.down
    const bodyWidth = Math.max(1, Math.round(candle.halfWidth * 2))
    surface.rect(x + candle.x - 0.5, y + candle.wickTop, 1, candle.wickBottom - candle.wickTop, color)
    surface.rect(
      x + candle.x - bodyWidth / 2,
      y + candle.bodyTop,
      bodyWidth,
      Math.max(1, candle.bodyBottom - candle.bodyTop),
      color,
    )
  }
}

function renderExample(pattern: ChartPattern, example: ChartPatternExample): Buffer {
  const surface = new Surface(760, 440, COLORS.panel)
  const accent = biasColor(pattern)

  surface.text(16, 14, pattern.name, COLORS.text, 3)
  const biasText = `${pattern.bias} / ${pattern.family}`
  surface.text(760 - 16 - surface.textWidth(biasText, 2), 18, biasText, accent, 2)
  surface.rect(16, 38, 760 - 32, 1, COLORS.border)

  const caption = `${example.label} - ${example.caption}`
  surface.text(16, 48, fit(surface, caption, 728, 2), COLORS.dim, 2)

  drawPlot(surface, example, { x: 16, y: 68, width: 728, height: 300, labels: true, scale: 2 })

  surface.text(16, 384, fit(surface, `Confirmation: ${pattern.confirmation}`, 728, 2), COLORS.text, 2)
  surface.text(16, 400, fit(surface, `Invalidation: ${pattern.invalidation}`, 728, 2), COLORS.dim, 2)
  surface.text(16, 416, fit(surface, `Target: ${pattern.target}`, 728, 2), COLORS.dim, 2)
  return surface.toPng()
}

function renderOverview(): Buffer {
  const columns = 4
  const rows = Math.ceil(CHART_PATTERN_CATALOG.length / columns)
  const cellWidth = 380
  const cellHeight = 250
  const surface = new Surface(columns * cellWidth + 24, rows * cellHeight + 60, COLORS.panel)

  surface.text(16, 16, 'Chart pattern cheat sheet', COLORS.text, 4)
  surface.text(16, 40, `${CHART_PATTERN_CATALOG.length} patterns, textbook example of each`, COLORS.dim, 2)

  CHART_PATTERN_CATALOG.forEach((pattern, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = 12 + column * cellWidth
    const y = 60 + row * cellHeight
    surface.text(x + 4, y + 4, pattern.name, COLORS.text, 2)
    surface.text(x + 4, y + 20, pattern.bias, biasColor(pattern), 2)
    drawPlot(surface, pattern.examples[0], {
      x: x + 4,
      y: y + 36,
      width: cellWidth - 20,
      height: cellHeight - 52,
      labels: false,
      scale: 2,
    })
  })
  return surface.toPng()
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function main(): void {
  const check = process.argv.includes('--check')
  const target = check ? join(OUTPUT_DIR, '.check') : OUTPUT_DIR
  if (check) rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })

  const written: string[] = []
  const stale: string[] = []
  const write = (relative: string, data: Buffer) => {
    const path = join(target, relative)
    mkdirSync(dirname(path), { recursive: true })
    if (check) {
      const existing = join(OUTPUT_DIR, relative)
      let previous: Buffer | null = null
      try {
        previous = readFileSync(existing)
      } catch {
        previous = null
      }
      if (!previous || !previous.equals(data)) stale.push(relative)
      return
    }
    writeFileSync(path, data)
    written.push(relative)
  }

  for (const pattern of CHART_PATTERN_CATALOG) {
    for (const example of pattern.examples) {
      write(join(pattern.id, `${slug(example.label)}.png`), renderExample(pattern, example))
    }
  }
  write('overview.png', renderOverview())

  const index = [
    '# Chart pattern examples',
    '',
    'Generated by `npm run patterns:png` from `electron/shared/chartPatterns.ts`.',
    'These are the same candles the Cheat Sheet and Dictionary draw on screen —',
    'the geometry comes from `layoutPattern()`, so an image cannot disagree with the app.',
    '',
    '![All patterns](overview.png)',
    '',
    ...CHART_PATTERN_CATALOG.flatMap((pattern) => [
      `## ${pattern.name}`,
      '',
      `${pattern.bias} · ${pattern.family} · ${pattern.recognition}`,
      '',
      ...pattern.examples.map((example) => `![${pattern.name} — ${example.label}](${pattern.id}/${slug(example.label)}.png)`),
      '',
    ]),
  ].join('\n')
  write('README.md', Buffer.from(index, 'utf8'))

  if (check) {
    rmSync(target, { recursive: true, force: true })
    if (stale.length) {
      console.error(`${stale.length} pattern image(s) out of date; run npm run patterns:png`)
      for (const path of stale.slice(0, 10)) console.error(`  ${path}`)
      process.exitCode = 1
      return
    }
    console.log(`Pattern images are up to date (${CHART_PATTERN_CATALOG.length * 3 + 2} files).`)
    return
  }
  console.log(`Wrote ${written.length} files to ${OUTPUT_DIR}`)
}

main()
