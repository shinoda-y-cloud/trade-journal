/**
 * 3テーマのコントラスト比を検証する。
 *   node scripts/check-contrast.mjs
 *
 * 文字は4.5:1以上、グラフ・境界・アクセントは3:1以上を基準にしている。
 * 色を変えたら必ずこれを通すこと。
 */
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const L = (hex) => {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

const TEXT = 4.5
const GRAPHIC = 3

const THEMES = {
  白基調: {
    surface: '#ffffff',
    fg: { '本文': ['#0b0b0b', TEXT], '補助': ['#52514e', TEXT], '薄字': ['#6d6b66', TEXT],
      '利益': ['#2a78d6', GRAPHIC], '損失': ['#d63b3a', GRAPHIC], '強調': ['#c2521f', GRAPHIC],
      '手法:上昇': ['#1a7f37', GRAPHIC], '手法:星': ['#8a6d00', GRAPHIC] },
  },
  紺基調: {
    surface: '#16202f',
    fg: { '本文': ['#eef3fa', TEXT], '補助': ['#b3c2d6', TEXT], '薄字': ['#8598ae', TEXT],
      '利益': ['#5aa9f8', GRAPHIC], '損失': ['#f4807e', GRAPHIC], '強調': ['#f0854c', GRAPHIC],
      '手法:上昇': ['#4ec97a', GRAPHIC], '手法:星': ['#e0b341', GRAPHIC] },
  },
  黒基調: {
    surface: '#0f0f0f',
    fg: { '本文': ['#ffffff', TEXT], '補助': ['#c3c2b7', TEXT], '薄字': ['#9a978f', TEXT],
      '利益': ['#4d94ea', GRAPHIC], '損失': ['#ef7a7a', GRAPHIC], '強調': ['#e0672f', GRAPHIC],
      '手法:上昇': ['#3fb950', GRAPHIC], '手法:星': ['#d3a017', GRAPHIC] },
  },
}

let failed = 0
for (const [name, t] of Object.entries(THEMES)) {
  console.log(`\n=== ${name}  面 ${t.surface} ===`)
  for (const [label, [hex, need]] of Object.entries(t.fg)) {
    const r = ratio(hex, t.surface)
    const ok = r >= need
    if (!ok) failed++
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(10)} ${hex}  ${r.toFixed(2)}:1  (必要 ${need}:1)`)
  }
}
console.log(`\n${failed === 0 ? '✅ すべて基準を満たしています' : `❌ ${failed}件が基準未満`}`)
process.exit(failed === 0 ? 0 : 1)
