/**
 * 勝ち方の構造（RRとエッジ）。
 *
 * ## なぜ勝率だけを見ても意味がないか
 *
 * 勝率と損益比（RR = 平均利益 ÷ 平均損失）は掛け算の関係にある。
 * 損益がトントンになる勝率は RR だけで決まる。
 *
 *     損益分岐に必要な勝率 = 1 / (1 + RR)
 *
 * RR が 0.9 なら 52.6% 勝たないと利益は残らない。
 * RR が 1.5 なら 40.0% で足りる。
 *
 * したがって「勝率が何%か」だけでは良し悪しは決まらず、
 * **実際の勝率が、その RR に必要な勝率をどれだけ上回っているか**が全て。
 * これをこのファイルでは「エッジ」と呼ぶ。
 *
 *     エッジ = 実際の勝率 − 損益分岐に必要な勝率
 *
 * エッジが正なら期待値も正、負なら期待値も負になる（同値の建玉を除けば同符号）。
 * 勝率が高いのに負けている切り口は、必ず RR が低い。
 */
import type { Position } from './sbi/types'

export interface EdgeStat {
  n: number
  wins: number
  losses: number
  /** 引き分けを除いた勝率 */
  winRate: number | null
  /** 平均利益（円） */
  avgWin: number
  /** 平均損失（円・正の値） */
  avgLoss: number
  /** 中央値。外れ値の影響を受けにくい */
  medWin: number
  medLoss: number
  /** 損益比 = 平均利益 ÷ 平均損失 */
  rr: number | null
  /** 中央値で計算した損益比 */
  rrMedian: number | null
  /** 勝ち・負けそれぞれの最大1件を除いて計算した損益比 */
  rrTrimmed: number | null
  /** 値幅（%）で計算した損益比。建玉サイズの変化に影響されない */
  rrPct: number | null
  /** 損益分岐に必要な勝率 */
  breakEven: number | null
  /** 実際の勝率 − 必要な勝率 */
  edge: number | null
  /** 1回あたり損益 */
  expectancy: number
  pnl: number
  /** 最大の勝ち・最大の負け（円） */
  maxWin: number
  maxLoss: number
}

/** 建玉の値幅。空売りは符号を反転して「勝った側」が正になるようにする */
export function moveOf(p: Position): number | null {
  if (!p.openPrice || !p.closePrice) return null
  const raw = (p.closePrice - p.openPrice) / p.openPrice
  return p.side === 'short' ? -raw : raw
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0)

export function edgeStat(positions: Position[]): EdgeStat {
  const wins = positions.filter((p) => p.realizedPnl > 0)
  const losses = positions.filter((p) => p.realizedPnl < 0)
  const w = wins.map((p) => p.realizedPnl)
  const l = losses.map((p) => -p.realizedPnl)

  const avgWin = mean(w)
  const avgLoss = mean(l)
  const decided = wins.length + losses.length
  const winRate = decided === 0 ? null : wins.length / decided
  const rr = avgLoss > 0 ? avgWin / avgLoss : null

  // 最大の勝ちと最大の負けを1件ずつ落とす。片側だけ落とすのは結論を作れるので禁止
  const ws = [...w].sort((a, b) => a - b)
  const ls = [...l].sort((a, b) => a - b)
  const tw = mean(ws.slice(0, -1))
  const tl = mean(ls.slice(0, -1))

  const wp = wins.map(moveOf).filter((x): x is number => x !== null)
  const lp = losses.map(moveOf).filter((x): x is number => x !== null).map((x) => -x)
  const avgWp = mean(wp)
  const avgLp = mean(lp)

  const breakEven = rr === null ? null : 1 / (1 + rr)

  return {
    n: positions.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    avgWin,
    avgLoss,
    medWin: median(w),
    medLoss: median(l),
    rr,
    rrMedian: median(l) > 0 ? median(w) / median(l) : null,
    rrTrimmed: tl > 0 ? tw / tl : null,
    rrPct: avgLp > 0 ? avgWp / avgLp : null,
    breakEven,
    edge: winRate === null || breakEven === null ? null : winRate - breakEven,
    expectancy: positions.length === 0 ? 0 : positions.reduce((s, p) => s + p.realizedPnl, 0) / positions.length,
    pnl: positions.reduce((s, p) => s + p.realizedPnl, 0),
    maxWin: ws.length ? ws[ws.length - 1] : 0,
    maxLoss: ls.length ? ls[ls.length - 1] : 0,
  }
}

/* ------------------------------------------------------------------ */

export interface EdgeRow {
  key: string
  label: string
  /** 銘柄コードなど、ラベルの下に出す補助情報 */
  sub?: string
  stat: EdgeStat
}

export interface Dimension {
  key: string
  label: string
  /** この切り口で何を見ているか */
  desc: string
  split: (positions: Position[]) => EdgeRow[]
}

function group(
  positions: Position[],
  keyOf: (p: Position) => string | null,
  labelOf: (k: string) => { label: string; sub?: string },
): EdgeRow[] {
  const m = new Map<string, Position[]>()
  for (const p of positions) {
    const k = keyOf(p)
    if (k === null) continue
    m.set(k, [...(m.get(k) ?? []), p])
  }
  return [...m].map(([key, ps]) => ({ key, ...labelOf(key), stat: edgeStat(ps) }))
}

const SIDE_JA = { long: '買い', short: '空売り' } as const

/** 保有区分。デイトレとそれ以外を分けるのが最も効く */
export function holdingLabel(p: Position): string {
  if (p.holdingDays === null) return '建玉日不明'
  if (p.holdingDays === 0) return 'デイトレ'
  if (p.holdingDays === 1) return '1日持ち越し'
  if (p.holdingDays <= 5) return '2〜5日'
  return '6日以上'
}

const HOLDING_ORDER = ['デイトレ', '1日持ち越し', '2〜5日', '6日以上', '建玉日不明']

export function dimensions(themeOf: (code: string) => string): Dimension[] {
  return [
    {
      key: 'side-holding',
      label: '方向 × 保有',
      desc: '買い／空売りを、デイトレと持ち越しに分ける',
      split: (ps) =>
        group(
          ps,
          (p) => `${p.side}|${p.holdingDays === 0 ? 'day' : 'over'}`,
          (k) => {
            const [side, h] = k.split('|')
            return { label: `${SIDE_JA[side as 'long' | 'short']}・${h === 'day' ? 'デイトレ' : '持ち越し'}` }
          },
        ).sort((a, b) => b.stat.n - a.stat.n),
    },
    {
      key: 'side',
      label: '方向',
      desc: '買いと空売り',
      split: (ps) => group(ps, (p) => p.side, (k) => ({ label: SIDE_JA[k as 'long' | 'short'] })),
    },
    {
      key: 'holding',
      label: '保有期間',
      desc: '建玉から決済までの日数',
      split: (ps) =>
        group(ps, holdingLabel, (k) => ({ label: k })).sort(
          (a, b) => HOLDING_ORDER.indexOf(a.key) - HOLDING_ORDER.indexOf(b.key),
        ),
    },
    {
      key: 'symbol',
      label: '銘柄',
      desc: '銘柄ごとの損益比',
      split: (ps) => {
        const names = new Map(ps.map((p) => [p.code, p.name]))
        return group(ps, (p) => p.code, (k) => ({ label: names.get(k) ?? k, sub: k }))
      },
    },
    {
      key: 'theme',
      label: 'テーマ',
      desc: '銘柄をテーマで束ねる',
      split: (ps) => group(ps, (p) => themeOf(p.code), (k) => ({ label: k })),
    },
    {
      key: 'month',
      label: '月',
      desc: '時期による変化',
      split: (ps) =>
        group(ps, (p) => p.closeDate.slice(0, 7), (k) => ({ label: `${k.slice(0, 4)}年${Number(k.slice(5))}月` })).sort(
          (a, b) => a.key.localeCompare(b.key),
        ),
    },
    {
      key: 'weekday',
      label: '曜日',
      desc: '決済した曜日',
      split: (ps) => {
        const W = ['月', '火', '水', '木', '金', '土', '日']
        return group(
          ps,
          (p) => String((new Date(`${p.closeDate}T00:00:00Z`).getUTCDay() + 6) % 7),
          (k) => ({ label: W[Number(k)] }),
        ).sort((a, b) => Number(a.key) - Number(b.key))
      },
    },
  ]
}

/**
 * 損益の何割がどの行から出ているか。
 * 「やってはいけないこと」を1行で特定するために使う。
 */
export function lossContribution(rows: EdgeRow[], totalPnl: number): { row: EdgeRow; share: number }[] {
  return rows
    .filter((r) => r.stat.pnl < 0)
    .map((r) => ({ row: r, share: totalPnl === 0 ? 0 : r.stat.pnl / totalPnl }))
    .sort((a, b) => b.share - a.share)
}
