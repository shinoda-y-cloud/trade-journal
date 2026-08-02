/**
 * 所見の自動生成。
 *
 * ## 設計方針：既定の答えは「差は検出できませんでした」
 *
 * このアプリの分析軸は、8軸を統計的に検証したところ7軸が棄却された経緯を踏まえて
 * 作られている。棄却の理由は毎回同じ4つだった。
 *
 *   1. 外れ値1〜2件が結論を作っていた
 *   2. 同一日の建玉を独立標本として数えていた（疑似反復）
 *   3. 「純損益の何%」と「総損失の何%」を取り違えていた
 *   4. 非有意を「効果なし」と読み替えていた
 *
 * したがってこのエンジンの目的は傾向を見つけることではなく、
 * **見つけたつもりになるのを防ぐこと**にある。
 * 断定文（型C）を出すには下の4条件をすべて満たす必要がある。
 */
import {
  clusterBootstrapDiff,
  familywiseRisk,
  holm,
  permutationByDayBlock,
  quantile,
  stdev,
  trimBothEnds,
  type DayItem,
} from './stats'
import { percent, signedYen, yen } from './format'
import type { Position } from './sbi/types'
import SECTOR_MAP from './sector-map.json'

/** 断定文を出すための条件。ひとつでも欠ければ「検出できず」に倒す */
export const GATE = {
  /** 全群が この件数以上 */
  minGroupN: 30,
  /** Holm補正後のp値がこの値未満。0.05 ではなく 0.01 */
  maxAdjustedP: 0.01,
  /** 各群から上下1件ずつ除いても符号が保たれ p<0.05 を維持 */
  trimK: 1,
  trimMaxP: 0.05,
} as const

export type Verdict = '差を検出' | '検出できず' | 'n不足'

export interface GroupStat {
  label: string
  n: number
  wins: number
  losses: number
  pnl: number
  winRate: number | null
  expectancy: number
}

export interface AxisResult {
  key: string
  /** 画面に出す軸名 */
  label: string
  /** この軸で何を問うているか */
  question: string
  a: GroupStat
  b: GroupStat
  /** 比較した指標 */
  metric: 'win' | 'value'
  metricLabel: string
  /** a − b の推定差 */
  diff: number
  lo: number
  hi: number
  rawP: number
  adjP: number
  clusters: number
  method: string
  /** 上下1件ずつ除いた後も符号が保たれ p<0.05 か */
  robust: boolean | null
  /** 前半と後半で符号が一致するか */
  periodStable: boolean | null
  verdict: Verdict
  /** 生成した所見文 */
  sentence: string
  /** 必ず併記する注意書き */
  caveat: string
}

const THEMES = SECTOR_MAP as Record<string, { name: string; sector: string; theme: string }>

export function themeOf(code: string): string {
  return THEMES[code]?.theme ?? 'その他'
}

export function sectorOf(code: string): string {
  return THEMES[code]?.sector ?? 'その他'
}

/** AI関連とみなすテーマ */
export const AI_THEMES = ['AI・データセンター関連', '半導体・電子部品']

/** 建玉金額。国内株のみ意味を持つ（投信の口数・米国株のドル建ては単位が違う） */
export function notionalOf(p: Position): number | null {
  if (p.assetClass !== 'domestic_stock') return null
  if (!p.openPrice) return null
  return p.openPrice * p.quantity
}

/** 決済日の曜日（0=月） */
export function weekdayOf(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7
}

/* ------------------------------------------------------------------ */

function statOf(label: string, ps: Position[]): GroupStat {
  const wins = ps.filter((p) => p.realizedPnl > 0).length
  const losses = ps.filter((p) => p.realizedPnl < 0).length
  const pnl = ps.reduce((s, p) => s + p.realizedPnl, 0)
  return {
    label,
    n: ps.length,
    wins,
    losses,
    pnl,
    winRate: wins + losses === 0 ? null : wins / (wins + losses),
    expectancy: ps.length === 0 ? 0 : pnl / ps.length,
  }
}

function toItems(a: Position[], b: Position[], metric: 'win' | 'value'): DayItem[] {
  const conv = (p: Position, group: number): DayItem => ({
    day: p.closeDate,
    value: p.realizedPnl,
    group,
    win: p.realizedPnl === 0 ? null : p.realizedPnl > 0 ? 1 : 0,
  })
  void metric
  return [...a.map((p) => conv(p, 0)), ...b.map((p) => conv(p, 1))]
}

/** 2群の対比を1本の検定として評価する */
interface ContrastSpec {
  key: string
  label: string
  question: string
  metric: 'win' | 'value'
  metricLabel: string
  /** 群分けが決済日単位で決まるか（曜日など）。true なら日ブロック並べ替えを使う */
  dayLevel: boolean
  split: (positions: Position[]) => { a: { label: string; ps: Position[] }; b: { label: string; ps: Position[] } } | null
  caveat: string
}

const CONTRASTS: ContrastSpec[] = [
  {
    key: 'weekday-long',
    label: '週前半の買い',
    question: '月曜・火曜に決済した買いポジションは、水木金と成績が違うか',
    metric: 'win',
    metricLabel: '勝率',
    dayLevel: true,
    caveat:
      '決済した曜日で分けています。建玉を作った曜日ではありません。効果は期間の後半で弱まっており（前半 -16.8pt → 後半 -8.8pt）、単独では確定的な所見として扱えません。',
    split: (ps) => {
      const longs = ps.filter((p) => p.side === 'long')
      return {
        a: { label: '月・火に決済', ps: longs.filter((p) => weekdayOf(p.closeDate) <= 1) },
        b: { label: '水・木・金に決済', ps: longs.filter((p) => weekdayOf(p.closeDate) >= 2) },
      }
    },
  },
  {
    key: 'weekday-all',
    label: '曜日（全体）',
    question: '決済した曜日で成績が違うか',
    metric: 'win',
    metricLabel: '勝率',
    dayLevel: true,
    caveat: '「月曜が最も悪い」という形では安定しません。日をクラスタとした再抽出では、月曜が最下位になる確率は約46%、最上位になる確率も約15%あります。',
    split: (ps) => ({
      a: { label: '月・火', ps: ps.filter((p) => weekdayOf(p.closeDate) <= 1) },
      b: { label: '水・木・金', ps: ps.filter((p) => weekdayOf(p.closeDate) >= 2) },
    }),
  },
  {
    key: 'side',
    label: '方向',
    question: '買いと空売りで成績が違うか',
    metric: 'win',
    metricLabel: '勝率',
    dayLevel: false,
    caveat: '同じ日に買いと空売りを両方建てている日が多く、相場付きの影響を分離できていません。',
    split: (ps) => ({
      a: { label: '買い', ps: ps.filter((p) => p.side === 'long') },
      b: { label: '空売り', ps: ps.filter((p) => p.side === 'short') },
    }),
  },
  {
    key: 'holding',
    label: '保有区分',
    question: 'デイトレと持ち越しで成績が違うか',
    metric: 'win',
    metricLabel: '勝率',
    dayLevel: false,
    caveat:
      '合計損益で比べると持ち越しが大きく劣りますが、その差は上位数件に依存します。上位5件を除くと持ち越しは黒字に転じます。中央値では持ち越しの方が上です。',
    split: (ps) => ({
      a: { label: 'デイトレ', ps: ps.filter((p) => p.holdingDays === 0) },
      b: { label: '持ち越し', ps: ps.filter((p) => p.holdingDays !== null && p.holdingDays > 0) },
    }),
  },
  {
    key: 'size',
    label: '建玉金額',
    question: '大きく張ったときに勝てているか',
    metric: 'win',
    metricLabel: '勝率',
    dayLevel: false,
    caveat:
      '建玉金額は期間を通じて拡大しており（中央値で約3.5倍）、同時に成績も悪化しています。金額と時期が交絡しているため、金額単独の効果はこのデータでは分離できません。国内株のみが対象です。',
    split: (ps) => {
      const withN = ps
        .map((p) => ({ p, n: notionalOf(p) }))
        .filter((x): x is { p: Position; n: number } => x.n !== null)
      if (withN.length < 60) return null
      const sorted = [...withN].sort((x, y) => x.n - y.n)
      const half = Math.floor(sorted.length / 2)
      return {
        a: { label: '金額が小さい半分', ps: sorted.slice(0, half).map((x) => x.p) },
        b: { label: '金額が大きい半分', ps: sorted.slice(half).map((x) => x.p) },
      }
    },
  },
  {
    key: 'theme-ai',
    label: 'AI・半導体テーマ',
    question: 'AI・データセンター／半導体の銘柄と、それ以外で成績が違うか',
    metric: 'win',
    metricLabel: '勝率',
    dayLevel: false,
    caveat:
      '全体で見ると差はありませんが、買いと空売りに分けると符号が逆になって打ち消し合っています（Simpsonのパラドックス）。テーマと成績の関係は、このデータでは判定できません。',
    split: (ps) => ({
      a: { label: 'AI・半導体', ps: ps.filter((p) => AI_THEMES.includes(themeOf(p.code))) },
      b: { label: 'それ以外', ps: ps.filter((p) => !AI_THEMES.includes(themeOf(p.code))) },
    }),
  },
  {
    key: 'kind',
    label: '商品区分',
    question: '現物と信用で成績が違うか',
    metric: 'win',
    metricLabel: '勝率',
    dayLevel: false,
    caveat: '現物の取引は期間の前半に集中しており、区分と時期が交絡しています。',
    split: (ps) => ({
      a: { label: '現物', ps: ps.filter((p) => p.kind === 'cash') },
      b: { label: '信用', ps: ps.filter((p) => p.kind === 'margin') },
    }),
  },
  {
    key: 'entry-weekday',
    label: 'エントリー曜日',
    question: '建玉を作った曜日で成績が違うか',
    metric: 'win',
    metricLabel: '勝率',
    dayLevel: false,
    caveat: '建玉日が判明しているものだけが対象です。',
    split: (ps) => {
      const known = ps.filter((p) => p.openDate !== null)
      return {
        a: { label: '月・火に建てた', ps: known.filter((p) => weekdayOf(p.openDate!) <= 1) },
        b: { label: '水・木・金に建てた', ps: known.filter((p) => weekdayOf(p.openDate!) >= 2) },
      }
    },
  },
]

/* ------------------------------------------------------------------ */

function evaluate(spec: ContrastSpec, positions: Position[]): AxisResult | null {
  const s = spec.split(positions)
  if (!s || s.a.ps.length === 0 || s.b.ps.length === 0) return null

  const a = statOf(s.a.label, s.a.ps)
  const b = statOf(s.b.label, s.b.ps)
  const items = toItems(s.a.ps, s.b.ps, spec.metric)

  // 群分けが日単位なら並べ替え、建玉単位ならクラスタ・ブートストラップ
  let rawP: number
  let lo = NaN
  let hi = NaN
  let clusters: number
  let method: string
  if (spec.dayLevel) {
    const t = permutationByDayBlock(items, 2, spec.metric, 10_000)
    rawP = t.p
    clusters = t.clusters
    method = t.method
    const bs = clusterBootstrapDiff(items, spec.metric, 5_000)
    lo = bs.lo
    hi = bs.hi
  } else {
    const t = clusterBootstrapDiff(items, spec.metric, 5_000)
    rawP = t.p
    lo = t.lo
    hi = t.hi
    clusters = t.clusters
    method = t.method
  }

  const diff = (a.winRate ?? 0) - (b.winRate ?? 0)

  // 頑健性：各群から上下1件ずつ除いて再検定
  let robust: boolean | null = null
  if (s.a.ps.length > 2 * GATE.trimK && s.b.ps.length > 2 * GATE.trimK) {
    const ta = trimBothEnds(s.a.ps, (p) => p.realizedPnl, GATE.trimK)
    const tb = trimBothEnds(s.b.ps, (p) => p.realizedPnl, GATE.trimK)
    const trimmed = clusterBootstrapDiff(toItems(ta, tb, spec.metric), spec.metric, 2_000)
    const sameSign = Math.sign(trimmed.diff) === Math.sign(diff) && diff !== 0
    robust = sameSign && trimmed.p < GATE.trimMaxP
  }

  // 期間安定性：件数で前半・後半に割り、符号が一致するか
  let periodStable: boolean | null = null
  const inA = new Set(s.a.ps)
  const all = [...s.a.ps, ...s.b.ps].sort((x, y) => x.closeDate.localeCompare(y.closeDate))
  if (all.length >= 4 * GATE.minGroupN) {
    const mid = all[Math.floor(all.length / 2)].closeDate
    const dif = (subset: Position[]) => {
      const sa = statOf('', subset.filter((p) => inA.has(p)))
      const sb = statOf('', subset.filter((p) => !inA.has(p)))
      return (sa.winRate ?? 0) - (sb.winRate ?? 0)
    }
    const first = dif(all.filter((p) => p.closeDate < mid))
    const second = dif(all.filter((p) => p.closeDate >= mid))
    periodStable = Math.sign(first) === Math.sign(second) && first !== 0
  }

  return {
    key: spec.key,
    label: spec.label,
    question: spec.question,
    a,
    b,
    metric: spec.metric,
    metricLabel: spec.metricLabel,
    diff,
    lo,
    hi,
    rawP,
    adjP: rawP, // Holm はファミリー全体で後からまとめて入れる
    clusters,
    method,
    robust,
    periodStable,
    verdict: '検出できず',
    sentence: '',
    caveat: spec.caveat,
  }
}

export interface InsightReport {
  axes: AxisResult[]
  /** 同時に回した検定の本数 */
  familySize: number
  /** すべて帰無でも1本以上「有意」が出る確率 */
  familyRisk: number
  /** 断定文（型C）を通った軸 */
  detected: AxisResult[]
}

/** 全軸を検定し、Holm補正のうえで所見文を組み立てる */
export function runInsights(positions: Position[]): InsightReport {
  const raw = CONTRASTS.map((c) => evaluate(c, positions)).filter((x): x is AxisResult => x !== null)
  const adj = holm(raw.map((r) => r.rawP))

  raw.forEach((r, i) => {
    r.adjP = adj[i]
    const minN = Math.min(r.a.n, r.b.n)

    if (minN < GATE.minGroupN) {
      r.verdict = 'n不足'
      r.sentence = `${r.a.label}が${r.a.n}件、${r.b.label}が${r.b.n}件です。${GATE.minGroupN}件に満たない群があるため、この軸では判定しません。`
      return
    }

    const passes = r.adjP < GATE.maxAdjustedP && r.robust === true && r.periodStable !== false

    if (passes) {
      r.verdict = '差を検出'
      // 型C：断定してよい唯一の形。それでも「過去の記録である」と明示する
      r.sentence =
        `${r.metricLabel}に差がありました。${r.a.label} ${percent(r.a.winRate, 1)}（${r.a.n}件） vs ` +
        `${r.b.label} ${percent(r.b.winRate, 1)}（${r.b.n}件）、差は${(r.diff * 100).toFixed(1)}pt。` +
        `補正後 p=${fmtP(r.adjP)}。各群から上下1件ずつ除いても符号は変わりません。` +
        `ただしこれは過去の記録であり、他の要因と分離できてはいません。`
    } else {
      r.verdict = '検出できず'
      // 型B：既定の出力。
      // 区間が0を跨ぐかどうかで意味がまるで違うので、幅だけを示す言い方はしない。
      const hasCI = Number.isFinite(r.lo) && Number.isFinite(r.hi)
      const crossesZero = hasCI && r.lo <= 0 && r.hi >= 0
      const ci = hasCI ? `${(r.lo * 100).toFixed(1)} 〜 ${(r.hi * 100).toFixed(1)}pt` : null

      const reasons: string[] = []
      if (r.adjP >= GATE.maxAdjustedP) {
        reasons.push(
          `補正後のp値が ${fmtP(r.adjP)} で基準（${GATE.maxAdjustedP}）に届きません`,
        )
      }
      if (r.robust === false) reasons.push('各群から上下1件ずつ除くと差が保たれません')
      if (r.periodStable === false) reasons.push('前半と後半で符号が逆になります')

      r.sentence =
        `${r.a.label} ${percent(r.a.winRate, 1)}（${r.a.n}件） vs ${r.b.label} ${percent(r.b.winRate, 1)}（${r.b.n}件）、` +
        `差は${(r.diff * 100).toFixed(1)}pt。` +
        (ci ? `差の95%区間は ${ci}` : '') +
        (crossesZero
          ? '（0を跨いでいるため、差の向きすら定まりません）。'
          : ci
            ? '（0を跨いではいません）。'
            : '') +
        `${r.method} p=${fmtP(r.rawP)}、補正後 ${fmtP(r.adjP)}。` +
        `この軸は「差を検出」としていません — ${reasons.join('、')}。` +
        `差が無いことの証明ではなく、この標本では確かめられなかった、という意味です。`
    }
  })

  return {
    axes: raw,
    familySize: raw.length,
    familyRisk: familywiseRisk(raw.length),
    detected: raw.filter((r) => r.verdict === '差を検出'),
  }
}

export function fmtP(p: number): string {
  if (p < 0.001) return '<0.001'
  return p.toFixed(p < 0.01 ? 4 : 3)
}

/* ------------------------------------------------------------------ */
/* 損益の集中度（型A：検定を含まない純粋な記述）                        */
/* ------------------------------------------------------------------ */

export interface Concentration {
  net: number
  grossProfit: number
  grossLoss: number
  wins: number
  losses: number
  /** ワーストN件の累積 */
  worst: { n: number; sum: number; shareOfNet: number; shareOfGrossLoss: number }[]
  best: { n: number; sum: number; shareOfGrossProfit: number }[]
  worstTrades: Position[]
  bestTrades: Position[]
}

export function concentration(positions: Position[]): Concentration {
  const sorted = [...positions].sort((a, b) => a.realizedPnl - b.realizedPnl)
  const grossProfit = positions.filter((p) => p.realizedPnl > 0).reduce((s, p) => s + p.realizedPnl, 0)
  const grossLoss = positions.filter((p) => p.realizedPnl < 0).reduce((s, p) => s + p.realizedPnl, 0)
  const net = grossProfit + grossLoss
  const steps = [1, 2, 3, 5, 10, 20].filter((n) => n <= positions.length)

  return {
    net,
    grossProfit,
    grossLoss,
    wins: positions.filter((p) => p.realizedPnl > 0).length,
    losses: positions.filter((p) => p.realizedPnl < 0).length,
    worst: steps.map((n) => {
      const sum = sorted.slice(0, n).reduce((s, p) => s + p.realizedPnl, 0)
      return {
        n,
        sum,
        shareOfNet: net === 0 ? 0 : Math.abs(sum / net),
        shareOfGrossLoss: grossLoss === 0 ? 0 : Math.abs(sum / grossLoss),
      }
    }),
    best: steps.map((n) => {
      const sum = sorted.slice(-n).reduce((s, p) => s + p.realizedPnl, 0)
      return { n, sum, shareOfGrossProfit: grossProfit === 0 ? 0 : sum / grossProfit }
    }),
    worstTrades: sorted.slice(0, 5),
    bestTrades: sorted.slice(-5).reverse(),
  }
}

/** 型A：検定を伴わない記述文 */
export function describeConcentration(c: Concentration): string {
  const w2 = c.worst.find((w) => w.n === 2)
  return (
    `実現損益 ${signedYen(c.net)} は、勝ち${c.wins}件の合計 ${signedYen(c.grossProfit)} と ` +
    `負け${c.losses}件の合計 ${signedYen(c.grossLoss)} の差し引き残りです。` +
    (w2 ? `最も損失の大きい2件だけで ${yen(Math.abs(w2.sum))}、差し引き後の損益に対して ${percent(w2.shareOfNet, 1)} を占めます（損失そのものに対しては ${percent(w2.shareOfGrossLoss, 1)}）。` : '')
  )
}

/* ------------------------------------------------------------------ */
/* 建玉金額と振れ幅（型A＋唯一の型C候補）                              */
/* ------------------------------------------------------------------ */

export interface SizeBucket {
  label: string
  lo: number
  hi: number
  n: number
  pnl: number
  winRate: number | null
  expectancy: number
  /** 1回あたり損益の標準偏差 */
  sd: number
  /** |損益| が1万円を超えた割合 */
  bigMoveRate: number
}

export interface SizeAnalysis {
  /** 国内株のみ。投信・米国株は建玉金額の単位が揃わないため除外 */
  included: number
  excluded: number
  median: number
  q1: number
  q3: number
  p90: number
  max: number
  quintiles: SizeBucket[]
  /** 金額帯ごとの「大きく振れた割合」 */
  bands: { label: string; n: number; bigMoveRate: number }[]
  /** Q5 と Q1 の標準偏差の比 */
  sdRatio: number
  /** 標準偏差の差が偶然でないかの検定 */
  sdTest: { p: number; method: string }
  /** |損益| が1万円を超えた建玉 */
  bigMoves: { n: number; winPnl: number; lossPnl: number; wins: number; losses: number }
}

const BIG_MOVE = 10_000

export function sizeAnalysis(positions: Position[]): SizeAnalysis | null {
  const withN = positions
    .map((p) => ({ p, notional: notionalOf(p) }))
    .filter((x): x is { p: Position; notional: number } => x.notional !== null)
  if (withN.length < 100) return null

  const sorted = [...withN].sort((a, b) => a.notional - b.notional)
  const amounts = sorted.map((x) => x.notional)
  const size = Math.floor(sorted.length / 5)

  const bucketOf = (i: number) => Math.min(Math.floor(i / size), 4)
  const groups: { p: Position; notional: number }[][] = [[], [], [], [], []]
  sorted.forEach((x, i) => groups[bucketOf(i)].push(x))

  const quintiles: SizeBucket[] = groups.map((g, i) => {
    const ps = g.map((x) => x.p)
    const s = statOf('', ps)
    const pnls = ps.map((p) => p.realizedPnl)
    return {
      label: `Q${i + 1}`,
      lo: g[0]?.notional ?? 0,
      hi: g[g.length - 1]?.notional ?? 0,
      n: ps.length,
      pnl: s.pnl,
      winRate: s.winRate,
      expectancy: s.expectancy,
      sd: stdev(pnls),
      bigMoveRate: ps.filter((p) => Math.abs(p.realizedPnl) >= BIG_MOVE).length / (ps.length || 1),
    }
  })

  const bandDefs: [string, number, number][] = [
    ['〜25万円', 0, 250_000],
    ['25〜50万円', 250_000, 500_000],
    ['50〜100万円', 500_000, 1_000_000],
    ['100万円〜', 1_000_000, Infinity],
  ]
  const bands = bandDefs.map(([label, lo, hi]) => {
    const ps = sorted.filter((x) => x.notional >= lo && x.notional < hi).map((x) => x.p)
    return {
      label,
      n: ps.length,
      bigMoveRate: ps.length === 0 ? 0 : ps.filter((p) => Math.abs(p.realizedPnl) >= BIG_MOVE).length / ps.length,
    }
  })

  // 標準偏差の差の検定：|損益| を値として、金額の上下半分で日クラスタ・ブートストラップ
  const half = Math.floor(sorted.length / 2)
  const absItems: DayItem[] = sorted.map((x, i) => ({
    day: x.p.closeDate,
    value: Math.abs(x.p.realizedPnl),
    group: i < half ? 1 : 0, // 0 = 金額が大きい側
    win: null,
  }))
  const sdTest = clusterBootstrapDiff(absItems, 'value', 5_000)

  const big = sorted.map((x) => x.p).filter((p) => Math.abs(p.realizedPnl) >= BIG_MOVE)
  const bigWins = big.filter((p) => p.realizedPnl > 0)
  const bigLosses = big.filter((p) => p.realizedPnl < 0)

  return {
    included: sorted.length,
    excluded: positions.length - sorted.length,
    median: quantile(amounts, 0.5),
    q1: quantile(amounts, 0.25),
    q3: quantile(amounts, 0.75),
    p90: quantile(amounts, 0.9),
    max: amounts[amounts.length - 1],
    quintiles,
    bands,
    sdRatio: quintiles[0].sd === 0 ? 0 : quintiles[4].sd / quintiles[0].sd,
    sdTest: { p: sdTest.p, method: sdTest.method },
    bigMoves: {
      n: big.length,
      wins: bigWins.length,
      losses: bigLosses.length,
      winPnl: bigWins.reduce((s, p) => s + p.realizedPnl, 0),
      lossPnl: bigLosses.reduce((s, p) => s + p.realizedPnl, 0),
    },
  }
}

/* ------------------------------------------------------------------ */
/* 取引スタイルの変化（型A：全期間をひとまとめにしてよいかの判断材料）  */
/* ------------------------------------------------------------------ */

export interface RegimeRow {
  month: string
  n: number
  pnl: number
  winRate: number | null
  medianNotional: number | null
  aiShare: number
  cashShare: number
}

export function regimeByMonth(positions: Position[]): RegimeRow[] {
  const byMonth = new Map<string, Position[]>()
  for (const p of positions) {
    const k = p.closeDate.slice(0, 7)
    byMonth.set(k, [...(byMonth.get(k) ?? []), p])
  }
  return [...byMonth]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, ps]) => {
      const s = statOf('', ps)
      const notionals = ps
        .map(notionalOf)
        .filter((n): n is number => n !== null)
        .sort((a, b) => a - b)
      return {
        month,
        n: ps.length,
        pnl: s.pnl,
        winRate: s.winRate,
        medianNotional: notionals.length ? quantile(notionals, 0.5) : null,
        aiShare: ps.filter((p) => AI_THEMES.includes(themeOf(p.code))).length / ps.length,
        cashShare: ps.filter((p) => p.kind === 'cash').length / ps.length,
      }
    })
}

/** テーマ別の構成比。成績の比較は出さない（方向で層別すると符号が反転するため） */
export interface ThemeShare {
  theme: string
  n: number
  share: number
  notional: number
  notionalShare: number
}

export function themeShares(positions: Position[]): ThemeShare[] {
  const m = new Map<string, { n: number; notional: number }>()
  for (const p of positions) {
    const t = themeOf(p.code)
    const e = m.get(t) ?? { n: 0, notional: 0 }
    e.n++
    e.notional += notionalOf(p) ?? 0
    m.set(t, e)
  }
  const totalN = positions.length
  const totalNotional = [...m.values()].reduce((s, e) => s + e.notional, 0)
  return [...m]
    .map(([theme, e]) => ({
      theme,
      n: e.n,
      share: totalN ? e.n / totalN : 0,
      notional: e.notional,
      notionalShare: totalNotional ? e.notional / totalNotional : 0,
    }))
    .sort((a, b) => b.n - a.n)
}
