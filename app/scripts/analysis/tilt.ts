/**
 * 連敗・連勝後の挙動（ティルト）分析
 */
import { loadAll, wilson, twoProportionP, permutationP } from '../_load'

const { positions } = loadAll()

// ---- 0. 時系列の担保 ----
// buildPositions は 日付→open先→seq の順に約定を処理し、決済時に push する。
// よって positions 配列はすでに「決済約定の時系列順」になっているはず。検証する。
let sortedOk = true
for (let i = 1; i < positions.length; i++) {
  if (positions[i].closeDate < positions[i - 1].closeDate) sortedOk = false
}
console.log('=== 0. 前提チェック ===')
console.log('建玉数:', positions.length, '/ closeDate昇順:', sortedOk)
console.log('合計損益:', positions.reduce((s, p) => s + p.realizedPnl, 0).toFixed(0))
const wins0 = positions.filter((p) => p.realizedPnl > 0).length
const zero0 = positions.filter((p) => p.realizedPnl === 0).length
console.log('勝:', wins0, '負:', positions.filter((p) => p.realizedPnl < 0).length, '±0:', zero0)

// 決済約定の単位（＝人間の1回の売り注文）でまとめ直す。
// id = `${execId}#${openDate}#${qty}` または `${execId}#orphan`、execId = `${base}#${dupSeq}`
function execKey(id: string): string {
  const parts = id.split('#')
  return parts.slice(0, 2).join('#')
}

interface Ev {
  i: number
  key: string
  date: string
  code: string
  name: string
  side: string
  kind: string
  n: number // 束ねた建玉数
  qty: number
  notional: number // 建て時の想定元本 = openPrice*qty（orphanは決済単価で代用）
  pnl: number
  holdMax: number | null
}

const byExec = new Map<string, Ev>()
for (const p of positions) {
  const k = execKey(p.id)
  const notional = (p.openPrice > 0 ? p.openPrice : p.closePrice) * p.quantity
  const e = byExec.get(k)
  if (e) {
    e.n++
    e.qty += p.quantity
    e.notional += notional
    e.pnl += p.realizedPnl
    if (p.holdingDays !== null) e.holdMax = Math.max(e.holdMax ?? 0, p.holdingDays)
  } else {
    byExec.set(k, {
      i: byExec.size,
      key: k,
      date: p.closeDate,
      code: p.code,
      name: p.name,
      side: p.side,
      kind: p.kind,
      n: 1,
      qty: p.quantity,
      notional,
      pnl: p.realizedPnl,
      holdMax: p.holdingDays,
    })
  }
}
const evs = [...byExec.values()]
console.log('決済約定単位のイベント数:', evs.length)
const splitCount = evs.filter((e) => e.n > 1).length
console.log('複数建玉に割れた決済:', splitCount, '件（同一損益符号が連鎖する見かけの連敗の原因）')

// ---- 汎用ヘルパ ----
const isWin = (x: number) => x > 0
const fmt = (x: number) => Math.round(x).toLocaleString('ja-JP')

function stats(rows: { pnl: number }[]) {
  const n = rows.length
  const w = rows.filter((r) => isWin(r.pnl)).length
  const sum = rows.reduce((s, r) => s + r.pnl, 0)
  return { n, w, wr: n ? w / n : 0, sum, ev: n ? sum / n : 0 }
}

function line(label: string, rows: { pnl: number }[]) {
  const s = stats(rows)
  const ci = wilson(s.w, s.n)
  console.log(
    `${label.padEnd(26)} n=${String(s.n).padStart(5)} 勝率=${(s.wr * 100).toFixed(1)}% ` +
      `[${(ci.lo * 100).toFixed(1)}-${(ci.hi * 100).toFixed(1)}] ` +
      `合計=${fmt(s.sum).padStart(10)} 期待値=${fmt(s.ev).padStart(7)}`,
  )
}

// =========================================================
// 1&2. 直前n件の結果別
// =========================================================
function runPrevAnalysis(list: Ev[], title: string) {
  console.log(`\n=== ${title} ===`)
  // 直前1件
  const afterLoss: Ev[] = []
  const afterWin: Ev[] = []
  for (let i = 1; i < list.length; i++) {
    if (isWin(list[i - 1].pnl)) afterWin.push(list[i])
    else afterLoss.push(list[i])
  }
  line('直前1件が勝ち→次', afterWin)
  line('直前1件が負け→次', afterLoss)
  const sw = stats(afterWin)
  const sl = stats(afterLoss)
  console.log(
    '  勝率差 p =',
    twoProportionP(sw.w, sw.n, sl.w, sl.n).toFixed(4),
    '/ 損益の並べ替え検定 p =',
    permutationP(
      [...afterWin, ...afterLoss].map((e) => e.pnl),
      [...afterWin.map(() => 0), ...afterLoss.map(() => 1)],
      2,
    ).toFixed(4),
  )

  // 直前n連敗 / n連勝
  for (const n of [1, 2, 3, 4, 5]) {
    const afterNLoss: Ev[] = []
    const afterNWin: Ev[] = []
    for (let i = n; i < list.length; i++) {
      const prev = list.slice(i - n, i)
      if (prev.every((p) => !isWin(p.pnl))) afterNLoss.push(list[i])
      if (prev.every((p) => isWin(p.pnl))) afterNWin.push(list[i])
    }
    line(`直前${n}連敗の直後`, afterNLoss)
    line(`直前${n}連勝の直後`, afterNWin)
    const a = stats(afterNLoss)
    const b = stats(afterNWin)
    console.log('    連敗後vs連勝後 勝率p =', twoProportionP(a.w, a.n, b.w, b.n).toFixed(4))
  }
  return { afterWin, afterLoss }
}

runPrevAnalysis(evs, '1&2. 直前の結果別（決済約定単位 n=' + evs.length + '）')
runPrevAnalysis(positions.map((p, i) => ({ ...p, i, pnl: p.realizedPnl }) as unknown as Ev), '1&2b. 参考：建玉単位（分割決済で連鎖するため過大評価される）')

// =========================================================
// 3. 連敗中のポジションサイズ
// =========================================================
console.log('\n=== 3. 直前の連敗本数別のポジションサイズ ===')
// 連敗本数（そのトレードの直前まで何連敗していたか）
const lossRun: number[] = new Array(evs.length).fill(0)
let run = 0
for (let i = 0; i < evs.length; i++) {
  lossRun[i] = run
  run = isWin(evs[i].pnl) ? 0 : run + 1
}
const winRun: number[] = new Array(evs.length).fill(0)
let wrun = 0
for (let i = 0; i < evs.length; i++) {
  winRun[i] = wrun
  wrun = isWin(evs[i].pnl) ? wrun + 1 : 0
}

function median(a: number[]) {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

for (const bucket of [
  { lab: '連敗0（直前勝ち/初回）', f: (i: number) => lossRun[i] === 0 },
  { lab: '1連敗中', f: (i: number) => lossRun[i] === 1 },
  { lab: '2連敗中', f: (i: number) => lossRun[i] === 2 },
  { lab: '3連敗中', f: (i: number) => lossRun[i] === 3 },
  { lab: '4連敗中', f: (i: number) => lossRun[i] === 4 },
  { lab: '5連敗以上', f: (i: number) => lossRun[i] >= 5 },
]) {
  const idx = evs.map((_, i) => i).filter(bucket.f)
  const nots = idx.map((i) => evs[i].notional)
  const s = stats(idx.map((i) => evs[i]))
  console.log(
    `${bucket.lab.padEnd(22)} n=${String(idx.length).padStart(4)} ` +
      `元本中央値=${fmt(median(nots)).padStart(9)} 平均=${fmt(nots.reduce((a, b) => a + b, 0) / (idx.length || 1)).padStart(9)} ` +
      `勝率=${(s.wr * 100).toFixed(1)}% 期待値=${fmt(s.ev).padStart(7)}`,
  )
}
console.log('--- 連勝中 ---')
for (const bucket of [
  { lab: '1連勝中', f: (i: number) => winRun[i] === 1 },
  { lab: '2連勝中', f: (i: number) => winRun[i] === 2 },
  { lab: '3連勝以上', f: (i: number) => winRun[i] >= 3 },
]) {
  const idx = evs.map((_, i) => i).filter(bucket.f)
  const nots = idx.map((i) => evs[i].notional)
  const s = stats(idx.map((i) => evs[i]))
  console.log(
    `${bucket.lab.padEnd(22)} n=${String(idx.length).padStart(4)} ` +
      `元本中央値=${fmt(median(nots)).padStart(9)} 平均=${fmt(nots.reduce((a, b) => a + b, 0) / (idx.length || 1)).padStart(9)} ` +
      `勝率=${(s.wr * 100).toFixed(1)}% 期待値=${fmt(s.ev).padStart(7)}`,
  )
}

// 交絡：銘柄構成。連敗中に出やすい銘柄は？
console.log('\n--- 交絡チェック：連敗3以上のときの銘柄構成 ---')
const deepIdx = evs.map((_, i) => i).filter((i) => lossRun[i] >= 3)
const cnt = new Map<string, number>()
for (const i of deepIdx) cnt.set(evs[i].code + ' ' + evs[i].name, (cnt.get(evs[i].code + ' ' + evs[i].name) ?? 0) + 1)
console.log([...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(' / '))
const allCnt = new Map<string, number>()
for (const e of evs) allCnt.set(e.code + ' ' + e.name, (allCnt.get(e.code + ' ' + e.name) ?? 0) + 1)
console.log('全体:', [...allCnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(' / '))

// 銘柄内で層別：主要銘柄ごとに 連敗中 vs 非連敗中
console.log('\n--- 銘柄で層別（連敗2以上 vs それ以外）---')
for (const [codeName] of [...allCnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  const idxs = evs.map((_, i) => i).filter((i) => evs[i].code + ' ' + evs[i].name === codeName)
  const inStreak = idxs.filter((i) => lossRun[i] >= 2).map((i) => evs[i])
  const out = idxs.filter((i) => lossRun[i] < 2).map((i) => evs[i])
  const a = stats(inStreak)
  const b = stats(out)
  console.log(
    `${codeName.padEnd(18)} 連敗2+中: n=${String(a.n).padStart(3)} 勝率${(a.wr * 100).toFixed(0)}% EV=${fmt(a.ev).padStart(7)} | ` +
      `平常: n=${String(b.n).padStart(3)} 勝率${(b.wr * 100).toFixed(0)}% EV=${fmt(b.ev).padStart(7)}`,
  )
}

// =========================================================
// 5. 同日内 vs 日跨ぎの連敗
// =========================================================
console.log('\n=== 5. 同日内連敗 vs 日跨ぎ連敗 ===')
const sameDayPrev: Ev[] = []
const crossDayPrev: Ev[] = []
for (let i = 1; i < evs.length; i++) {
  if (isWin(evs[i - 1].pnl)) continue
  if (evs[i].date === evs[i - 1].date) sameDayPrev.push(evs[i])
  else crossDayPrev.push(evs[i])
}
line('直前負け・同日中の次玉', sameDayPrev)
line('直前負け・翌営業日以降', crossDayPrev)
{
  const a = stats(sameDayPrev)
  const b = stats(crossDayPrev)
  console.log('  勝率p =', twoProportionP(a.w, a.n, b.w, b.n).toFixed(4))
}
// 直前勝ちの同日/日跨ぎも対照として
const sdW: Ev[] = []
const cdW: Ev[] = []
for (let i = 1; i < evs.length; i++) {
  if (!isWin(evs[i - 1].pnl)) continue
  if (evs[i].date === evs[i - 1].date) sdW.push(evs[i])
  else cdW.push(evs[i])
}
line('直前勝ち・同日中の次玉', sdW)
line('直前勝ち・翌営業日以降', cdW)

// 連敗が同日で完結するか日を跨ぐか
console.log('\n--- 連敗ランの内訳（同日完結 / 日跨ぎ）---')
interface Run { start: number; end: number; len: number; win: boolean }
const runs: Run[] = []
{
  let s = 0
  for (let i = 1; i <= evs.length; i++) {
    if (i === evs.length || isWin(evs[i].pnl) !== isWin(evs[s].pnl)) {
      runs.push({ start: s, end: i - 1, len: i - s, win: isWin(evs[s].pnl) })
      s = i
    }
  }
}
const lossRuns = runs.filter((r) => !r.win)
const winRuns = runs.filter((r) => r.win)
console.log('連敗ラン数:', lossRuns.length, '最長:', Math.max(...lossRuns.map((r) => r.len)))
console.log('連勝ラン数:', winRuns.length, '最長:', Math.max(...winRuns.map((r) => r.len)))
for (const minLen of [2, 3, 5]) {
  const rs = lossRuns.filter((r) => r.len >= minLen)
  const same = rs.filter((r) => evs[r.start].date === evs[r.end].date)
  const sameSum = same.reduce((s, r) => s + evs.slice(r.start, r.end + 1).reduce((a, e) => a + e.pnl, 0), 0)
  const crossSum = rs.filter((r) => evs[r.start].date !== evs[r.end].date)
    .reduce((s, r) => s + evs.slice(r.start, r.end + 1).reduce((a, e) => a + e.pnl, 0), 0)
  console.log(
    `${minLen}連敗以上のラン: ${rs.length}本 うち同日完結 ${same.length}本(損益計${fmt(sameSum)}) / 日跨ぎ ${rs.length - same.length}本(損益計${fmt(crossSum)})`,
  )
}

// 日単位の連敗（その日のトータルが負けだった翌営業日）
console.log('\n--- 日単位：負けた日の翌取引日 ---')
const dayMap = new Map<string, Ev[]>()
for (const e of evs) {
  const a = dayMap.get(e.date) ?? []
  a.push(e)
  dayMap.set(e.date, a)
}
const days = [...dayMap.keys()].sort()
const dayPnl = days.map((d) => dayMap.get(d)!.reduce((s, e) => s + e.pnl, 0))
console.log('取引日数:', days.length, '勝ち日:', dayPnl.filter((x) => x > 0).length, '負け日:', dayPnl.filter((x) => x < 0).length)
for (const n of [1, 2, 3]) {
  const after: number[] = []
  const afterW: number[] = []
  for (let i = n; i < days.length; i++) {
    if (dayPnl.slice(i - n, i).every((x) => x < 0)) after.push(dayPnl[i])
    if (dayPnl.slice(i - n, i).every((x) => x > 0)) afterW.push(dayPnl[i])
  }
  const s = (a: number[]) => `n=${a.length} 平均=${fmt(a.reduce((x, y) => x + y, 0) / (a.length || 1))} 勝ち日率=${((a.filter((x) => x > 0).length / (a.length || 1)) * 100).toFixed(0)}%`
  console.log(`  ${n}日連続負けの翌日: ${s(after)} | ${n}日連続勝ちの翌日: ${s(afterW)}`)
}
// 負けた日の当日中の枚数（元本）推移：日内で損失が膨らんだ後にサイズを上げているか
console.log('\n--- 日内：その日の累積損益がマイナスに沈んだ後の元本 ---')
let underN = 0, underSum = 0, overN = 0, overSum = 0
let underPnl = 0, overPnl = 0
for (const d of days) {
  const list = dayMap.get(d)!
  let cum = 0
  for (const e of list) {
    if (cum < 0) { underN++; underSum += e.notional; underPnl += e.pnl } else { overN++; overSum += e.notional; overPnl += e.pnl }
    cum += e.pnl
  }
}
console.log(`日内累損マイナス下での約定: n=${underN} 平均元本=${fmt(underSum / underN)} 損益計=${fmt(underPnl)} EV=${fmt(underPnl / underN)}`)
console.log(`日内累損プラス/ゼロ:      n=${overN} 平均元本=${fmt(overSum / overN)} 損益計=${fmt(overPnl)} EV=${fmt(overPnl / overN)}`)

// =========================================================
// 4. 最長連敗・最長連勝の中身
// =========================================================
console.log('\n=== 4. 最長ランの中身 ===')
function dumpRun(r: Run, label: string) {
  console.log(`\n--- ${label}: ${r.len}連続 ${evs[r.start].date} 〜 ${evs[r.end].date} 合計=${fmt(evs.slice(r.start, r.end + 1).reduce((s, e) => s + e.pnl, 0))} ---`)
  for (let i = r.start; i <= r.end; i++) {
    const e = evs[i]
    console.log(
      `${e.date} ${e.code} ${e.name.padEnd(10)} ${e.side === 'long' ? '買' : '空'} ${e.kind} 数量${String(e.qty).padStart(5)} 元本${fmt(e.notional).padStart(9)} 保有${e.holdMax}日 損益${fmt(e.pnl).padStart(8)}`,
    )
  }
}
const topLoss = [...lossRuns].sort((a, b) => b.len - a.len).slice(0, 3)
const topWin = [...winRuns].sort((a, b) => b.len - a.len).slice(0, 3)
for (const r of topLoss) dumpRun(r, '最長連敗')
for (const r of topWin) dumpRun(r, '最長連勝')

// 建玉単位での最長ランも（設問の25/15と突き合わせ）
{
  const pr = positions.map((p) => p.realizedPnl > 0)
  let best = 0, bestS = 0, s = 0
  for (let i = 1; i <= pr.length; i++) {
    if (i === pr.length || pr[i] !== pr[s]) {
      if (!pr[s] && i - s > best) { best = i - s; bestS = s }
      s = i
    }
  }
  console.log(`\n[建玉単位] 最長連敗=${best} ${positions[bestS].closeDate}〜${positions[bestS + best - 1].closeDate}`)
  let bw = 0, bwS = 0; s = 0
  for (let i = 1; i <= pr.length; i++) {
    if (i === pr.length || pr[i] !== pr[s]) {
      if (pr[s] && i - s > bw) { bw = i - s; bwS = s }
      s = i
    }
  }
  console.log(`[建玉単位] 最長連勝=${bw} ${positions[bwS].closeDate}〜${positions[bwS + bw - 1].closeDate}`)
}

// =========================================================
// 6. 最大ドローダウン
// =========================================================
console.log('\n=== 6. 最大ドローダウン（決済約定の時系列・累積実現損益）===')
let cum = 0, peak = 0, peakI = -1, mdd = 0, mddPeakI = -1, mddTroughI = -1
const cums: number[] = []
for (let i = 0; i < evs.length; i++) {
  cum += evs[i].pnl
  cums.push(cum)
  if (cum > peak) { peak = cum; peakI = i }
  const dd = peak - cum
  if (dd > mdd) { mdd = dd; mddPeakI = peakI; mddTroughI = i }
}
console.log(`最大DD = ${fmt(mdd)}円`)
console.log(`ピーク: ${mddPeakI >= 0 ? evs[mddPeakI].date : '開始前'} 累積${fmt(mddPeakI >= 0 ? cums[mddPeakI] : 0)} (#${mddPeakI + 1})`)
console.log(`ボトム: ${evs[mddTroughI].date} 累積${fmt(cums[mddTroughI])} (#${mddTroughI + 1})`)
console.log(`区間の約定数: ${mddTroughI - mddPeakI}件 / 日数: ${(Date.parse(evs[mddTroughI].date) - Date.parse(evs[Math.max(mddPeakI, 0)].date)) / 86400000}日`)

// 区間の内訳
{
  const seg = evs.slice(mddPeakI + 1, mddTroughI + 1)
  const s = stats(seg)
  console.log(`区間内: n=${s.n} 勝率=${(s.wr * 100).toFixed(1)}% 合計=${fmt(s.sum)}`)
  const byCode = new Map<string, { n: number; pnl: number }>()
  for (const e of seg) {
    const k = e.code + ' ' + e.name
    const c = byCode.get(k) ?? { n: 0, pnl: 0 }
    c.n++; c.pnl += e.pnl; byCode.set(k, c)
  }
  console.log('銘柄別（損失大きい順）:')
  for (const [k, v] of [...byCode.entries()].sort((a, b) => a[1].pnl - b[1].pnl).slice(0, 10)) {
    console.log(`  ${k.padEnd(18)} n=${String(v.n).padStart(3)} 損益=${fmt(v.pnl).padStart(9)}`)
  }
  // 日別
  const byDay = new Map<string, { n: number; pnl: number }>()
  for (const e of seg) {
    const c = byDay.get(e.date) ?? { n: 0, pnl: 0 }
    c.n++; c.pnl += e.pnl; byDay.set(e.date, c)
  }
  const dl = [...byDay.entries()].sort()
  console.log(`区間の取引日数: ${dl.length}`)
  console.log('日別（損失の大きい日トップ10）:')
  for (const [k, v] of [...dl].sort((a, b) => a[1].pnl - b[1].pnl).slice(0, 10)) {
    console.log(`  ${k} n=${String(v.n).padStart(3)} 損益=${fmt(v.pnl).padStart(9)}`)
  }
  console.log('区間の日別推移（全日）:')
  let c2 = cums[mddPeakI] ?? 0
  for (const [k, v] of dl) {
    c2 += v.pnl
    console.log(`  ${k} n=${String(v.n).padStart(3)} 当日${fmt(v.pnl).padStart(9)} 累積${fmt(c2).padStart(10)}`)
  }
}

// 参考：全期間の累積推移（月次）
console.log('\n--- 月次の実現損益 ---')
const byMonth = new Map<string, { n: number; pnl: number }>()
for (const e of evs) {
  const m = e.date.slice(0, 7)
  const c = byMonth.get(m) ?? { n: 0, pnl: 0 }
  c.n++; c.pnl += e.pnl; byMonth.set(m, c)
}
let mc = 0
for (const [m, v] of [...byMonth.entries()].sort()) {
  mc += v.pnl
  console.log(`  ${m} n=${String(v.n).padStart(4)} 当月${fmt(v.pnl).padStart(10)} 累積${fmt(mc).padStart(10)}`)
}
