/**
 * 実データに対してパーサを検証する開発用スクリプト。
 *   npx tsx scripts/check-parser.ts
 *
 * SBIのCSVそのものはリポジトリに含めない。sample-data/ から読む。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mergeRealizedPnl, parseSbiFile } from '../src/lib/sbi/parse'
import type { Execution, RealizedRow } from '../src/lib/sbi/types'

const DIR = join(import.meta.dirname, '../../sample-data')
const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`

const executions: Execution[] = []
const realized: RealizedRow[] = []

for (const f of readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.csv')).sort()) {
  const buf = readFileSync(join(DIR, f))
  const r = parseSbiFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  console.log(
    `${f.padEnd(38)} ${r.format.padEnd(18)} 約定=${String(r.executions.length).padStart(5)} 実現損益=${String(r.realized.length).padStart(5)}`,
  )
  r.warnings.forEach((w) => console.log(`    ! ${w}`))
  executions.push(...r.executions)
  realized.push(...r.realized)
}

console.log('\n=== マージ ===')
const target = realized.filter((r) => r.kind !== 'margin').length
const { merged, synthesized } = mergeRealizedPnl(executions, realized)
console.log(`実現損益を突合できた決済: ${merged} / ${target}（信用${realized.length - target}件は約定履歴側が正）`)
console.log(`約定履歴に存在せず合成した決済: ${synthesized.length}`)
synthesized.forEach((s) =>
  console.log(`   ${s.date} ${s.code} ${s.name} 数量=${s.quantity} 損益=${s.realizedPnl}`),
)

console.log('\n=== 損益の内訳（検算） ===')
const groups = new Map<string, { n: number; pnl: number }>()
for (const e of executions) {
  if (e.action !== 'close') continue
  const key = `${e.kind}/${e.side}`
  const g = groups.get(key) ?? { n: 0, pnl: 0 }
  g.n++
  g.pnl += e.realizedPnl ?? 0
  groups.set(key, g)
}
for (const [k, g] of [...groups].sort()) {
  console.log(`  ${k.padEnd(14)} ${String(g.n).padStart(5)}件  ${yen(g.pnl).padStart(16)}`)
}

const closes = executions.filter((e) => e.action === 'close')
const missing = closes.filter((e) => e.realizedPnl === null)
console.log(`\n決済レコード ${closes.length}件 中、損益不明 ${missing.length}件`)
missing.slice(0, 10).forEach((m) =>
  console.log(`   ${m.date} ${m.code} ${m.name} ${m.rawKind} 数量=${m.quantity} 単価=${m.price}`),
)

const total = closes.reduce((s, e) => s + (e.realizedPnl ?? 0), 0)
console.log(`\n実現損益 総合計: ${yen(total)}`)
console.log(`手数料・諸経費 総合計: ${yen(executions.reduce((s, e) => s + e.fee, 0))}`)

/* ---- 建玉の突合 ---- */
import { buildPositions, holdingBucket, HOLDING_BUCKET_LABEL } from '../src/lib/sbi/positions'

console.log('\n=== 建玉の突合 ===')
const { positions, orphanCloses, openLots } = buildPositions(executions)
console.log(`生成された建玉: ${positions.length}`)
console.log(`新規建てが見つからない決済: ${orphanCloses.length}  (損益 ${yen(orphanCloses.reduce((s, e) => s + (e.realizedPnl ?? 0), 0))})`)
console.log(`期末に残った未決済建玉: ${openLots.length}`)
const posPnl = positions.reduce((s, p) => s + p.realizedPnl, 0)
console.log(`建玉ベースの損益合計: ${yen(Math.round(posPnl))}  ← 決済ベースとの差 ${yen(Math.round(posPnl + orphanCloses.reduce((s, e) => s + (e.realizedPnl ?? 0), 0) - total))}`)

console.log('\n=== 保有期間別の成績 ===')
const bk = new Map<string, { n: number; pnl: number; win: number }>()
for (const p of positions) {
  const k = HOLDING_BUCKET_LABEL[holdingBucket(p.holdingDays)]
  const g = bk.get(k) ?? { n: 0, pnl: 0, win: 0 }
  g.n++; g.pnl += p.realizedPnl; if (p.realizedPnl > 0) g.win++
  bk.set(k, g)
}
for (const [k, g] of bk) {
  console.log(`  ${k.padEnd(18)} ${String(g.n).padStart(5)}件  勝率${String(Math.round((g.win / g.n) * 100)).padStart(3)}%  ${yen(Math.round(g.pnl)).padStart(14)}`)
}

console.log('\n=== 方向別の成績 ===')
for (const side of ['long', 'short'] as const) {
  const ps = positions.filter((p) => p.side === side && p.kind === 'margin')
  if (!ps.length) continue
  const win = ps.filter((p) => p.realizedPnl > 0).length
  console.log(`  ${side === 'long' ? '買い  ' : '空売り'} ${String(ps.length).padStart(5)}件  勝率${String(Math.round((win / ps.length) * 100)).padStart(3)}%  ${yen(Math.round(ps.reduce((s, p) => s + p.realizedPnl, 0))).padStart(14)}`)
}
