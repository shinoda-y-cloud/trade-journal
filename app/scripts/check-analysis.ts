/**
 * 分析画面が表示する数字を実データで固定する回帰テスト。
 *   npx tsx scripts/check-analysis.ts
 *
 * ここに並んでいる値は、8つの仮説を独立に検証・反証した際に
 * 複数の経路で再計算が一致した数字。集計ロジックを触ったあとに走らせて、
 * 意図しない変化が起きていないことを確かめる。
 *
 * 検定のp値は乱数を使うがシード固定なので、実装を変えなければ再現する。
 */
import { loadAll } from './_load'
import {
  AI_THEMES,
  concentration,
  regimeByMonth,
  runInsights,
  sizeAnalysis,
  themeOf,
  themeShares,
} from '../src/lib/insights'

const { executions, positions } = loadAll()

let failed = 0
const eq = (label: string, actual: unknown, expected: unknown, tol = 0) => {
  const ok =
    typeof actual === 'number' && typeof expected === 'number'
      ? Math.abs(actual - expected) <= tol
      : actual === expected
  if (!ok) failed++
  console.log(`${ok ? '  ok' : 'FAIL'}  ${label.padEnd(42)} ${actual}${ok ? '' : `  （期待 ${expected}）`}`)
}

console.log('=== 取込と建玉 ===')
eq('約定件数', executions.length, 3082)
eq('建玉件数', positions.length, 1901)
eq('銘柄数', new Set(positions.map((p) => p.code)).size, 52)
eq('決済日数', new Set(positions.map((p) => p.closeDate)).size, 216)
eq('現物', positions.filter((p) => p.kind === 'cash').length, 123)
eq('信用', positions.filter((p) => p.kind === 'margin').length, 1774)
eq('投資信託', positions.filter((p) => p.kind === 'fund').length, 4)
eq('手数料・諸経費の合計', Math.round(positions.reduce((s, p) => s + p.fee, 0)), 54750)

console.log('\n=== 損益の集中度 ===')
const c = concentration(positions)
eq('純損益', Math.round(c.net), -315647, 1)
eq('総利益', Math.round(c.grossProfit), 1938236, 1)
eq('総損失', Math.round(c.grossLoss), -2253883, 1)
eq('勝ち', c.wins, 925)
eq('負け', c.losses, 975)
eq('ワースト1件', Math.round(c.worst[0].sum), -126506, 1)
eq('ワースト1件の純損益比(%)', +(c.worst[0].shareOfNet * 100).toFixed(1), 40.1, 0.1)
eq('ワースト1件の総損失比(%)', +(c.worst[0].shareOfGrossLoss * 100).toFixed(1), 5.6, 0.1)
eq('ワースト5件', Math.round(c.worst.find((w) => w.n === 5)!.sum), -279807, 1)
eq('ワースト1件の日付', c.worstTrades[0].closeDate, '2026-05-18')
eq('ワースト1件の銘柄', c.worstTrades[0].code, '5803')

console.log('\n=== 建玉金額と振れ幅 ===')
const s = sizeAnalysis(positions)!
eq('対象（国内株）', s.included, 1896)
eq('除外（投信・米国株）', s.excluded, 5)
eq('建玉金額の中央値', Math.round(s.median), 378790, 1)
s.quintiles.forEach((q, i) => {
  eq(`Q${i + 1} 件数`, q.n, [379, 379, 379, 379, 380][i])
  eq(`Q${i + 1} 標準偏差`, Math.round(q.sd), [1487, 1035, 3234, 5357, 9430][i], 2)
})
eq('SD比 Q5/Q1', +s.sdRatio.toFixed(1), 6.3, 0.1)
eq('振れ幅 〜25万円(%)', +(s.bands[0].bigMoveRate * 100).toFixed(1), 0.0, 0.1)
eq('振れ幅 100万円〜(%)', +(s.bands[3].bigMoveRate * 100).toFixed(1), 13.7, 0.1)
eq('|損益|1万円超の件数', s.bigMoves.n, 66)

console.log('\n=== 保有区分 ===')
const day = positions.filter((p) => p.holdingDays === 0)
const over = positions.filter((p) => p.holdingDays !== null && p.holdingDays > 0)
eq('デイトレ 件数', day.length, 1786)
eq('デイトレ 損益', Math.round(day.reduce((a, p) => a + p.realizedPnl, 0)), -83458, 1)
eq('持ち越し 件数', over.length, 113)
eq('持ち越し 損益', Math.round(over.reduce((a, p) => a + p.realizedPnl, 0)), -232307, 1)

console.log('\n=== テーマ ===')
const ai = positions.filter((p) => AI_THEMES.includes(themeOf(p.code)))
eq('AI・半導体 件数', ai.length, 306)
eq('AI・半導体 損益', Math.round(ai.reduce((a, p) => a + p.realizedPnl, 0)), -124334, 1)
eq('最大テーマ', themeShares(positions)[0].theme, '電力・エネルギー')
eq('最大テーマの件数', themeShares(positions)[0].n, 828)

console.log('\n=== 期間の推移 ===')
const r = regimeByMonth(positions)
eq('月数', r.length, 12)
eq('初月のAI比率(%)', +(r[0].aiShare * 100).toFixed(1), 6.7, 0.1)
eq('最終月のAI比率(%)', +(r[r.length - 1].aiShare * 100).toFixed(1), 93.5, 0.1)
eq('初月の現物比率(%)', +(r[0].cashShare * 100).toFixed(1), 100.0, 0.1)
eq('最終月の現物比率(%)', +(r[r.length - 1].cashShare * 100).toFixed(1), 0.0, 0.1)

console.log('\n=== 検定（シード固定） ===')
const rep = runInsights(positions)
eq('検定本数', rep.familySize, 8)
eq('「差を検出」の本数', rep.detected.length, 0)
const wd = rep.axes.find((a) => a.key === 'weekday-long')!
eq('週前半の買い 月火 n', wd.a.n, 449)
eq('週前半の買い 水木金 n', wd.b.n, 765)
eq('週前半の買い 差(pt)', +(wd.diff * 100).toFixed(1), -12.3, 0.1)
eq('週前半の買い 生p', +wd.rawP.toFixed(4), 0.0075, 0.003)
console.log(`  参考  最小の補正後p = ${Math.min(...rep.axes.map((a) => a.adjP)).toFixed(4)}（基準 0.01）`)


/* ---- 勝ち方の構造（RRとエッジ） ---- */
import { edgeStat } from '../src/lib/edge'

console.log('\n=== RRとエッジ ===')
const e = edgeStat(positions)
eq('RR（平均利益÷平均損失）', +e.rr!.toFixed(3), 0.906, 0.002)
eq('損益分岐に必要な勝率(%)', +(e.breakEven! * 100).toFixed(1), 52.5, 0.1)
eq('エッジ(pt)', +(e.edge! * 100).toFixed(1), -3.8, 0.1)
eq('平均利益', Math.round(e.avgWin), 2095, 1)
eq('平均損失', Math.round(e.avgLoss), 2312, 1)
eq('中央値ベースのRR', +e.rrMedian!.toFixed(2), 0.96, 0.02)
eq('最大の勝ち', Math.round(e.maxWin), 35855, 1)
eq('最大の負け', Math.round(e.maxLoss), 126506, 1)

const byKey = (side: string, day: boolean) =>
  edgeStat(positions.filter((p) => p.side === side && (p.holdingDays === 0) === day))
const longOver = byKey('long', false)
eq('買い・持ち越し 件数', longOver.n, 106)
eq('買い・持ち越し 勝率(%)', +(longOver.winRate! * 100).toFixed(1), 57.1, 0.1)
eq('買い・持ち越し RR', +longOver.rr!.toFixed(2), 0.31, 0.01)
eq('買い・持ち越し 必要勝率(%)', +(longOver.breakEven! * 100).toFixed(1), 76.3, 0.2)
eq('買い・持ち越し 損益', Math.round(longOver.pnl), -227033, 2)
const shortDay = byKey('short', true)
eq('空売り・デイトレ 件数', shortDay.n, 678)
eq('空売り・デイトレ RR', +shortDay.rr!.toFixed(2), 1.19, 0.01)
eq('空売り・デイトレ 損益', Math.round(shortDay.pnl), 5459, 2)

console.log(`\n${failed === 0 ? '✅ すべて一致' : `❌ ${failed}件が不一致`}`)
process.exit(failed === 0 ? 0 : 1)
