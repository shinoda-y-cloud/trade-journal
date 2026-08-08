/**
 * 集計ロジックの検証。
 *   npx tsx scripts/check-analysis.ts
 *
 * CSVを追加・更新するたびに数字は変わるので、特定の値を固定するのはやめ、
 * **データが変わっても成り立たなければおかしい関係**だけを検証している。
 * 現在の値は最後にまとめて表示するので、目視での確認はそちらで行う。
 */
import { loadAll } from './_load'
import { concentration, notionalOf, regimeByMonth, runInsights, sizeAnalysis } from '../src/lib/insights'
import { edgeStat } from '../src/lib/edge'
import { buildPositions } from '../src/lib/sbi/positions'
import { dedupeExecutions } from '../src/lib/sbi/parse'

const { executions, positions } = loadAll()
const yen = (n: number) => Math.round(n).toLocaleString('ja-JP') + '円'

let failed = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? '  ok' : 'FAIL'}  ${label}${detail ? `  … ${detail}` : ''}`)
}
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol

console.log('=== 取込の健全性 ===')
ok('約定にID重複が無い', new Set(executions.map((e) => e.id)).size === executions.length)
ok('もう一度重複排除しても件数が変わらない', dedupeExecutions(executions).length === executions.length)
ok('損益不明の決済が無い', positions.every((p) => p.pnlKnown), `${positions.filter((p) => !p.pnlKnown).length}件`)
ok('全ての建玉に決済日がある', positions.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.closeDate)))
ok(
  '保有日数は負にならない',
  positions.every((p) => p.holdingDays === null || p.holdingDays >= 0),
)

console.log('\n=== 集計の整合 ===')
const conc = concentration(positions)
const e = edgeStat(positions)
const total = positions.reduce((s, p) => s + p.realizedPnl, 0)
ok('純損益 = 総利益 + 総損失', near(conc.net, conc.grossProfit + conc.grossLoss))
ok('純損益 = 建玉損益の合計', near(conc.net, total))
ok('勝ち + 負け + 同値 = 建玉数', conc.wins + conc.losses + positions.filter((p) => p.realizedPnl === 0).length === positions.length)
ok('edgeStat の損益が一致', near(e.pnl, total))
ok('期待値 × 件数 = 損益', near(e.expectancy * positions.length, total, 2))

console.log('\n=== RR と必要勝率の恒等式 ===')
ok('RR = 平均利益 ÷ 平均損失', e.rr !== null && near(e.rr, e.avgWin / e.avgLoss, 1e-9))
ok('必要勝率 = 1 ÷ (1 + RR)', e.breakEven !== null && near(e.breakEven, 1 / (1 + e.rr!), 1e-9))
ok('エッジ = 実勝率 − 必要勝率', e.edge !== null && near(e.edge, e.winRate! - e.breakEven!, 1e-9))
// エッジの符号と期待値の符号は一致するはず（同値トレードの分だけ僅かにずれ得る）
ok(
  'エッジの符号と期待値の符号が一致',
  Math.sign(e.edge!) === Math.sign(e.expectancy) || Math.abs(e.expectancy) < 1,
  `エッジ${(e.edge! * 100).toFixed(1)}pt / 期待値${yen(e.expectancy)}`,
)

console.log('\n=== 建玉金額 ===')
const size = sizeAnalysis(positions)
if (size) {
  ok('五分位の件数合計 = 対象件数', size.quintiles.reduce((s, q) => s + q.n, 0) === size.included)
  ok('対象 + 除外 = 全建玉', size.included + size.excluded === positions.length)
  ok('金額レンジが単調に増える', size.quintiles.every((q, i) => i === 0 || q.lo >= size.quintiles[i - 1].hi - 1))
  ok('国内株以外は金額の対象外', positions.filter((p) => p.assetClass !== 'domestic_stock').every((p) => notionalOf(p) === null))
}

console.log('\n=== 検定の再現性（シード固定） ===')
const r1 = runInsights(positions)
const r2 = runInsights(positions)
ok('2回実行して同じp値になる', r1.axes.every((a, i) => a.rawP === r2.axes[i].rawP))
ok('Holm補正後は生p以上', r1.axes.every((a) => a.adjP >= a.rawP - 1e-12))
ok('判定は4条件を満たしたものだけ', r1.axes.every((a) => a.verdict !== '差を検出' || (a.adjP < 0.01 && a.robust === true && Math.min(a.a.n, a.b.n) >= 30)))

console.log('\n=== 建玉の突合 ===')
const built = buildPositions(executions)
ok('建玉の損益合計 = 決済約定の損益合計', near(
  built.positions.reduce((s, p) => s + p.realizedPnl, 0),
  executions.filter((x) => x.action === 'close').reduce((s, x) => s + (x.realizedPnl ?? 0), 0),
  1,
))
ok('建玉の手数料合計 = 約定の手数料合計', near(
  built.positions.reduce((s, p) => s + p.fee, 0),
  executions.reduce((s, x) => s + x.fee, 0),
  1,
))

console.log('\n=== 現在の値（目視用） ===')
const regime = regimeByMonth(positions)
console.log(`  約定 ${executions.length.toLocaleString('ja-JP')}件 / 建玉 ${positions.length.toLocaleString('ja-JP')}件 / 銘柄 ${new Set(positions.map((p) => p.code)).size}`)
console.log(`  期間 ${regime[0]?.month} 〜 ${regime[regime.length - 1]?.month}`)
console.log(`  実現損益 ${yen(conc.net)}（総利益 ${yen(conc.grossProfit)} / 総損失 ${yen(conc.grossLoss)}）`)
console.log(`  手数料・諸経費 ${yen(positions.reduce((s, p) => s + p.fee, 0))}`)
console.log(`  勝率 ${(e.winRate! * 100).toFixed(1)}% / RR ${e.rr!.toFixed(3)} / 必要勝率 ${(e.breakEven! * 100).toFixed(1)}% / エッジ ${(e.edge! * 100).toFixed(1)}pt`)
console.log(`  ワースト1件 ${yen(conc.worst[0].sum)}（純損益比 ${(conc.worst[0].shareOfNet * 100).toFixed(1)}% / 総損失比 ${(conc.worst[0].shareOfGrossLoss * 100).toFixed(1)}%）`)
console.log(`  「差を検出」した軸 ${r1.detected.length} / ${r1.familySize}本`)

console.log(`\n${failed === 0 ? '✅ すべての不変条件を満たしています' : `❌ ${failed}件が不成立`}`)
process.exit(failed === 0 ? 0 : 1)
