/**
 * 担当：エントリー曜日・保有パターン
 * 実行: npx tsx scripts/analysis/entry-weekday-holding.ts
 */
import { loadAll, weekdayOf, WEEKDAY_JA, wilson, twoProportionP, permutationP } from '../_load'

const { positions } = loadAll()

const yen = (n: number) => `${n >= 0 ? '+' : ''}${Math.round(n).toLocaleString('ja-JP')}`
const pct = (n: number) => `${(n * 100).toFixed(1)}%`

type Row = { label: string; n: number; pnl: number; wins: number; losses: number; flat: number }

function agg(label: string, ps: typeof positions): Row {
  let pnl = 0, wins = 0, losses = 0, flat = 0
  for (const p of ps) {
    pnl += p.realizedPnl
    if (p.realizedPnl > 0) wins++
    else if (p.realizedPnl < 0) losses++
    else flat++
  }
  return { label, n: ps.length, pnl, wins, losses, flat }
}

function show(rows: Row[], title: string) {
  console.log(`\n=== ${title} ===`)
  console.log('区分\tn\t損益\t平均\t勝率\t勝/負\tWilson95%')
  for (const r of rows) {
    const wr = r.wins + r.losses > 0 ? r.wins / (r.wins + r.losses) : 0
    const w = wilson(r.wins, r.wins + r.losses)
    console.log(
      `${r.label}\t${r.n}\t${yen(r.pnl)}\t${yen(r.n ? r.pnl / r.n : 0)}\t${pct(wr)}\t${r.wins}/${r.losses}\t[${pct(w.lo)},${pct(w.hi)}]`,
    )
  }
}

// ---------- 0. 基礎 ----------
console.log('全建玉:', positions.length)
const withOpen = positions.filter((p) => p.openDate !== null)
console.log('openDateあり:', withOpen.length, '損益', yen(agg('', withOpen).pnl))
const noOpen = positions.filter((p) => p.openDate === null)
console.log('openDateなし(期間前建て):', noOpen.length, '損益', yen(agg('', noOpen).pnl))
console.log('全体損益:', yen(agg('', positions).pnl))
console.log('kind内訳(openDateあり):')
for (const k of ['cash', 'margin', 'fund'] as const) {
  const s = withOpen.filter((p) => p.kind === k)
  console.log(' ', k, s.length, yen(agg('', s).pnl))
}

// ---------- 1. エントリー曜日 vs 決済曜日 ----------
const byOpenWd: Row[] = []
for (let d = 0; d < 7; d++) {
  const s = withOpen.filter((p) => weekdayOf(p.openDate!) === d)
  if (s.length) byOpenWd.push(agg(WEEKDAY_JA[d], s))
}
show(byOpenWd, '1a. エントリー曜日（openDateあり n=' + withOpen.length + '）')

const byCloseWd: Row[] = []
for (let d = 0; d < 7; d++) {
  const s = positions.filter((p) => weekdayOf(p.closeDate) === d)
  if (s.length) byCloseWd.push(agg(WEEKDAY_JA[d], s))
}
show(byCloseWd, '1b. 決済曜日（全建玉 n=' + positions.length + '）')

const byCloseWdSame: Row[] = []
for (let d = 0; d < 7; d++) {
  const s = withOpen.filter((p) => weekdayOf(p.closeDate) === d)
  if (s.length) byCloseWdSame.push(agg(WEEKDAY_JA[d], s))
}
show(byCloseWdSame, '1c. 決済曜日（openDateありに限定・1aと同一母集団）')

// 検定：エントリー曜日で損益平均に差があるか（並べ替え検定）
{
  const vals = withOpen.map((p) => p.realizedPnl)
  const gi = withOpen.map((p) => weekdayOf(p.openDate!))
  console.log('\n[検定] エントリー曜日5群 損益 permutation p =', permutationP(vals, gi, 7).toFixed(4))
  const vals2 = positions.map((p) => p.realizedPnl)
  const gi2 = positions.map((p) => weekdayOf(p.closeDate))
  console.log('[検定] 決済曜日5群 損益 permutation p =', permutationP(vals2, gi2, 7).toFixed(4))
}

// デイトレ除外したエントリー曜日（交絡チェック：デイトレ比率）
console.log('\n[交絡] エントリー曜日ごとのデイトレ(holdingDays=0)比率と信用比率')
for (let d = 0; d < 5; d++) {
  const s = withOpen.filter((p) => weekdayOf(p.openDate!) === d)
  if (!s.length) continue
  const dt = s.filter((p) => p.holdingDays === 0)
  const mg = s.filter((p) => p.kind === 'margin')
  const sh = s.filter((p) => p.side === 'short')
  console.log(
    `  ${WEEKDAY_JA[d]} n=${s.length} デイトレ${pct(dt.length / s.length)} 信用${pct(mg.length / s.length)} 空売り${pct(sh.length / s.length)} 平均建代金${Math.round(s.reduce((a, p) => a + p.openPrice * p.quantity, 0) / s.length).toLocaleString()}`,
  )
}

// 層別：デイトレ / オーバーナイト別のエントリー曜日
for (const [lbl, filt] of [
  ['デイトレのみ', (p: (typeof positions)[0]) => p.holdingDays === 0],
  ['オーバーナイト(1日以上)', (p: (typeof positions)[0]) => (p.holdingDays ?? -1) > 0],
] as const) {
  const rows: Row[] = []
  for (let d = 0; d < 5; d++) {
    const s = withOpen.filter((p) => weekdayOf(p.openDate!) === d && filt(p))
    if (s.length) rows.push(agg(WEEKDAY_JA[d], s))
  }
  show(rows, `1d. エントリー曜日 × ${lbl}`)
}

// 主要銘柄を除いた層別（銘柄構成交絡チェック）
console.log('\n[交絡] エントリー曜日ごとの上位銘柄構成')
for (let d = 0; d < 5; d++) {
  const s = withOpen.filter((p) => weekdayOf(p.openDate!) === d)
  const m = new Map<string, number>()
  for (const p of s) m.set(p.code, (m.get(p.code) ?? 0) + 1)
  const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
  console.log(`  ${WEEKDAY_JA[d]}:`, top.map(([c, n]) => `${c}=${n}(${pct(n / s.length)})`).join(' '))
}

// 銘柄内でのエントリー曜日効果（上位5銘柄）
console.log('\n[層別] 主要銘柄ごとのエントリー曜日別損益')
const topCodes = ['9503', '5020', '8031', '9501', '3099', '7011']
for (const c of topCodes) {
  const s = withOpen.filter((p) => p.code === c)
  const parts: string[] = []
  for (let d = 0; d < 5; d++) {
    const g = s.filter((p) => weekdayOf(p.openDate!) === d)
    if (g.length) parts.push(`${WEEKDAY_JA[d]} n=${g.length} ${yen(agg('', g).pnl)}`)
  }
  console.log(`  ${c} (n=${s.length}):`, parts.join(' | '))
}

// ---------- 2. エントリー曜日 × 決済曜日 クロス ----------
console.log('\n=== 2. エントリー曜日 × 決済曜日 クロス表 ===')
console.log('（セル: n / 損益合計 / 勝率）')
const cross: { o: number; c: number; r: Row }[] = []
for (let o = 0; o < 5; o++) {
  const line: string[] = []
  for (let c = 0; c < 5; c++) {
    const s = withOpen.filter((p) => weekdayOf(p.openDate!) === o && weekdayOf(p.closeDate) === c)
    const r = agg(`${WEEKDAY_JA[o]}→${WEEKDAY_JA[c]}`, s)
    cross.push({ o, c, r })
    const wr = r.wins + r.losses ? r.wins / (r.wins + r.losses) : 0
    line.push(s.length ? `${WEEKDAY_JA[c]}:${r.n}/${yen(r.pnl)}/${pct(wr)}` : `${WEEKDAY_JA[c]}:-`)
  }
  console.log(`${WEEKDAY_JA[o]}→ ` + line.join('  '))
}
console.log('\n主要組み合わせ (n>=30) 損益順:')
for (const { r } of cross.filter((x) => x.r.n >= 30).sort((a, b) => a.r.pnl - b.r.pnl)) {
  const wr = r.wins + r.losses ? r.wins / (r.wins + r.losses) : 0
  console.log(`  ${r.label}\tn=${r.n}\t${yen(r.pnl)}\t平均${yen(r.pnl / r.n)}\t勝率${pct(wr)}`)
}
console.log('\n参考値 (n<30) 組み合わせ:')
for (const { r } of cross.filter((x) => x.r.n > 0 && x.r.n < 30).sort((a, b) => a.r.pnl - b.r.pnl)) {
  console.log(`  ${r.label}\tn=${r.n}\t${yen(r.pnl)}`)
}

// ---------- 3. 週初 vs 週末エントリー ----------
console.log('\n=== 3. 週初 vs 週末 エントリー ===')
const early = withOpen.filter((p) => weekdayOf(p.openDate!) <= 1) // 月火
const mid = withOpen.filter((p) => weekdayOf(p.openDate!) === 2) // 水
const late = withOpen.filter((p) => weekdayOf(p.openDate!) >= 3) // 木金
show([agg('週初(月火)', early), agg('週中(水)', mid), agg('週末(木金)', late)], '3a. 3分割')
{
  const a = agg('', early), b = agg('', late)
  console.log(
    '[検定] 週初 vs 週末 勝率 p =',
    twoProportionP(a.wins, a.wins + a.losses, b.wins, b.wins + b.losses).toFixed(4),
  )
  const vals = [...early, ...late].map((p) => p.realizedPnl)
  const gi = [...early.map(() => 0), ...late.map(() => 1)]
  console.log('[検定] 週初 vs 週末 損益 permutation p =', permutationP(vals, gi, 2).toFixed(4))
}
// 層別
for (const [lbl, filt] of [
  ['デイトレ', (p: (typeof positions)[0]) => p.holdingDays === 0],
  ['オーバーナイト', (p: (typeof positions)[0]) => (p.holdingDays ?? -1) > 0],
  ['信用', (p: (typeof positions)[0]) => p.kind === 'margin'],
  ['現物', (p: (typeof positions)[0]) => p.kind === 'cash'],
] as const) {
  show(
    [agg('週初(月火)', early.filter(filt)), agg('週中(水)', mid.filter(filt)), agg('週末(木金)', late.filter(filt))],
    `3b. 週初/週末 × ${lbl}`,
  )
}

// ---------- 4. 週またぎ ----------
console.log('\n=== 4. 週またぎ玉 ===')
function isoWeek(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day) // 月曜へ
  return d.toISOString().slice(0, 10)
}
const sameDay = withOpen.filter((p) => p.holdingDays === 0)
const sameWeek = withOpen.filter((p) => p.holdingDays! > 0 && isoWeek(p.openDate!) === isoWeek(p.closeDate))
const crossWeek = withOpen.filter((p) => isoWeek(p.openDate!) !== isoWeek(p.closeDate))
show([agg('同日(デイトレ)', sameDay), agg('同一週内(1日以上)', sameWeek), agg('週またぎ', crossWeek)], '4a. 週またぎ有無')
{
  const a = agg('', sameWeek), b = agg('', crossWeek)
  console.log(
    '[検定] 同一週内 vs 週またぎ 勝率 p =',
    twoProportionP(a.wins, a.wins + a.losses, b.wins, b.wins + b.losses).toFixed(4),
  )
  const vals = [...sameWeek, ...crossWeek].map((p) => p.realizedPnl)
  const gi = [...sameWeek.map(() => 0), ...crossWeek.map(() => 1)]
  console.log('[検定] 同一週内 vs 週またぎ 損益 permutation p =', permutationP(vals, gi, 2).toFixed(4))
}
// 週またぎ本数
console.log('\n4b. またいだ週数別')
const wkRows: Row[] = []
const weeksSpan = (p: (typeof positions)[0]) => {
  const a = new Date(`${isoWeek(p.openDate!)}T00:00:00Z`).getTime()
  const b = new Date(`${isoWeek(p.closeDate)}T00:00:00Z`).getTime()
  return Math.round((b - a) / (7 * 86400000))
}
const spanMap = new Map<number, typeof positions>()
for (const p of withOpen) {
  const w = weeksSpan(p)
  const key = w >= 4 ? 4 : w
  if (!spanMap.has(key)) spanMap.set(key, [])
  spanMap.get(key)!.push(p)
}
for (const k of [...spanMap.keys()].sort((a, b) => a - b))
  wkRows.push(agg(k === 0 ? '同一週' : k === 4 ? '4週以上またぎ' : `${k}週またぎ`, spanMap.get(k)!))
show(wkRows, '4b. またいだ週数')

// 金曜エントリー→翌週決済
console.log('\n4c. 金曜エントリーの行方')
const fri = withOpen.filter((p) => weekdayOf(p.openDate!) === 4)
show(
  [
    agg('金→同日決済', fri.filter((p) => p.holdingDays === 0)),
    agg('金→週またぎ', fri.filter((p) => isoWeek(p.openDate!) !== isoWeek(p.closeDate))),
  ],
  '4c. 金曜エントリー',
)
// 週末持ち越し（金→翌週）を曜日別に比較：各曜日のオーバーナイト玉のうち週またぎ率
console.log('\n4d. エントリー曜日別 週またぎ率と週またぎ玉の成績')
for (let d = 0; d < 5; d++) {
  const s = withOpen.filter((p) => weekdayOf(p.openDate!) === d)
  const cw = s.filter((p) => isoWeek(p.openDate!) !== isoWeek(p.closeDate))
  const r = agg('', cw)
  console.log(
    `  ${WEEKDAY_JA[d]}: 週またぎ ${cw.length}/${s.length} (${pct(s.length ? cw.length / s.length : 0)}) 損益${yen(r.pnl)} 勝率${pct(r.wins + r.losses ? r.wins / (r.wins + r.losses) : 0)}`,
  )
}

// ---------- 5. 月内の位置 ----------
console.log('\n=== 5. 月内の位置 ===')
const dom = (iso: string) => Number(iso.slice(8, 10))
function monthPart(iso: string): 0 | 1 | 2 {
  const d = dom(iso)
  return d <= 10 ? 0 : d <= 20 ? 1 : 2
}
const MP = ['月初(1-10日)', '月中(11-20日)', '月末(21日-)']
show(
  [0, 1, 2].map((i) => agg(MP[i], withOpen.filter((p) => monthPart(p.openDate!) === i))),
  '5a. エントリー日の月内位置',
)
show(
  [0, 1, 2].map((i) => agg(MP[i], positions.filter((p) => monthPart(p.closeDate) === i))),
  '5b. 決済日の月内位置（全建玉）',
)
{
  const vals = withOpen.map((p) => p.realizedPnl)
  const gi = withOpen.map((p) => monthPart(p.openDate!))
  console.log('[検定] エントリー月内位置3群 損益 permutation p =', permutationP(vals, gi, 3).toFixed(4))
  const v2 = positions.map((p) => p.realizedPnl)
  const g2 = positions.map((p) => monthPart(p.closeDate))
  console.log('[検定] 決済月内位置3群 損益 permutation p =', permutationP(v2, g2, 3).toFixed(4))
}
// 営業日ベースの月内位置（決済日）
console.log('\n5c. 決済日 日付別（5日刻み）')
const binRows: Row[] = []
for (let b = 0; b < 7; b++) {
  const lo = b * 5 + 1, hi = b === 6 ? 31 : b * 5 + 5
  const s = positions.filter((p) => dom(p.closeDate) >= lo && dom(p.closeDate) <= hi)
  if (s.length) binRows.push(agg(`${lo}-${hi}日`, s))
}
show(binRows, '5c. 決済日 5日刻み')

// ---------- 6. 月別推移 ----------
console.log('\n=== 6. 月別推移 ===')
const months = [...new Set(positions.map((p) => p.closeDate.slice(0, 7)))].sort()
const mRows: Row[] = []
let cum = 0
console.log('月\tn\t損益\t累積\t平均\t勝率')
for (const m of months) {
  const s = positions.filter((p) => p.closeDate.slice(0, 7) === m)
  const r = agg(m, s)
  mRows.push(r)
  cum += r.pnl
  const wr = r.wins + r.losses ? r.wins / (r.wins + r.losses) : 0
  console.log(`${m}\t${r.n}\t${yen(r.pnl)}\t${yen(cum)}\t${yen(r.pnl / r.n)}\t${pct(wr)}`)
}
// エントリー月ベース
console.log('\n6b. エントリー月ベース（openDateあり）')
const oMonths = [...new Set(withOpen.map((p) => p.openDate!.slice(0, 7)))].sort()
for (const m of oMonths) {
  const s = withOpen.filter((p) => p.openDate!.slice(0, 7) === m)
  const r = agg(m, s)
  const wr = r.wins + r.losses ? r.wins / (r.wins + r.losses) : 0
  console.log(`${m}\t${r.n}\t${yen(r.pnl)}\t平均${yen(r.pnl / r.n)}\t勝率${pct(wr)}`)
}

// 前半 vs 後半（決済日で時系列を2分割：件数で半分）
console.log('\n6c. 前半 vs 後半')
const sorted = [...positions].sort((a, b) =>
  a.closeDate < b.closeDate ? -1 : a.closeDate > b.closeDate ? 1 : a.id < b.id ? -1 : 1,
)
const half = Math.floor(sorted.length / 2)
const h1 = sorted.slice(0, half), h2 = sorted.slice(half)
console.log(`前半: ${h1[0].closeDate} 〜 ${h1[h1.length - 1].closeDate}`)
console.log(`後半: ${h2[0].closeDate} 〜 ${h2[h2.length - 1].closeDate}`)
show([agg('前半(件数半分)', h1), agg('後半(件数半分)', h2)], '6c-1. 件数で2分割')
{
  const a = agg('', h1), b = agg('', h2)
  console.log(
    '[検定] 前半 vs 後半 勝率 p =',
    twoProportionP(a.wins, a.wins + a.losses, b.wins, b.wins + b.losses).toFixed(4),
  )
  const vals = sorted.map((p) => p.realizedPnl)
  const gi = sorted.map((_, i) => (i < half ? 0 : 1))
  console.log('[検定] 前半 vs 後半 損益 permutation p =', permutationP(vals, gi, 2).toFixed(4))
}
// 暦で2分割（2025-08〜2026-02 / 2026-03〜2026-07）
const cal1 = positions.filter((p) => p.closeDate < '2026-02-15')
const cal2 = positions.filter((p) => p.closeDate >= '2026-02-15')
show([agg('前半(〜2026-02-14)', cal1), agg('後半(2026-02-15〜)', cal2)], '6c-2. 暦で2分割')
{
  const a = agg('', cal1), b = agg('', cal2)
  console.log(
    '[検定] 暦2分割 勝率 p =',
    twoProportionP(a.wins, a.wins + a.losses, b.wins, b.wins + b.losses).toFixed(4),
  )
  const vals = [...cal1, ...cal2].map((p) => p.realizedPnl)
  const gi = [...cal1.map(() => 0), ...cal2.map(() => 1)]
  console.log('[検定] 暦2分割 損益 permutation p =', permutationP(vals, gi, 2).toFixed(4))
}
// 4分割（学習曲線）
console.log('\n6d. 4分割（件数等分）')
const q = Math.floor(sorted.length / 4)
const quarters = [sorted.slice(0, q), sorted.slice(q, 2 * q), sorted.slice(2 * q, 3 * q), sorted.slice(3 * q)]
show(
  quarters.map((s, i) => agg(`Q${i + 1} (${s[0].closeDate}〜${s[s.length - 1].closeDate})`, s)),
  '6d. 4分割',
)
{
  const vals = sorted.map((p) => p.realizedPnl)
  const gi = sorted.map((_, i) => Math.min(3, Math.floor(i / q)))
  console.log('[検定] 4分割 損益 permutation p =', permutationP(vals, gi, 4).toFixed(4))
  const gw = quarters.map((s) => agg('', s))
  console.log(
    '[検定] Q1 vs Q4 勝率 p =',
    twoProportionP(gw[0].wins, gw[0].wins + gw[0].losses, gw[3].wins, gw[3].wins + gw[3].losses).toFixed(4),
  )
}
// 交絡：時期ごとの取引スタイル変化
console.log('\n[交絡] 4分割ごとのスタイル')
for (let i = 0; i < 4; i++) {
  const s = quarters[i]
  const dt = s.filter((p) => p.holdingDays === 0).length
  const mg = s.filter((p) => p.kind === 'margin').length
  const sh = s.filter((p) => p.side === 'short').length
  const avgSize = s.reduce((a, p) => a + p.openPrice * p.quantity, 0) / s.length
  const codes = new Set(s.map((p) => p.code)).size
  const m = new Map<string, number>()
  for (const p of s) m.set(p.code, (m.get(p.code) ?? 0) + 1)
  const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  console.log(
    `  Q${i + 1}: デイトレ${pct(dt / s.length)} 信用${pct(mg / s.length)} 空売り${pct(sh / s.length)} 平均建代金${Math.round(avgSize).toLocaleString()} 銘柄数${codes} 上位:${top.map(([c, n]) => `${c}=${n}`).join(',')}`,
  )
}
// 前後半 × 主要銘柄で層別
console.log('\n[層別] 主要銘柄ごとの前半/後半')
for (const c of topCodes) {
  const a = agg('', cal1.filter((p) => p.code === c))
  const b = agg('', cal2.filter((p) => p.code === c))
  console.log(`  ${c}: 前半 n=${a.n} ${yen(a.pnl)} / 後半 n=${b.n} ${yen(b.pnl)}`)
}
// デイトレのみで前後半
show(
  [
    agg('前半デイトレ', cal1.filter((p) => p.holdingDays === 0)),
    agg('後半デイトレ', cal2.filter((p) => p.holdingDays === 0)),
  ],
  '6e. デイトレに限定した前後半',
)
show(
  [
    agg('前半ON', cal1.filter((p) => (p.holdingDays ?? -1) > 0)),
    agg('後半ON', cal2.filter((p) => (p.holdingDays ?? -1) > 0)),
  ],
  '6f. オーバーナイトに限定した前後半',
)

// 月別の勝率トレンド（相関）
console.log('\n6g. 月別の平均損益トレンド（Spearman風：順位相関）')
{
  const xs = mRows.map((_, i) => i)
  const ys = mRows.map((r) => r.pnl / r.n)
  const rank = (arr: number[]) => {
    const idx = arr.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0])
    const r = new Array(arr.length)
    idx.forEach(([, i], k) => (r[i] = k + 1))
    return r
  }
  const rx = rank(xs), ry = rank(ys)
  const n = xs.length
  const d2 = rx.reduce((a, v, i) => a + (v - ry[i]) ** 2, 0)
  const rho = 1 - (6 * d2) / (n * (n * n - 1))
  console.log(`  月順位 vs 平均損益順位 rho = ${rho.toFixed(3)} (n=${n}ヶ月)`)
  const ys2 = mRows.map((r) => r.wins / (r.wins + r.losses))
  const ry2 = rank(ys2)
  const d22 = rx.reduce((a, v, i) => a + (v - ry2[i]) ** 2, 0)
  console.log(`  月順位 vs 勝率順位 rho = ${(1 - (6 * d22) / (n * (n * n - 1))).toFixed(3)}`)
}

// 外れ値の影響
console.log('\n[頑健性] 上下の外れ値を除いたときの前後半')
{
  const trim = (ps: typeof positions, k = 3) => {
    const s = [...ps].sort((a, b) => a.realizedPnl - b.realizedPnl)
    return s.slice(k, s.length - k)
  }
  const a = agg('前半(上下3件除外)', trim(cal1))
  const b = agg('後半(上下3件除外)', trim(cal2))
  show([a, b], '6h. トリム後')
  console.log('  前半 最大益/最大損:', yen(Math.max(...cal1.map((p) => p.realizedPnl))), yen(Math.min(...cal1.map((p) => p.realizedPnl))))
  console.log('  後半 最大益/最大損:', yen(Math.max(...cal2.map((p) => p.realizedPnl))), yen(Math.min(...cal2.map((p) => p.realizedPnl))))
  // 中央値
  const med = (ps: typeof positions) => {
    const s = ps.map((p) => p.realizedPnl).sort((x, y) => x - y)
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
  }
  console.log('  中央値 前半:', yen(med(cal1)), '後半:', yen(med(cal2)))
}
