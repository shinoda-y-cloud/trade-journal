/**
 * 担当：ポジションサイズと成績
 * 1建玉あたりの投下金額（quantity × openPrice）と成績の関係を検証する。
 */
import { loadAll, weekdayOf, WEEKDAY_JA, wilson, twoProportionP, permutationP } from '../_load'

const { positions } = loadAll()

// 建玉金額の単位が国内株と揃わない投信・米国株は除外（fund 4件 / us_stock 1件）
const all = positions.filter((p) => p.assetClass === 'domestic_stock')
type P = (typeof all)[number]
const notional = (p: P) => p.quantity * p.openPrice
const rows = all.filter((p) => notional(p) > 0)

const yen = (n: number) => Math.round(n).toLocaleString('ja-JP')
const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const q = (xs: number[], t: number) => {
  const s = [...xs].sort((a, b) => a - b)
  const i = (s.length - 1) * t
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return s[lo] + (s[hi] - s[lo]) * (i - lo)
}

console.log(`=== 対象 ===`)
console.log(`国内株建玉 ${all.length}件 / うち建玉金額が正 ${rows.length}件（除外: 投信4・米国株1・金額0 ${all.length - rows.length}件）`)
console.log(`合計損益 ${yen(rows.reduce((s, p) => s + p.realizedPnl, 0))}円`)

// ---------- 1. 建玉金額の分布 ----------
console.log(`\n=== 1. 建玉金額の分布（円） ===`)
const ns = rows.map(notional)
for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 1])
  console.log(`  p${(t * 100).toFixed(0).padStart(3)}: ${yen(q(ns, t)).padStart(12)}`)
console.log(`  平均: ${yen(ns.reduce((a, b) => a + b, 0) / ns.length)}  合計建玉金額: ${yen(ns.reduce((a, b) => a + b, 0))}`)

const stat = (g: P[]) => {
  const n = g.length
  const w = g.filter((p) => p.realizedPnl > 0).length
  const l = g.filter((p) => p.realizedPnl < 0).length
  const pnl = g.reduce((s, p) => s + p.realizedPnl, 0)
  const wins = g.filter((p) => p.realizedPnl > 0)
  const loss = g.filter((p) => p.realizedPnl < 0)
  const avgW = wins.length ? wins.reduce((s, p) => s + p.realizedPnl, 0) / wins.length : 0
  const avgL = loss.length ? loss.reduce((s, p) => s + p.realizedPnl, 0) / loss.length : 0
  const rets = g.map((p) => p.realizedPnl / notional(p))
  return {
    n, w, l, pnl,
    winRate: n ? w / n : 0,
    exp: n ? pnl / n : 0,
    avgW, avgL,
    medNotional: n ? q(g.map(notional), 0.5) : 0,
    avgRet: rets.reduce((a, b) => a + b, 0) / (n || 1),
    medRet: n ? q(rets, 0.5) : 0,
    ci: wilson(w, n),
  }
}
const line = (label: string, s: ReturnType<typeof stat>) =>
  `${label.padEnd(22)} n=${String(s.n).padStart(4)} 勝率${pct(s.winRate).padStart(6)}[${pct(s.ci.lo)}-${pct(s.ci.hi)}] 期待値${yen(s.exp).padStart(7)}円 損益${yen(s.pnl).padStart(10)}円 平均利${yen(s.avgW).padStart(7)} 平均損${yen(s.avgL).padStart(8)} 平均損益率${(s.avgRet * 100).toFixed(3)}% 中央損益率${(s.medRet * 100).toFixed(3)}% 中央金額${yen(s.medNotional)}`

// ---------- 2. 金額帯ごとの成績 ----------
console.log(`\n=== 2-A. 五分位（金額の小さい順） ===`)
const sorted = [...rows].sort((a, b) => notional(a) - notional(b))
const quint: P[][] = [[], [], [], [], []]
sorted.forEach((p, i) => quint[Math.min(4, Math.floor((i * 5) / sorted.length))].push(p))
quint.forEach((g, i) => {
  const lo = yen(Math.min(...g.map(notional)))
  const hi = yen(Math.max(...g.map(notional)))
  console.log(line(`Q${i + 1} ${lo}〜${hi}`, stat(g)))
})

console.log(`\n=== 2-B. 固定境界の金額帯 ===`)
const edges = [0, 200_000, 400_000, 600_000, 1_000_000, 2_000_000, Infinity]
const labels = ['〜20万', '20-40万', '40-60万', '60-100万', '100-200万', '200万〜']
const bands: P[][] = edges.slice(1).map(() => [])
for (const p of rows) {
  const v = notional(p)
  for (let i = 0; i < bands.length; i++) if (v > edges[i] && v <= edges[i + 1]) { bands[i].push(p); break }
}
bands.forEach((g, i) => g.length && console.log(line(labels[i], stat(g))))

// 検定
const qIdx = rows.map((p) => quint.findIndex((g) => g.includes(p)))
console.log(`\n[検定] 五分位×損益額 permutation p=${permutationP(rows.map((r) => r.realizedPnl), qIdx, 5).toFixed(4)}`)
console.log(`[検定] 五分位×損益率 permutation p=${permutationP(rows.map((r) => r.realizedPnl / notional(r)), qIdx, 5).toFixed(4)}`)
const s1 = stat(quint[0]), s5 = stat(quint[4])
console.log(`[検定] Q1 vs Q5 勝率差 p=${twoProportionP(s1.w, s1.n, s5.w, s5.n).toFixed(4)}`)
const half = Math.floor(sorted.length / 2)
const lowH = sorted.slice(0, half), hiH = sorted.slice(half)
const sl = stat(lowH), sh = stat(hiH)
console.log(`[検定] 下位半分 vs 上位半分 勝率差 p=${twoProportionP(sl.w, sl.n, sh.w, sh.n).toFixed(4)}  （下位 勝率${pct(sl.winRate)} / 上位 勝率${pct(sh.winRate)}）`)

// ---------- 3. 損益率 ----------
console.log(`\n=== 3. 損益率（realizedPnl / 建玉金額） ===`)
console.log(`全体: 平均 ${(stat(rows).avgRet * 100).toFixed(4)}%  中央 ${(stat(rows).medRet * 100).toFixed(4)}%`)
console.log(`損益率の分布(%):`)
const rets = rows.map((p) => (p.realizedPnl / notional(p)) * 100)
for (const t of [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99]) console.log(`  p${(t * 100).toFixed(0).padStart(3)}: ${q(rets, t).toFixed(3)}%`)
console.log(`五分位ごとの損益率（平均/中央/標準偏差）:`)
quint.forEach((g, i) => {
  const r = g.map((p) => (p.realizedPnl / notional(p)) * 100)
  const m = r.reduce((a, b) => a + b, 0) / r.length
  const sd = Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / r.length)
  console.log(`  Q${i + 1}: 平均${m.toFixed(3)}% 中央${q(r, 0.5).toFixed(3)}% SD${sd.toFixed(3)}%`)
})

// ---------- 交絡チェック ----------
console.log(`\n=== 交絡チェック：五分位の構成 ===`)
quint.forEach((g, i) => {
  const day = g.filter((p) => p.holdingDays === 0).length
  const short = g.filter((p) => p.side === 'short').length
  const cash = g.filter((p) => p.kind === 'cash').length
  const top = Object.entries(g.reduce<Record<string, number>>((a, p) => ((a[`${p.code}`] = (a[`${p.code}`] ?? 0) + 1), a), {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => `${c}:${n}`).join(' ')
  const hd = g.filter((p) => p.holdingDays !== null).map((p) => p.holdingDays as number)
  console.log(`  Q${i + 1} デイトレ${pct(day / g.length)} 空売り${pct(short / g.length)} 現物${pct(cash / g.length)} 保有日数中央${q(hd, 0.5)} 主銘柄 ${top}`)
})

console.log(`\n=== 交絡チェック：保有日数で層別してから金額帯を見る ===`)
for (const [lab, f] of [
  ['デイトレ(0日)', (p: P) => p.holdingDays === 0],
  ['1-3日', (p: P) => (p.holdingDays ?? -1) >= 1 && (p.holdingDays ?? -1) <= 3],
  ['4日以上', (p: P) => (p.holdingDays ?? -1) >= 4],
] as const) {
  const sub = rows.filter(f)
  const ss = [...sub].sort((a, b) => notional(a) - notional(b))
  const h = Math.floor(ss.length / 2)
  const a = stat(ss.slice(0, h)), b = stat(ss.slice(h))
  console.log(`  ${lab} n=${sub.length}`)
  console.log(`    ${line('  金額 下位半分', a)}`)
  console.log(`    ${line('  金額 上位半分', b)}`)
  console.log(`    勝率差 p=${twoProportionP(a.w, a.n, b.w, b.n).toFixed(4)}`)
}

console.log(`\n=== 交絡チェック：主要銘柄内で金額の上下半分を比較 ===`)
const codeCount = rows.reduce<Record<string, number>>((a, p) => ((a[p.code] = (a[p.code] ?? 0) + 1), a), {})
for (const code of Object.keys(codeCount).filter((c) => codeCount[c] >= 80).sort((a, b) => codeCount[b] - codeCount[a])) {
  const sub = [...rows.filter((p) => p.code === code)].sort((a, b) => notional(a) - notional(b))
  const h = Math.floor(sub.length / 2)
  const a = stat(sub.slice(0, h)), b = stat(sub.slice(h))
  console.log(`  ${code} ${sub[0].name} n=${sub.length}`)
  console.log(`    小 n=${a.n} 勝率${pct(a.winRate)} 期待値${yen(a.exp)}円 損益率平均${(a.avgRet * 100).toFixed(3)}% 中央金額${yen(a.medNotional)}`)
  console.log(`    大 n=${b.n} 勝率${pct(b.winRate)} 期待値${yen(b.exp)}円 損益率平均${(b.avgRet * 100).toFixed(3)}% 中央金額${yen(b.medNotional)}  勝率差p=${twoProportionP(a.w, a.n, b.w, b.n).toFixed(4)}`)
}

// ---------- 4. 銘柄ごとの平均建玉金額と成績 ----------
console.log(`\n=== 4. 銘柄別：平均建玉金額 vs 成績（n>=8） ===`)
const byCode = new Map<string, P[]>()
for (const p of rows) byCode.set(p.code, [...(byCode.get(p.code) ?? []), p])
const codeStats = [...byCode.entries()]
  .map(([code, g]) => ({ code, name: g[0].name, g, avgN: g.reduce((s, p) => s + notional(p), 0) / g.length, s: stat(g) }))
  .filter((x) => x.g.length >= 8)
  .sort((a, b) => b.avgN - a.avgN)
console.log('  code name                 n  平均建玉金額   勝率   期待値      損益      平均損益率')
for (const c of codeStats)
  console.log(`  ${c.code} ${c.name.slice(0, 10).padEnd(12)} ${String(c.s.n).padStart(4)} ${yen(c.avgN).padStart(11)} ${pct(c.s.winRate).padStart(6)} ${yen(c.s.exp).padStart(8)} ${yen(c.s.pnl).padStart(11)} ${(c.s.avgRet * 100).toFixed(3)}%${c.s.n < 30 ? '  ※参考値' : ''}`)
// 銘柄レベルの相関（平均建玉金額 vs 平均損益率）
const corr = (xs: number[], ys: number[]) => {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length
  const my = ys.reduce((a, b) => a + b, 0) / ys.length
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0)
  return num / Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0))
}
const spearman = (xs: number[], ys: number[]) => {
  const rank = (a: number[]) => { const idx = a.map((v, i) => [v, i] as const).sort((p, q2) => p[0] - q2[0]); const r = new Array(a.length); idx.forEach(([, i], k) => (r[i] = k + 1)); return r }
  return corr(rank(xs), rank(ys))
}
console.log(`  [銘柄レベル n=${codeStats.length}] 平均建玉金額 vs 平均損益率: Pearson ${corr(codeStats.map((c) => c.avgN), codeStats.map((c) => c.s.avgRet)).toFixed(3)} / Spearman ${spearman(codeStats.map((c) => c.avgN), codeStats.map((c) => c.s.avgRet)).toFixed(3)}`)
console.log(`  [銘柄レベル] 平均建玉金額 vs 勝率: Spearman ${spearman(codeStats.map((c) => c.avgN), codeStats.map((c) => c.s.winRate)).toFixed(3)}`)
// トレードレベルの相関
console.log(`  [トレードレベル n=${rows.length}] 建玉金額 vs 損益率: Spearman ${spearman(rows.map(notional), rows.map((p) => p.realizedPnl / notional(p))).toFixed(3)}`)
console.log(`  [トレードレベル n=${rows.length}] 建玉金額 vs 損益額: Spearman ${spearman(rows.map(notional), rows.map((p) => p.realizedPnl)).toFixed(3)}`)

// ---------- 5/6. 上位20 ----------
const desc = (p: P) =>
  `${p.code} ${p.name.slice(0, 8).padEnd(10)} ${p.side === 'long' ? '買' : '空'} ${p.kind === 'cash' ? '現物' : '信用'} ${String(p.holdingDays ?? '?').padStart(3)}日 建${yen(notional(p)).padStart(10)}円 損益${yen(p.realizedPnl).padStart(9)}円 率${((p.realizedPnl / notional(p)) * 100).toFixed(2).padStart(7)}% ${p.openDate ?? '?'}→${p.closeDate}(${WEEKDAY_JA[weekdayOf(p.closeDate)]})`

const worst = [...rows].sort((a, b) => a.realizedPnl - b.realizedPnl).slice(0, 20)
const best = [...rows].sort((a, b) => b.realizedPnl - a.realizedPnl).slice(0, 20)

const profile = (g: P[], title: string) => {
  console.log(`\n--- ${title} プロファイル ---`)
  const s = stat(g)
  console.log(`  合計損益 ${yen(s.pnl)}円 / 平均 ${yen(s.exp)}円`)
  console.log(`  建玉金額: 中央 ${yen(q(g.map(notional), 0.5))} 最小 ${yen(Math.min(...g.map(notional)))} 最大 ${yen(Math.max(...g.map(notional)))}（全体中央 ${yen(q(ns, 0.5))}）`)
  const hd = g.map((p) => p.holdingDays ?? -1).filter((v) => v >= 0)
  console.log(`  保有日数: 中央 ${q(hd, 0.5)}日 平均 ${(hd.reduce((a, b) => a + b, 0) / hd.length).toFixed(1)}日 デイトレ${g.filter((p) => p.holdingDays === 0).length}件 / 最長${Math.max(...hd)}日`)
  console.log(`  方向: 買い${g.filter((p) => p.side === 'long').length} 空売り${g.filter((p) => p.side === 'short').length}（全体の空売り比率 ${pct(rows.filter((p) => p.side === 'short').length / rows.length)}）`)
  console.log(`  区分: 現物${g.filter((p) => p.kind === 'cash').length} 信用${g.filter((p) => p.kind === 'margin').length}`)
  const cc = Object.entries(g.reduce<Record<string, number>>((a, p) => ((a[`${p.code} ${p.name.slice(0, 8)}`] = (a[`${p.code} ${p.name.slice(0, 8)}`] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1])
  console.log(`  銘柄: ${cc.map(([k, v]) => `${k}×${v}`).join(' / ')}`)
  const wd = g.reduce<Record<string, number>>((a, p) => ((a[WEEKDAY_JA[weekdayOf(p.closeDate)]] = (a[WEEKDAY_JA[weekdayOf(p.closeDate)]] ?? 0) + 1), a), {})
  console.log(`  決済曜日: ${WEEKDAY_JA.map((d) => `${d}${wd[d] ?? 0}`).join(' ')}`)
  const wdAll = rows.reduce<Record<string, number>>((a, p) => ((a[WEEKDAY_JA[weekdayOf(p.closeDate)]] = (a[WEEKDAY_JA[weekdayOf(p.closeDate)]] ?? 0) + 1), a), {})
  console.log(`  （全体の決済曜日: ${WEEKDAY_JA.map((d) => `${d}${wdAll[d] ?? 0}`).join(' ')}）`)
  const mo = g.reduce<Record<string, number>>((a, p) => ((a[p.closeDate.slice(0, 7)] = (a[p.closeDate.slice(0, 7)] ?? 0) + 1), a), {})
  console.log(`  決済月: ${Object.entries(mo).sort().map(([k, v]) => `${k}:${v}`).join(' ')}`)
  console.log(`  損益率: 中央 ${(q(g.map((p) => (p.realizedPnl / notional(p)) * 100), 0.5)).toFixed(2)}%`)
}

console.log(`\n=== 5. 損失額 上位20 ===`)
worst.forEach((p, i) => console.log(`  ${String(i + 1).padStart(2)}. ${desc(p)}`))
profile(worst, '損失上位20')

console.log(`\n=== 6. 利益額 上位20 ===`)
best.forEach((p, i) => console.log(`  ${String(i + 1).padStart(2)}. ${desc(p)}`))
profile(best, '利益上位20')

console.log(`\n=== 5-6対比 ===`)
const wl = worst.reduce((s, p) => s + p.realizedPnl, 0)
const bl = best.reduce((s, p) => s + p.realizedPnl, 0)
console.log(`  上位20勝ち計 ${yen(bl)}円 / 上位20負け計 ${yen(wl)}円 → 差引 ${yen(bl + wl)}円（全体 ${yen(rows.reduce((s, p) => s + p.realizedPnl, 0))}円）`)
console.log(`  この40件を除いた残り${rows.length - 40}件の合計損益 ${yen(rows.reduce((s, p) => s + p.realizedPnl, 0) - bl - wl)}円`)
// テール寄与
const sortedPnl = [...rows].sort((a, b) => a.realizedPnl - b.realizedPnl)
console.log(`  最悪1%(${Math.round(rows.length * 0.01)}件)の合計 ${yen(sortedPnl.slice(0, Math.round(rows.length * 0.01)).reduce((s, p) => s + p.realizedPnl, 0))}円`)
console.log(`  最良1%(${Math.round(rows.length * 0.01)}件)の合計 ${yen(sortedPnl.slice(-Math.round(rows.length * 0.01)).reduce((s, p) => s + p.realizedPnl, 0))}円`)
console.log(`  最悪5%の合計 ${yen(sortedPnl.slice(0, Math.round(rows.length * 0.05)).reduce((s, p) => s + p.realizedPnl, 0))}円 / 最良5%の合計 ${yen(sortedPnl.slice(-Math.round(rows.length * 0.05)).reduce((s, p) => s + p.realizedPnl, 0))}円`)

// 大きい建玉が損失トップに出るのは単に金額が大きいからか？ → 損益率上位/下位20も見る
console.log(`\n=== 参考: 損益「率」ワースト20 / ベスト20 ===`)
const byRet = [...rows].sort((a, b) => a.realizedPnl / notional(a) - b.realizedPnl / notional(b))
console.log('  [率ワースト20]')
byRet.slice(0, 20).forEach((p, i) => console.log(`  ${String(i + 1).padStart(2)}. ${desc(p)}`))
console.log(`  中央建玉金額 ${yen(q(byRet.slice(0, 20).map(notional), 0.5))}円 / 保有日数中央 ${q(byRet.slice(0, 20).map((p) => p.holdingDays ?? 0), 0.5)}日 / 空売り${byRet.slice(0, 20).filter((p) => p.side === 'short').length}件`)
console.log('  [率ベスト20]')
byRet.slice(-20).reverse().forEach((p, i) => console.log(`  ${String(i + 1).padStart(2)}. ${desc(p)}`))
console.log(`  中央建玉金額 ${yen(q(byRet.slice(-20).map(notional), 0.5))}円 / 保有日数中央 ${q(byRet.slice(-20).map((p) => p.holdingDays ?? 0), 0.5)}日 / 空売り${byRet.slice(-20).filter((p) => p.side === 'short').length}件`)

// 損失上位20の建玉金額が「大きいから」なのかの検証：大口だけを取り出して勝率
console.log(`\n=== 参考: 大口（上位5%金額）の成績 ===`)
const bigCut = q(ns, 0.95)
const big = rows.filter((p) => notional(p) >= bigCut)
console.log(line(`建玉>=${yen(bigCut)}円`, stat(big)))
const smallCut = q(ns, 0.05)
console.log(line(`建玉<=${yen(smallCut)}円`, stat(rows.filter((p) => notional(p) <= smallCut))))
