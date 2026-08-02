/**
 * 担当：曜日 × 方向（long/short）の分解
 * 「月曜の勝率が悪いのはなぜか」をデータで分解する。
 */
import { loadAll, weekdayOf, WEEKDAY_JA, wilson, twoProportionP, permutationP } from '../_load'

const { positions } = loadAll()

const yen = (n: number) => `${n >= 0 ? '+' : ''}${Math.round(n).toLocaleString('ja-JP')}`
const pct = (n: number) => `${(n * 100).toFixed(1)}%`

type P = (typeof positions)[number]

function agg(rows: P[]) {
  const n = rows.length
  const wins = rows.filter((r) => r.realizedPnl > 0).length
  const losses = rows.filter((r) => r.realizedPnl < 0).length
  const flats = n - wins - losses
  const pnl = rows.reduce((s, r) => s + r.realizedPnl, 0)
  const winRows = rows.filter((r) => r.realizedPnl > 0)
  const lossRows = rows.filter((r) => r.realizedPnl < 0)
  const avgWin = winRows.length ? winRows.reduce((s, r) => s + r.realizedPnl, 0) / winRows.length : 0
  const avgLoss = lossRows.length ? lossRows.reduce((s, r) => s + r.realizedPnl, 0) / lossRows.length : 0
  return {
    n,
    wins,
    losses,
    flats,
    pnl,
    avg: n ? pnl / n : 0,
    winRate: n ? wins / n : 0,
    // 引き分け(損益0)を除いた勝率
    winRateNZ: wins + losses ? wins / (wins + losses) : 0,
    avgWin,
    avgLoss,
    median: (() => {
      if (!n) return 0
      const s = [...rows].map((r) => r.realizedPnl).sort((a, b) => a - b)
      return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
    })(),
  }
}

function line(label: string, rows: P[]) {
  const a = agg(rows)
  const w = wilson(a.wins, a.n)
  return `${label.padEnd(16)} n=${String(a.n).padStart(4)}  勝率=${pct(a.winRate).padStart(6)} [${pct(w.lo)}-${pct(w.hi)}]  損益=${yen(a.pnl).padStart(12)}  平均=${yen(a.avg).padStart(8)}  中央値=${yen(a.median).padStart(7)}  平均勝${yen(a.avgWin).padStart(8)} 平均負${yen(a.avgLoss).padStart(8)}`
}

const H = (s: string) => console.log(`\n${'='.repeat(100)}\n${s}\n${'='.repeat(100)}`)

// ===== 0. ベースライン =====
H('0. ベースライン（全建玉）')
console.log(line('全体', positions))
console.log(line('  long', positions.filter((p) => p.side === 'long')))
console.log(line('  short', positions.filter((p) => p.side === 'short')))
console.log(
  `\n方向別内訳: long n=${positions.filter((p) => p.side === 'long').length} / short n=${positions.filter((p) => p.side === 'short').length}`,
)
{
  const byKind = new Map<string, P[]>()
  for (const p of positions) {
    const k = `${p.kind}/${p.side}`
    if (!byKind.has(k)) byKind.set(k, [])
    byKind.get(k)!.push(p)
  }
  for (const [k, v] of [...byKind].sort((a, b) => b[1].length - a[1].length)) console.log(line(k, v))
}

// ===== 1. 決済曜日 × 方向 =====
H('1. 決済曜日(closeDate)ごとの成績')
const closeWd = (p: P) => weekdayOf(p.closeDate)
for (let d = 0; d < 7; d++) {
  const rows = positions.filter((p) => closeWd(p) === d)
  if (!rows.length) continue
  console.log(line(`${WEEKDAY_JA[d]}曜(決済) 全体`, rows))
  console.log(line(`  └ long`, rows.filter((p) => p.side === 'long')))
  console.log(line(`  └ short`, rows.filter((p) => p.side === 'short')))
}

H('1b. 決済曜日 × 方向 マトリクス（損益合計 / n / 勝率）')
for (const side of ['long', 'short'] as const) {
  console.log(`\n[${side}]`)
  for (let d = 0; d < 7; d++) {
    const rows = positions.filter((p) => closeWd(p) === d && p.side === side)
    if (!rows.length) continue
    console.log(line(`${WEEKDAY_JA[d]}曜`, rows))
  }
}

// ===== 2. 月曜 vs 他曜日の検定 =====
H('2. 月曜 vs 火〜金 の検定（決済曜日）')
{
  const mon = positions.filter((p) => closeWd(p) === 0)
  const oth = positions.filter((p) => closeWd(p) >= 1 && closeWd(p) <= 4)
  const am = agg(mon)
  const ao = agg(oth)
  console.log(line('月曜', mon))
  console.log(line('火〜金', oth))
  console.log(`勝率差の2比率検定 p=${twoProportionP(am.wins, am.n, ao.wins, ao.n).toFixed(4)}`)
  for (const side of ['long', 'short'] as const) {
    const m = mon.filter((p) => p.side === side)
    const o = oth.filter((p) => p.side === side)
    const a = agg(m)
    const b = agg(o)
    console.log(`\n[${side}]`)
    console.log(line('  月曜', m))
    console.log(line('  火〜金', o))
    console.log(`  勝率差 p=${twoProportionP(a.wins, a.n, b.wins, b.n).toFixed(4)}`)
    console.log(`  平均損益差=${yen(a.avg - b.avg)} / 損益合計差=${yen(a.pnl - b.pnl)}`)
  }
}

// ===== 3. permutation検定 =====
H('3. permutation検定：曜日というグループ分けは損益に対して意味を持つか')
{
  const tests: [string, P[], (p: P) => number, number][] = [
    ['決済曜日(月〜金) 全体', positions.filter((p) => closeWd(p) <= 4), (p) => closeWd(p), 5],
    [
      '決済曜日(月〜金) long',
      positions.filter((p) => closeWd(p) <= 4 && p.side === 'long'),
      (p) => closeWd(p),
      5,
    ],
    [
      '決済曜日(月〜金) short',
      positions.filter((p) => closeWd(p) <= 4 && p.side === 'short'),
      (p) => closeWd(p),
      5,
    ],
    [
      'エントリー曜日(月〜金) 全体',
      positions.filter((p) => p.openDate && weekdayOf(p.openDate) <= 4),
      (p) => weekdayOf(p.openDate!),
      5,
    ],
    [
      'エントリー曜日(月〜金) long',
      positions.filter((p) => p.openDate && weekdayOf(p.openDate) <= 4 && p.side === 'long'),
      (p) => weekdayOf(p.openDate!),
      5,
    ],
    [
      'エントリー曜日(月〜金) short',
      positions.filter((p) => p.openDate && weekdayOf(p.openDate) <= 4 && p.side === 'short'),
      (p) => weekdayOf(p.openDate!),
      5,
    ],
    ['銘柄コード(参考:比較対象)', positions, (p) => 0, 1],
  ]
  for (const [label, rows, fn, gc] of tests) {
    if (gc === 1) continue
    const p = permutationP(
      rows.map((r) => r.realizedPnl),
      rows.map(fn),
      gc,
    )
    console.log(`${label.padEnd(28)} n=${String(rows.length).padStart(4)}  permutation p=${p.toFixed(4)}`)
  }
  // 比較のため、銘柄というグループ分けでも同じ検定を回す（曜日の効果量の相対感を見る）
  const codes = [...new Set(positions.map((p) => p.code))]
  const ci = new Map(codes.map((c, i) => [c, i]))
  console.log(
    `${'(参考)銘柄コード'.padEnd(28)} n=${positions.length}  permutation p=${permutationP(
      positions.map((r) => r.realizedPnl),
      positions.map((r) => ci.get(r.code)!),
      codes.length,
    ).toFixed(4)}`,
  )
}

// ===== 4. 銘柄構成の交絡チェック =====
H('4. 交絡チェック(1)：月曜だけ銘柄構成が偏っていないか')
{
  const codes = [...new Set(positions.map((p) => p.code))]
  const top = codes
    .map((c) => ({ c, n: positions.filter((p) => p.code === c).length }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 10)
    .map((x) => x.c)
  const monAll = positions.filter((p) => closeWd(p) === 0)
  const othAll = positions.filter((p) => closeWd(p) >= 1 && closeWd(p) <= 4)
  console.log('銘柄        月曜n(構成比)   火金n(構成比)  月曜損益      火金損益     月曜勝率 火金勝率')
  for (const c of top) {
    const m = monAll.filter((p) => p.code === c)
    const o = othAll.filter((p) => p.code === c)
    const am = agg(m)
    const ao = agg(o)
    const nm = positions.find((p) => p.code === c)!.name
    console.log(
      `${c} ${nm.slice(0, 6).padEnd(7)} ${String(am.n).padStart(3)}(${pct(am.n / monAll.length).padStart(5)}) ${String(ao.n).padStart(4)}(${pct(ao.n / othAll.length).padStart(5)})  ${yen(am.pnl).padStart(10)} ${yen(ao.pnl).padStart(11)}  ${pct(am.winRate).padStart(6)} ${pct(ao.winRate).padStart(6)}`,
    )
  }
  // カイ二乗的に：月曜の銘柄構成が他曜日と違うか（上位10 + その他 の分布）
  console.log('\n--- 銘柄構成の一致度（上位10銘柄+その他）---')
  let chi = 0
  const buckets = [...top, 'OTHER']
  const monN = monAll.length
  const othN = othAll.length
  for (const b of buckets) {
    const om = b === 'OTHER' ? monAll.filter((p) => !top.includes(p.code)).length : monAll.filter((p) => p.code === b).length
    const oo = b === 'OTHER' ? othAll.filter((p) => !top.includes(p.code)).length : othAll.filter((p) => p.code === b).length
    const tot = om + oo
    const em = (tot * monN) / (monN + othN)
    const eo = (tot * othN) / (monN + othN)
    if (em > 0) chi += (om - em) ** 2 / em
    if (eo > 0) chi += (oo - eo) ** 2 / eo
  }
  console.log(`カイ二乗統計量=${chi.toFixed(2)} (df=${buckets.length - 1})  ※df=10の5%点は18.31`)
}

H('4b. 交絡チェック(2)：銘柄内で層別しても月曜は悪いか（銘柄固定効果を除いた比較）')
{
  const monAll = positions.filter((p) => closeWd(p) === 0)
  const othAll = positions.filter((p) => closeWd(p) >= 1 && closeWd(p) <= 4)
  // 各銘柄について「その銘柄の火〜金の平均損益」をベースラインとし、月曜の超過を積む
  let excessSum = 0
  let covered = 0
  const detail: string[] = []
  for (const c of [...new Set(monAll.map((p) => p.code))]) {
    const m = monAll.filter((p) => p.code === c)
    const o = othAll.filter((p) => p.code === c)
    if (o.length < 5) continue
    const am = agg(m)
    const ao = agg(o)
    excessSum += (am.avg - ao.avg) * am.n
    covered += am.n
    if (m.length >= 10)
      detail.push(
        `  ${c} ${positions.find((p) => p.code === c)!.name.slice(0, 6).padEnd(7)} 月n=${String(am.n).padStart(3)} 月平均=${yen(am.avg).padStart(8)} / 他n=${String(ao.n).padStart(3)} 他平均=${yen(ao.avg).padStart(8)}  差=${yen(am.avg - ao.avg).padStart(8)}  月勝率=${pct(am.winRate)} 他勝率=${pct(ao.winRate)}`,
      )
  }
  console.log(detail.join('\n'))
  console.log(
    `\n銘柄で層別した月曜の超過損益合計 = ${yen(excessSum)} (カバーn=${covered}/${monAll.length})`,
  )
  console.log(
    `層別なしの単純差（月曜平均 - 火金平均）× 月曜n = ${yen((agg(monAll).avg - agg(othAll).avg) * monAll.length)}`,
  )
  // 方向別にも
  for (const side of ['long', 'short'] as const) {
    let es = 0
    let cv = 0
    const mS = monAll.filter((p) => p.side === side)
    const oS = othAll.filter((p) => p.side === side)
    for (const c of [...new Set(mS.map((p) => p.code))]) {
      const m = mS.filter((p) => p.code === c)
      const o = oS.filter((p) => p.code === c)
      if (o.length < 5) continue
      es += (agg(m).avg - agg(o).avg) * m.length
      cv += m.length
    }
    console.log(`  [${side}] 銘柄層別の月曜超過損益 = ${yen(es)} (カバーn=${cv}/${mS.length})`)
  }
}

// ===== 5. 保有期間の構成 =====
H('5. 交絡チェック(3)：保有期間の構成は曜日で違うか')
{
  const bucket = (p: P) => {
    if (p.holdingDays === null) return '不明'
    if (p.holdingDays === 0) return 'デイトレ(0)'
    if (p.holdingDays <= 3) return '1-3日'
    if (p.holdingDays <= 10) return '4-10日'
    return '11日以上'
  }
  const buckets = ['デイトレ(0)', '1-3日', '4-10日', '11日以上', '不明']
  console.log('決済曜日  ' + buckets.map((b) => b.padStart(11)).join(' ') + '   n')
  for (let d = 0; d < 5; d++) {
    const rows = positions.filter((p) => closeWd(p) === d)
    console.log(
      `${WEEKDAY_JA[d]}曜      ` +
        buckets
          .map((b) => `${pct(rows.filter((p) => bucket(p) === b).length / rows.length)}`.padStart(11))
          .join(' ') +
        `  ${rows.length}`,
    )
  }
  console.log('\n--- 保有期間バケット × 決済曜日 の損益/勝率 ---')
  for (const b of buckets) {
    const all = positions.filter((p) => bucket(p) === b)
    if (all.length < 20) continue
    console.log(`\n[${b}] 全体 n=${all.length}`)
    for (let d = 0; d < 5; d++) {
      const rows = all.filter((p) => closeWd(p) === d)
      if (!rows.length) continue
      console.log(line(`  ${WEEKDAY_JA[d]}曜`, rows))
    }
  }
  console.log('\n--- デイトレのみに絞った 月曜 vs 火金 × 方向 ---')
  const day = positions.filter((p) => p.holdingDays === 0)
  for (const side of ['long', 'short'] as const) {
    const m = day.filter((p) => closeWd(p) === 0 && p.side === side)
    const o = day.filter((p) => closeWd(p) >= 1 && closeWd(p) <= 4 && p.side === side)
    console.log(line(`  ${side} 月曜`, m))
    console.log(line(`  ${side} 火金`, o))
    console.log(`  p=${twoProportionP(agg(m).wins, m.length, agg(o).wins, o.length).toFixed(4)}`)
  }
  console.log('\n--- 非デイトレ(1日以上)のみ 月曜 vs 火金 × 方向 ---')
  const swing = positions.filter((p) => p.holdingDays !== null && p.holdingDays > 0)
  for (const side of ['long', 'short'] as const) {
    const m = swing.filter((p) => closeWd(p) === 0 && p.side === side)
    const o = swing.filter((p) => closeWd(p) >= 1 && closeWd(p) <= 4 && p.side === side)
    console.log(line(`  ${side} 月曜`, m))
    console.log(line(`  ${side} 火金`, o))
    console.log(`  p=${twoProportionP(agg(m).wins, m.length, agg(o).wins, o.length).toFixed(4)}`)
  }
}

// ===== 6. エントリー曜日 =====
H('6. エントリー曜日(openDate)で切り直す')
{
  const withOpen = positions.filter((p) => p.openDate !== null)
  console.log(`openDateあり n=${withOpen.length} / 全体 ${positions.length}（null=取込期間前の建玉）`)
  for (let d = 0; d < 7; d++) {
    const rows = withOpen.filter((p) => weekdayOf(p.openDate!) === d)
    if (!rows.length) continue
    console.log(line(`${WEEKDAY_JA[d]}曜(建て) 全体`, rows))
    console.log(line(`  └ long`, rows.filter((p) => p.side === 'long')))
    console.log(line(`  └ short`, rows.filter((p) => p.side === 'short')))
  }
  console.log('\n--- 月曜エントリー vs 火〜金エントリー ---')
  const m = withOpen.filter((p) => weekdayOf(p.openDate!) === 0)
  const o = withOpen.filter((p) => weekdayOf(p.openDate!) >= 1 && weekdayOf(p.openDate!) <= 4)
  console.log(`勝率差 p=${twoProportionP(agg(m).wins, m.length, agg(o).wins, o.length).toFixed(4)}`)
  for (const side of ['long', 'short'] as const) {
    const ms = m.filter((p) => p.side === side)
    const os = o.filter((p) => p.side === side)
    console.log(line(`  ${side} 月建て`, ms))
    console.log(line(`  ${side} 火金建て`, os))
    console.log(`  p=${twoProportionP(agg(ms).wins, ms.length, agg(os).wins, os.length).toFixed(4)}`)
  }
}

H('6b. エントリー曜日 × 決済曜日 のクロス（損益合計、n）')
{
  const withOpen = positions.filter((p) => p.openDate !== null)
  let head = '建て\\決済'.padEnd(10)
  for (let d = 0; d < 5; d++) head += WEEKDAY_JA[d].padStart(16)
  console.log(head)
  for (let e = 0; e < 5; e++) {
    let row = `${WEEKDAY_JA[e]}曜`.padEnd(10)
    for (let c = 0; c < 5; c++) {
      const rows = withOpen.filter((p) => weekdayOf(p.openDate!) === e && weekdayOf(p.closeDate) === c)
      row += (rows.length ? `${yen(agg(rows).pnl)}/${rows.length}` : '-').padStart(16)
    }
    console.log(row)
  }
}

// ===== 7. 月曜の損益はどこに集中しているか =====
H('7. 月曜の損益の内訳（外れ値の影響）')
{
  const mon = positions.filter((p) => closeWd(p) === 0)
  const sorted = [...mon].sort((a, b) => a.realizedPnl - b.realizedPnl)
  console.log('月曜の損失ワースト10:')
  for (const p of sorted.slice(0, 10))
    console.log(
      `  ${p.closeDate} ${p.code} ${p.name.slice(0, 8).padEnd(9)} ${p.side.padEnd(5)} ${String(p.holdingDays).padStart(4)}日 ${yen(p.realizedPnl).padStart(10)}`,
    )
  console.log('月曜の利益ベスト5:')
  for (const p of sorted.slice(-5).reverse())
    console.log(
      `  ${p.closeDate} ${p.code} ${p.name.slice(0, 8).padEnd(9)} ${p.side.padEnd(5)} ${String(p.holdingDays).padStart(4)}日 ${yen(p.realizedPnl).padStart(10)}`,
    )
  const trimmed = sorted.slice(3, -3)
  console.log(
    `\n月曜 損益合計=${yen(agg(mon).pnl)} / 上下3件をトリムすると ${yen(agg(trimmed).pnl)} (n=${trimmed.length})`,
  )
  const oth = positions.filter((p) => closeWd(p) >= 1 && closeWd(p) <= 4)
  const os = [...oth].sort((a, b) => a.realizedPnl - b.realizedPnl)
  console.log(
    `火〜金 損益合計=${yen(agg(oth).pnl)} / 上下3件トリムで ${yen(agg(os.slice(3, -3)).pnl)} (n=${os.length - 6})`,
  )
  console.log(`\n月曜の中央値=${yen(agg(mon).median)} / 火〜金の中央値=${yen(agg(oth).median)}`)
}

// ===== 8. 時期の交絡 =====
H('8. 交絡チェック(4)：月曜の取引は特定の時期に偏っていないか')
{
  const mon = positions.filter((p) => closeWd(p) === 0)
  const oth = positions.filter((p) => closeWd(p) >= 1 && closeWd(p) <= 4)
  const q = (d: string) => d.slice(0, 7)
  const months = [...new Set(positions.map((p) => q(p.closeDate)))].sort()
  console.log('月       月曜n 月曜損益     月曜勝率  火金n 火金損益     火金勝率')
  for (const mo of months) {
    const m = mon.filter((p) => q(p.closeDate) === mo)
    const o = oth.filter((p) => q(p.closeDate) === mo)
    console.log(
      `${mo}  ${String(m.length).padStart(3)} ${yen(agg(m).pnl).padStart(10)} ${pct(agg(m).winRate).padStart(7)}  ${String(o.length).padStart(4)} ${yen(agg(o).pnl).padStart(11)} ${pct(agg(o).winRate).padStart(7)}`,
    )
  }
}

// ===== 9. サイズの交絡 =====
H('9. 交絡チェック(5)：月曜だけ建玉サイズが大きくないか')
{
  const notional = (p: P) => p.openPrice * p.quantity
  for (let d = 0; d < 5; d++) {
    const rows = positions.filter((p) => closeWd(p) === d)
    const ns = rows.map(notional).sort((a, b) => a - b)
    const med = ns[Math.floor(ns.length / 2)]
    const mean = ns.reduce((s, v) => s + v, 0) / ns.length
    console.log(
      `${WEEKDAY_JA[d]}曜 n=${String(rows.length).padStart(4)} 建玉金額 中央値=${Math.round(med).toLocaleString('ja-JP').padStart(10)} 平均=${Math.round(mean).toLocaleString('ja-JP').padStart(11)} 合計=${Math.round(ns.reduce((s, v) => s + v, 0)).toLocaleString('ja-JP').padStart(14)}`,
    )
  }
  console.log('\n--- リターン率（損益/建玉金額）で見た曜日×方向 ---')
  for (const side of ['long', 'short'] as const) {
    console.log(`[${side}]`)
    for (let d = 0; d < 5; d++) {
      const rows = positions.filter((p) => closeWd(p) === d && p.side === side && notional(p) > 0)
      const rets = rows.map((p) => p.realizedPnl / notional(p))
      const mean = rets.reduce((s, v) => s + v, 0) / rets.length
      const srt = [...rets].sort((a, b) => a - b)
      console.log(
        `  ${WEEKDAY_JA[d]}曜 n=${String(rows.length).padStart(4)} 平均R=${(mean * 100).toFixed(3)}%  中央値R=${(srt[Math.floor(srt.length / 2)] * 100).toFixed(3)}%`,
      )
    }
  }
}

// ===== 10. 多重比較の申告 =====
H('10. 多重比較の観点：曜日5×方向2=10セルを見ていることの補正')
{
  const cells: { label: string; p: number; n: number }[] = []
  for (let d = 0; d < 5; d++) {
    for (const side of ['long', 'short'] as const) {
      const inC = positions.filter((p) => closeWd(p) === d && p.side === side)
      const outC = positions.filter((p) => closeWd(p) <= 4 && !(closeWd(p) === d) && p.side === side)
      if (inC.length < 10) continue
      cells.push({
        label: `${WEEKDAY_JA[d]}曜/${side}`,
        p: twoProportionP(agg(inC).wins, inC.length, agg(outC).wins, outC.length),
        n: inC.length,
      })
    }
  }
  cells.sort((a, b) => a.p - b.p)
  console.log('セル vs 同方向の他曜日 の勝率差 p値（昇順）／Bonferroni補正後の閾値 = 0.05/' + cells.length)
  const thr = 0.05 / cells.length
  for (const c of cells)
    console.log(
      `  ${c.label.padEnd(12)} n=${String(c.n).padStart(4)} p=${c.p.toFixed(4)} ${c.p < thr ? '★補正後も有意' : c.p < 0.05 ? '(素のp<0.05だが補正後は非有意)' : ''}`,
    )
}
