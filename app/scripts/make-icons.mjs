/**
 * アプリアイコンを生成する。外部ライブラリを使わず、zlibだけでPNGを書く。
 *   node scripts/make-icons.mjs
 *
 * 意匠：ほぼ黒の角丸背景に、右肩上がりの折れ線。線の色は
 * 利益を表す青（ダーク面用のステップ #3987e5）。
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const OUT = join(import.meta.dirname, '../public')
mkdirSync(OUT, { recursive: true })

const BG = [13, 13, 13]
const LINE = [57, 135, 229]

/** 折れ線の頂点（0〜1の相対座標。yは下向き） */
const PATH = [
  [0.16, 0.72],
  [0.36, 0.5],
  [0.52, 0.6],
  [0.84, 0.26],
]

function render(size) {
  const px = new Uint8Array(size * size * 4)
  const r = size * 0.22 // 角丸の半径
  const lw = size * 0.085 // 線幅
  const dot = size * 0.075 // 終点マーカーの半径

  const inRounded = (x, y) => {
    const cx = Math.min(Math.max(x, r), size - r)
    const cy = Math.min(Math.max(y, r), size - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  }

  // 点と線分の距離
  const distSeg = (x, y, [x1, y1], [x2, y2]) => {
    const dx = x2 - x1
    const dy = y2 - y1
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))
  }

  const pts = PATH.map(([a, b]) => [a * size, b * size])
  const end = pts[pts.length - 1]

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const cx = x + 0.5
      const cy = y + 0.5
      if (!inRounded(cx, cy)) continue

      px[i] = BG[0]
      px[i + 1] = BG[1]
      px[i + 2] = BG[2]
      px[i + 3] = 255

      let d = Infinity
      for (let k = 0; k < pts.length - 1; k++) d = Math.min(d, distSeg(cx, cy, pts[k], pts[k + 1]))
      d = Math.min(d, Math.hypot(cx - end[0], cy - end[1]) - (dot - lw / 2))

      // 境界1pxをアンチエイリアスする
      const a = Math.min(Math.max(lw / 2 - d + 0.5, 0), 1)
      if (a > 0) {
        for (let c = 0; c < 3; c++) px[i + c] = Math.round(BG[c] * (1 - a) + LINE[c] * a)
      }
    }
  }
  return px
}

function png(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // フィルタなし
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }

  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, c])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(join(OUT, name), png(size, render(size)))
  console.log(`${name} (${size}x${size})`)
}

// ブラウザのタブ用
writeFileSync(
  join(OUT, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0d0d0d"/><path d="M10 46 23 32 33 38 54 17" fill="none" stroke="#3987e5" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="54" cy="17" r="4.8" fill="#3987e5"/></svg>\n`,
)
console.log('favicon.svg')
