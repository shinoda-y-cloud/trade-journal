/**
 * ディスポジション効果（利益は早く確定し、損失は長く持つ）の検証。
 * 書き込みは scripts/analysis/ のみ。src/ は読むだけ。
 */
import { loadAll } from '../_load'
import type { Position } from '../../src/lib/sbi/types'

const { positions } = loadAll()

// ---------- 汎用統計 ----------
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0)
const mean = (a: number[]) => (a.length ? sum(a) / a.length : NaN)
function quantile(a: number[], q: number): number {
  if (!a.length) return NaN
  const s = [...a].sort((x, y) => x - y)
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo)
}
const median = (a: number[]) => quantile(a, 0.5)
function sd(a: number[]): number {
  if (a.length < 2) return NaN
  const m = mean(a)
  return Math.sqrt(sum(a.map((v) => (v - m) ** 2)) / (a.length - 1))
}
/** 標準正規の両側p値 */
function normP(z: number): number {
  z = Math.abs(z)
  const t = 1 / (1 + 0.2316419 * z)
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  const upper =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return Math.min(1, 2 * upper)
}
/** Mann-Whitney U 検定（正規近似・同順位補正）。効果量は rank-biserial r */
function mannWhitney(x: number[], y: number[]): { p: number; z: number; r: number; auc: number } {
  const n1 = x.length
  const n2 = y.length
  if (n1 === 0 || n2 === 0) return { p: 1, z: 0, r: 0, auc: 0.5 }
  const all = [...x.map((v) => ({ v, g: 0 })), ...y.map((v) => ({ v, g: 1 }))].sort(
    (a, b) => a.v - b.v,
  )
  const ranks = new Array(all.length).fill(0)
  let tieSum = 0
  let i = 0
  while (i < all.length) {
    let j = i
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++
    const r = (i + j + 2) / 2
    const t = j - i + 1
    for (let k = i; k <= j; k++) ranks[k] = r
    tieSum += t ** 3 - t
    i = j + 1
  }
  let r1 = 0
  for (let k = 0; k < all.length; k++) if (all[k].g === 0) r1 += ranks[k]
  const u1 = r1 - (n1 * (n1 + 1)) / 2
  const n = n1 + n2
  const mu = (n1 * n2) / 2
  const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tieSum / (n * (n - 1))))
  const z = sigma === 0 ? 0 : (u1 - mu) / sigma
  const auc = u1 / (n1 * n2)
  return { p: normP(z), z, r: 2 * auc - 1, auc }
}
/** 中央値差の並べ替え検定 */
function permMedianDiff(x: number[], y: number[], iters = 20000, seed = 7): number {
  const obs = Math.abs(median(x) - median(y))
  const pool = [...x, ...y]
  const n1 = x.length
  let a = seed
  const rnd = () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  let ge = 0
  for (let it = 0; it < iters; it++) {
    for (let k = pool.length - 1; k > 0; k--) {
      const j = Math.floor(rnd() * (k + 1))
      ;[pool[k], pool[j]] = [pool[j], pool[k]]
    }
    const d = Math.abs(median(pool.slice(0, n1)) - median(pool.slice(n1)))
    if (d >= obs - 1e-12) ge++
  }
  return (ge + 1) / (iters + 1)
}
/** 平均差の並べ替え検定 */
function permMeanDiff(x: number[], y: number[], iters = 20000, seed = 11): number {
  const obs = Math.abs(mean(x) - mean(y))
  const pool = [...x, ...y]
  const n1 = x.length
  let a = seed
  const rnd = () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  let ge = 0
  for (let it = 0; it < iters; it++) {
    for (let k = pool.length - 1; k > 0; k--) {
      const j = Math.floor(rnd() * (k + 1))
      ;[pool[k], pool[j]] = [pool[j], pool[k]]
    }
    if (Math.abs(mean(pool.slice(0, n1)) - mean(pool.slice(n1))) >= obs - 1e-12) ge++
  }
  return (ge + 1) / (iters + 1)
}
const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : 'NA')
const yen = (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString('ja-JP') : 'NA')

// ---------- データ準備 ----------
type P = Position & { ret: number | null; notional: number; retPnl: number | null }
const enrich = (p: Position): P => {
  // 値幅率（空売りは符号反転）。openPrice=0 は建玉日不明（orphan）なので算出不可
  const ret =
    p.openPrice > 0
      ? ((p.side === 'short' ? -1 : 1) * (p.closePrice - p.openPrice)) / p.openPrice
      : null
  const notional = p.openPrice > 0 ? p.openPrice * p.quantity : 0
  return { ...p, ret, notional, retPnl: notional > 0 ? p.realizedPnl / notional : null }
}
const all = positions.map(enrich)
const known = all.filter((p) => p.holdingDays !== null) // 建玉日が分かるもの
const win = (p: P) => p.realizedPnl > 0
const loss = (p: P) => p.realizedPnl < 0
const flat = (p: P) => p.realizedPnl === 0

console.log('===== 0. データ概観 =====')
console.log(`全建玉 ${all.length} / 実現損益合計 ${yen(sum(all.map((p) => p.realizedPnl)))}円`)
console.log(
  `建玉日既知 ${known.length} / 不明(orphan) ${all.length - known.length} ` +
    `(orphanの損益合計 ${yen(sum(all.filter((p) => p.holdingDays === null).map((p) => p.realizedPnl)))}円)`,
)
console.log(
  `勝ち ${all.filter(win).length} / 負け ${all.filter(loss).length} / ±0 ${all.filter(flat).length}`,
)
const kw = known.filter(win)
const kl = known.filter(loss)
console.log(`[建玉日既知のみ] 勝ち ${kw.length} / 負け ${kl.length}`)
console.log(
  `[建玉日既知のみ] 勝ち計 ${yen(sum(kw.map((p) => p.realizedPnl)))}円 / 負け計 ${yen(sum(kl.map((p) => p.realizedPnl)))}円`,
)

// ---------- 1. 保有日数の分布 ----------
console.log('\n===== 1. 保有日数：勝ち vs 負け =====')
function hdStats(label: string, arr: P[]) {
  const h = arr.map((p) => p.holdingDays as number)
  console.log(
    `${label.padEnd(6)} n=${String(arr.length).padStart(4)} ` +
      `平均${f(mean(h))}日 中央値${f(median(h), 1)} p25=${f(quantile(h, 0.25), 1)} p75=${f(quantile(h, 0.75), 1)} ` +
      `p90=${f(quantile(h, 0.9), 1)} 最大${Math.max(...h)} SD=${f(sd(h))}`,
  )
}
hdStats('勝ち', kw)
hdStats('負け', kl)
{
  const x = kw.map((p) => p.holdingDays as number)
  const y = kl.map((p) => p.holdingDays as number)
  const mwu = mannWhitney(x, y)
  console.log(
    `Mann-Whitney U: z=${f(mwu.z)} p=${mwu.p < 1e-4 ? mwu.p.toExponential(2) : f(mwu.p, 4)} ` +
      `AUC=${f(mwu.auc, 3)} rank-biserial r=${f(mwu.r, 3)}`,
  )
  console.log(`中央値差の並べ替え検定 p=${f(permMedianDiff(x, y), 4)}`)
  console.log(`平均差の並べ替え検定   p=${f(permMeanDiff(x, y), 4)}`)
}

console.log('\n-- 保有日数の度数分布（%は各群内の構成比） --')
const HD_BINS: [string, (d: number) => boolean][] = [
  ['0日(デイトレ)', (d) => d === 0],
  ['1日', (d) => d === 1],
  ['2〜5日', (d) => d >= 2 && d <= 5],
  ['6〜20日', (d) => d >= 6 && d <= 20],
  ['21日以上', (d) => d >= 21],
]
console.log('区分'.padEnd(14) + '勝ち件数  勝ち%   負け件数  負け%')
for (const [lab, fn] of HD_BINS) {
  const a = kw.filter((p) => fn(p.holdingDays as number)).length
  const b = kl.filter((p) => fn(p.holdingDays as number)).length
  console.log(
    lab.padEnd(14) +
      String(a).padStart(6) +
      `  ${f((100 * a) / kw.length, 1).padStart(5)}%` +
      String(b).padStart(9) +
      `  ${f((100 * b) / kl.length, 1).padStart(5)}%`,
  )
}

// ---------- 2. 値幅（リターン%）の分布 ----------
console.log('\n===== 2. 値幅率（(close-open)/open、空売りは符号反転）=====')
const rw = kw.filter((p) => p.ret !== null)
const rl = kl.filter((p) => p.ret !== null)
function retStats(label: string, arr: P[]) {
  const r = arr.map((p) => (p.ret as number) * 100)
  console.log(
    `${label.padEnd(6)} n=${String(arr.length).padStart(4)} ` +
      `平均${f(mean(r))}% 中央値${f(median(r))}% p10=${f(quantile(r, 0.1))}% p25=${f(quantile(r, 0.25))}% ` +
      `p75=${f(quantile(r, 0.75))}% p90=${f(quantile(r, 0.9))}% |最大|${f(Math.max(...r.map(Math.abs)))}%`,
  )
}
retStats('勝ち', rw)
retStats('負け', rl)
{
  const x = rw.map((p) => Math.abs(p.ret as number) * 100)
  const y = rl.map((p) => Math.abs(p.ret as number) * 100)
  console.log(`\n絶対値幅 勝ち 平均${f(mean(x))}% 中央値${f(median(x))}%`)
  console.log(`絶対値幅 負け 平均${f(mean(y))}% 中央値${f(median(y))}%`)
  const mwu = mannWhitney(x, y)
  console.log(
    `Mann-Whitney U(絶対値幅): z=${f(mwu.z)} p=${mwu.p < 1e-4 ? mwu.p.toExponential(2) : f(mwu.p, 4)} AUC=${f(mwu.auc, 3)}`,
  )
  console.log(`中央値差の並べ替え検定 p=${f(permMedianDiff(x, y), 4)}`)
}

// ---------- 3. 保有期間バケットごとの平均利益／平均損失 ----------
console.log('\n===== 3. 保有期間バケット別の損益非対称性 =====')
const BUCKETS: [string, (d: number) => boolean][] = HD_BINS
console.log(
  '区分'.padEnd(14) +
    ' n   勝率%   平均利益     平均損失   利益/損失比  期待値/件   合計損益',
)
type Row = { label: string; n: number; winRate: number; avgW: number; avgL: number; pnl: number }
const rows: Row[] = []
for (const [lab, fn] of BUCKETS) {
  const g = known.filter((p) => fn(p.holdingDays as number))
  const w = g.filter(win)
  const l = g.filter(loss)
  const avgW = mean(w.map((p) => p.realizedPnl))
  const avgL = mean(l.map((p) => p.realizedPnl))
  const pnl = sum(g.map((p) => p.realizedPnl))
  rows.push({
    label: lab,
    n: g.length,
    winRate: (100 * w.length) / (w.length + l.length),
    avgW,
    avgL,
    pnl,
  })
  console.log(
    lab.padEnd(14) +
      String(g.length).padStart(4) +
      f((100 * w.length) / (w.length + l.length), 1).padStart(7) +
      yen(avgW).padStart(11) +
      yen(avgL).padStart(12) +
      f(Math.abs(avgW / avgL), 2).padStart(11) +
      yen(pnl / g.length).padStart(11) +
      yen(pnl).padStart(12),
  )
}
{
  const g = all.filter((p) => p.holdingDays === null)
  if (g.length) {
    const w = g.filter(win)
    const l = g.filter(loss)
    console.log(
      '建玉日不明'.padEnd(14) +
        String(g.length).padStart(4) +
        f((100 * w.length) / (w.length + l.length), 1).padStart(7) +
        yen(mean(w.map((p) => p.realizedPnl))).padStart(11) +
        yen(mean(l.map((p) => p.realizedPnl))).padStart(12) +
        ''.padStart(11) +
        yen(sum(g.map((p) => p.realizedPnl)) / g.length).padStart(11) +
        yen(sum(g.map((p) => p.realizedPnl))).padStart(12),
    )
  }
}

// 建玉サイズの交絡チェック：リターン率ベースでも同じ形か
console.log('\n-- 建玉金額でスケール調整（realizedPnl / 建玉金額, %）--')
console.log('区分'.padEnd(14) + ' n    平均利益率%  平均損失率%   比    平均建玉金額(円)')
for (const [lab, fn] of BUCKETS) {
  const g = known.filter((p) => fn(p.holdingDays as number) && p.retPnl !== null)
  const w = g.filter(win).map((p) => (p.retPnl as number) * 100)
  const l = g.filter(loss).map((p) => (p.retPnl as number) * 100)
  console.log(
    lab.padEnd(14) +
      String(g.length).padStart(4) +
      f(mean(w)).padStart(12) +
      f(mean(l)).padStart(13) +
      f(Math.abs(mean(w) / mean(l)), 2).padStart(7) +
      yen(mean(g.map((p) => p.notional))).padStart(18),
  )
}

// ---------- 4. デイトレ vs 持ち越し ----------
console.log('\n===== 4. デイトレ vs 持ち越し =====')
const day = known.filter((p) => p.holdingDays === 0)
const over = known.filter((p) => (p.holdingDays as number) >= 1)
function group(label: string, g: P[]) {
  const w = g.filter(win)
  const l = g.filter(loss)
  const avgW = mean(w.map((p) => p.realizedPnl))
  const avgL = mean(l.map((p) => p.realizedPnl))
  const pnl = sum(g.map((p) => p.realizedPnl))
  console.log(
    `${label.padEnd(10)} n=${String(g.length).padStart(4)} 勝率${f((100 * w.length) / (w.length + l.length), 1)}% ` +
      `平均利益${yen(avgW)}円 平均損失${yen(avgL)}円 比${f(Math.abs(avgW / avgL), 2)} ` +
      `期待値${yen(pnl / g.length)}円/件 合計${yen(pnl)}円`,
  )
  const rw2 = g.filter((p) => p.ret !== null && win(p)).map((p) => (p.ret as number) * 100)
  const rl2 = g.filter((p) => p.ret !== null && loss(p)).map((p) => (p.ret as number) * 100)
  console.log(
    `           値幅: 勝ち平均+${f(mean(rw2))}% 中央+${f(median(rw2))}% / 負け平均${f(mean(rl2))}% 中央${f(median(rl2))}% / 幅の比${f(Math.abs(mean(rw2) / mean(rl2)), 2)}`,
  )
  return { g, w, l, avgW, avgL, pnl }
}
const D = group('デイトレ', day)
const O = group('持ち越し', over)
console.log(
  `\n勝率差の検定(デイトレ vs 持ち越し) 並べ替えp=${f(
    permMeanDiff(
      D.g.filter((p) => !flat(p)).map((p) => (win(p) ? 1 : 0)),
      O.g.filter((p) => !flat(p)).map((p) => (win(p) ? 1 : 0)),
    ),
    4,
  )}`,
)
console.log(
  `1件あたり損益差の並べ替え検定 p=${f(permMeanDiff(D.g.map((p) => p.realizedPnl), O.g.map((p) => p.realizedPnl)), 4)}`,
)
// 非対称性そのものの検定：|平均利益|/|平均損失| 比がデイトレと持ち越しで違うか
console.log(
  `平均利益の差(デイトレ vs 持ち越し) 並べ替えp=${f(permMeanDiff(D.w.map((p) => p.realizedPnl), O.w.map((p) => p.realizedPnl)), 4)}`,
)
console.log(
  `平均損失の差(デイトレ vs 持ち越し) 並べ替えp=${f(permMeanDiff(D.l.map((p) => p.realizedPnl), O.l.map((p) => p.realizedPnl)), 4)}`,
)

// ---------- 5. 持ち越しトレードの最終成績 ----------
console.log('\n===== 5. 持ち越し日数別の最終成績 =====')
const OV: [string, (d: number) => boolean][] = [
  ['1日持ち越し', (d) => d === 1],
  ['2〜5日', (d) => d >= 2 && d <= 5],
  ['6日以上', (d) => d >= 6],
]
console.log('区分'.padEnd(12) + ' n   勝率%  負け件数 負け合計(円)  勝ち合計(円)   純損益(円)  期待値/件')
for (const [lab, fn] of OV) {
  const g = known.filter((p) => fn(p.holdingDays as number))
  const w = g.filter(win)
  const l = g.filter(loss)
  console.log(
    lab.padEnd(12) +
      String(g.length).padStart(4) +
      f((100 * w.length) / (w.length + l.length), 1).padStart(7) +
      String(l.length).padStart(8) +
      yen(sum(l.map((p) => p.realizedPnl))).padStart(13) +
      yen(sum(w.map((p) => p.realizedPnl))).padStart(14) +
      yen(sum(g.map((p) => p.realizedPnl))).padStart(13) +
      yen(sum(g.map((p) => p.realizedPnl)) / g.length).padStart(10),
  )
}
console.log('\n-- 大負け(下位)の保有日数構成：損失額の集中を見る --')
const lossesSorted = [...known.filter(loss)].sort((a, b) => a.realizedPnl - b.realizedPnl)
for (const topN of [10, 25, 50]) {
  const t = lossesSorted.slice(0, topN)
  const hd = t.map((p) => p.holdingDays as number)
  console.log(
    `ワースト${String(topN).padStart(3)}件: 合計${yen(sum(t.map((p) => p.realizedPnl)))}円 ` +
      `(全損失の${f((100 * sum(t.map((p) => p.realizedPnl))) / sum(kl.map((p) => p.realizedPnl)), 1)}%) ` +
      `保有日数 中央値${f(median(hd), 1)} 平均${f(mean(hd))} デイトレ${hd.filter((d) => d === 0).length}件`,
  )
}
const gainsSorted = [...known.filter(win)].sort((a, b) => b.realizedPnl - a.realizedPnl)
for (const topN of [10, 25, 50]) {
  const t = gainsSorted.slice(0, topN)
  const hd = t.map((p) => p.holdingDays as number)
  console.log(
    `ベスト ${String(topN).padStart(3)}件: 合計${yen(sum(t.map((p) => p.realizedPnl)))}円 ` +
      `(全利益の${f((100 * sum(t.map((p) => p.realizedPnl))) / sum(kw.map((p) => p.realizedPnl)), 1)}%) ` +
      `保有日数 中央値${f(median(hd), 1)} 平均${f(mean(hd))} デイトレ${hd.filter((d) => d === 0).length}件`,
  )
}

// ---------- 6. 交絡の層別確認 ----------
console.log('\n===== 6. 交絡チェック：層別しても保有日数の勝ち<負けは残るか =====')

function stratum(label: string, g: P[]) {
  const w = g.filter(win).map((p) => p.holdingDays as number)
  const l = g.filter(loss).map((p) => p.holdingDays as number)
  if (w.length < 5 || l.length < 5) {
    console.log(`${label.padEnd(22)} n(勝${w.length}/負${l.length}) 件数不足`)
    return
  }
  const mwu = mannWhitney(w, l)
  const tag = w.length < 30 || l.length < 30 ? ' ※参考値(n<30)' : ''
  console.log(
    `${label.padEnd(22)} 勝n=${String(w.length).padStart(4)} 中央${f(median(w), 1).padStart(5)} 平均${f(mean(w)).padStart(6)} | ` +
      `負n=${String(l.length).padStart(4)} 中央${f(median(l), 1).padStart(5)} 平均${f(mean(l)).padStart(6)} | ` +
      `AUC=${f(mwu.auc, 3)} p=${mwu.p < 1e-4 ? mwu.p.toExponential(1) : f(mwu.p, 4)}${tag}`,
  )
}

console.log('\n-- 区分(現物/信用/投信)別 --')
for (const k of ['cash', 'margin', 'fund'] as const) {
  stratum({ cash: '現物', margin: '信用', fund: '投信' }[k], known.filter((p) => p.kind === k))
}
console.log('\n-- 方向(買い/空売り)別 --')
for (const s of ['long', 'short'] as const) {
  stratum(s === 'long' ? '買い(long)' : '空売り(short)', known.filter((p) => p.side === s))
}
console.log('\n-- 銘柄別（建玉20件以上）--')
const byCode = new Map<string, P[]>()
for (const p of known) byCode.set(p.code, [...(byCode.get(p.code) ?? []), p])
const codes = [...byCode.entries()].filter(([, v]) => v.length >= 20).sort((a, b) => b[1].length - a[1].length)
for (const [code, v] of codes) stratum(`${code} ${v[0].name.slice(0, 6)}`, v)

console.log('\n-- 半期別（時期の交絡）--')
for (const [lab, fn] of [
  ['2025-08〜2026-01', (d: string) => d < '2026-02-01'],
  ['2026-02〜2026-07', (d: string) => d >= '2026-02-01'],
] as [string, (d: string) => boolean][]) {
  stratum(lab, known.filter((p) => fn(p.closeDate)))
}

console.log('\n-- 銘柄内で層別した保有日数差の統合（各銘柄で勝-負の中央値差、20件以上）--')
{
  const diffs: { code: string; d: number; n: number }[] = []
  for (const [code, v] of codes) {
    const w = v.filter(win).map((p) => p.holdingDays as number)
    const l = v.filter(loss).map((p) => p.holdingDays as number)
    if (w.length >= 5 && l.length >= 5) diffs.push({ code, d: median(w) - median(l), n: v.length })
  }
  const pos = diffs.filter((x) => x.d > 0).length
  const neg = diffs.filter((x) => x.d < 0).length
  console.log(
    `対象${diffs.length}銘柄: 勝ちの方が中央値が長い ${pos}銘柄 / 短い ${neg}銘柄 / 同じ ${diffs.length - pos - neg}銘柄`,
  )
  console.log(diffs.map((x) => `${x.code}:${f(x.d, 1)}`).join(' '))
  // 符号検定（両側二項）
  const nEff = pos + neg
  if (nEff > 0) {
    let cum = 0
    const lo = Math.min(pos, neg)
    const C = (n: number, k: number) => {
      let r = 1
      for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1)
      return r
    }
    for (let k = 0; k <= lo; k++) cum += C(nEff, k) * 0.5 ** nEff
    console.log(`符号検定 両側p=${f(Math.min(1, 2 * cum), 4)} （n=${nEff}銘柄、参考値）`)
  }
}

// ---------- 7. 早すぎる利確の代替検証：同銘柄・同方向の「次のトレード」 ----------
console.log('\n===== 7. 利確後・損切り後に同じ銘柄で建て直したか（往復の粘着性）=====')
{
  // 決済日と同日または翌営業日に同一コード・同方向で建て直しているか
  const byKey = new Map<string, P[]>()
  for (const p of known) {
    const k = `${p.code}|${p.side}`
    byKey.set(k, [...(byKey.get(k) ?? []), p])
  }
  let reW = 0
  let reL = 0
  let nW = 0
  let nL = 0
  for (const [, v] of byKey) {
    const s = [...v].sort((a, b) => (a.openDate ?? '').localeCompare(b.openDate ?? ''))
    for (let i = 0; i < s.length; i++) {
      const cur = s[i]
      const next = s.find((q) => (q.openDate as string) > cur.closeDate)
      const re = next
        ? (Date.parse(`${next.openDate}T00:00:00Z`) - Date.parse(`${cur.closeDate}T00:00:00Z`)) /
            86_400_000 <=
          3
        : false
      if (win(cur)) {
        nW++
        if (re) reW++
      } else if (loss(cur)) {
        nL++
        if (re) reL++
      }
    }
  }
  console.log(
    `利確後3日以内に同銘柄・同方向で建て直し: ${reW}/${nW} (${f((100 * reW) / nW, 1)}%)`,
  )
  console.log(
    `損切り後3日以内に同銘柄・同方向で建て直し: ${reL}/${nL} (${f((100 * reL) / nL, 1)}%)`,
  )
}
