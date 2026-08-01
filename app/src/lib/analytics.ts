/**
 * 建玉（Position）を各種の切り口で集計する。
 * 全ての集計は決済日（closeDate）基準。損益が確定した日に計上する。
 */
import {
  HOLDING_BUCKETS,
  HOLDING_BUCKET_LABEL,
  holdingBucket,
} from './sbi/positions'
import type { Position, Side, TradeKind } from './sbi/types'

/** 集計の最小単位 */
export interface Stats {
  /** 決済回数 */
  trades: number
  /** 実現損益の合計 */
  pnl: number
  /** 勝ちトレード数（損益 > 0） */
  wins: number
  /** 負けトレード数（損益 < 0） */
  losses: number
  /** 総利益（勝ちトレードの合計） */
  grossProfit: number
  /** 総損失（負けトレードの合計。正の数で保持） */
  grossLoss: number
  /** 手数料・諸経費の合計 */
  fee: number
}

export const EMPTY_STATS: Stats = {
  trades: 0,
  pnl: 0,
  wins: 0,
  losses: 0,
  grossProfit: 0,
  grossLoss: 0,
  fee: 0,
}

export function accumulate(s: Stats, p: Position): Stats {
  const pnl = p.realizedPnl
  return {
    trades: s.trades + 1,
    pnl: s.pnl + pnl,
    wins: s.wins + (pnl > 0 ? 1 : 0),
    losses: s.losses + (pnl < 0 ? 1 : 0),
    grossProfit: s.grossProfit + (pnl > 0 ? pnl : 0),
    grossLoss: s.grossLoss + (pnl < 0 ? -pnl : 0),
    fee: s.fee + p.fee,
  }
}

export function summarize(positions: Position[]): Stats {
  return positions.reduce(accumulate, EMPTY_STATS)
}

/** 勝率。決済0件なら null */
export function winRate(s: Stats): number | null {
  const decided = s.wins + s.losses
  return decided === 0 ? null : s.wins / decided
}

/** プロフィットファクター（総利益 ÷ 総損失）。損失0なら null（無限大） */
export function profitFactor(s: Stats): number | null {
  return s.grossLoss === 0 ? null : s.grossProfit / s.grossLoss
}

/** 1トレードあたりの期待値 */
export function expectancy(s: Stats): number | null {
  return s.trades === 0 ? null : s.pnl / s.trades
}

/** 平均利益（勝ちトレードのみ） */
export function avgWin(s: Stats): number | null {
  return s.wins === 0 ? null : s.grossProfit / s.wins
}

/** 平均損失（負けトレードのみ。正の数） */
export function avgLoss(s: Stats): number | null {
  return s.losses === 0 ? null : s.grossLoss / s.losses
}

/** ペイオフレシオ（平均利益 ÷ 平均損失） */
export function payoffRatio(s: Stats): number | null {
  const w = avgWin(s)
  const l = avgLoss(s)
  return w === null || l === null || l === 0 ? null : w / l
}

/* ------------------------------------------------------------------ */
/* グルーピング                                                        */
/* ------------------------------------------------------------------ */

export interface Group<K> {
  key: K
  label: string
  stats: Stats
}

function groupBy<K>(
  positions: Position[],
  keyOf: (p: Position) => K,
  labelOf: (k: K) => string,
): Group<K>[] {
  const map = new Map<K, Stats>()
  for (const p of positions) {
    map.set(keyOf(p), accumulate(map.get(keyOf(p)) ?? EMPTY_STATS, p))
  }
  return [...map].map(([key, stats]) => ({ key, label: labelOf(key), stats }))
}

/* ---- 期間 ---- */

export type Period = 'day' | 'week' | 'month' | 'quarter' | 'year'

export const PERIOD_LABEL: Record<Period, string> = {
  day: '日次',
  week: '週次',
  month: '月次',
  quarter: '四半期',
  year: '年次',
}

/** 決済日を期間キーに丸める。返り値はソート可能な文字列 */
export function periodKey(isoDate: string, period: Period): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  switch (period) {
    case 'day':
      return isoDate
    case 'week':
      return isoWeekStart(y, m, d)
    case 'month':
      return isoDate.slice(0, 7)
    case 'quarter':
      return `${y}-Q${Math.floor((m - 1) / 3) + 1}`
    case 'year':
      return String(y)
  }
}

/** その日を含む週の月曜日 (yyyy-MM-dd) */
function isoWeekStart(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d))
  const dow = (dt.getUTCDay() + 6) % 7 // 月曜=0
  dt.setUTCDate(dt.getUTCDate() - dow)
  return dt.toISOString().slice(0, 10)
}

export function formatPeriodKey(key: string, period: Period): string {
  switch (period) {
    case 'day': {
      const [, m, d] = key.split('-')
      return `${Number(m)}/${Number(d)}`
    }
    case 'week': {
      const [, m, d] = key.split('-')
      return `${Number(m)}/${Number(d)}の週`
    }
    case 'month': {
      const [y, m] = key.split('-')
      return `${y}年${Number(m)}月`
    }
    case 'quarter':
      return key.replace('-Q', '年 Q')
    case 'year':
      return `${key}年`
  }
}

export function byPeriod(positions: Position[], period: Period): Group<string>[] {
  return groupBy(
    positions,
    (p) => periodKey(p.closeDate, period),
    (k) => formatPeriodKey(k, period),
  ).sort((a, b) => a.key.localeCompare(b.key))
}

/* ---- 銘柄 ---- */

export interface SymbolGroup extends Group<string> {
  name: string
}

export function bySymbol(positions: Position[]): SymbolGroup[] {
  const names = new Map<string, string>()
  for (const p of positions) names.set(p.code, p.name)
  return groupBy(
    positions,
    (p) => p.code,
    (k) => k,
  )
    .map((g) => ({ ...g, name: names.get(g.key) ?? g.key }))
    .sort((a, b) => b.stats.pnl - a.stats.pnl)
}

/* ---- 方向・区分・保有期間・曜日・口座・市場 ---- */

const SIDE_LABEL: Record<Side, string> = { long: '買い', short: '空売り' }
const KIND_LABEL: Record<TradeKind, string> = {
  cash: '現物',
  margin: '信用',
  fund: '投資信託',
}

export function bySide(positions: Position[]): Group<Side>[] {
  return groupBy(positions, (p) => p.side, (k) => SIDE_LABEL[k]).sort((a) =>
    a.key === 'long' ? -1 : 1,
  )
}

export function byKind(positions: Position[]): Group<TradeKind>[] {
  const order: TradeKind[] = ['margin', 'cash', 'fund']
  return groupBy(positions, (p) => p.kind, (k) => KIND_LABEL[k]).sort(
    (a, b) => order.indexOf(a.key) - order.indexOf(b.key),
  )
}

export function byHolding(positions: Position[]): Group<string>[] {
  return groupBy(
    positions,
    (p) => holdingBucket(p.holdingDays),
    (k) => HOLDING_BUCKET_LABEL[k],
  ).sort((a, b) => HOLDING_BUCKETS.indexOf(a.key) - HOLDING_BUCKETS.indexOf(b.key))
}

const WEEKDAY = ['月', '火', '水', '木', '金', '土', '日']

export function byWeekday(positions: Position[]): Group<number>[] {
  return groupBy(
    positions,
    (p) => (new Date(`${p.closeDate}T00:00:00Z`).getUTCDay() + 6) % 7,
    (k) => WEEKDAY[k],
  ).sort((a, b) => a.key - b.key)
}

export function byAccount(positions: Position[]): Group<string>[] {
  return groupBy(positions, (p) => p.account || '不明', (k) => k).sort(
    (a, b) => b.stats.trades - a.stats.trades,
  )
}

/* ------------------------------------------------------------------ */
/* 累積損益カーブとドローダウン                                        */
/* ------------------------------------------------------------------ */

export interface EquityPoint {
  date: string
  /** その日の損益 */
  daily: number
  /** 期首からの累積損益 */
  cumulative: number
  /** 直近ピークからの下落幅（0以下） */
  drawdown: number
}

export function equityCurve(positions: Position[]): EquityPoint[] {
  const daily = new Map<string, number>()
  for (const p of positions) {
    daily.set(p.closeDate, (daily.get(p.closeDate) ?? 0) + p.realizedPnl)
  }
  let cum = 0
  let peak = 0
  return [...daily.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, d]) => {
      cum += d
      peak = Math.max(peak, cum)
      return { date, daily: d, cumulative: cum, drawdown: cum - peak }
    })
}

/** 最大ドローダウン（正の数）。取引が無ければ 0 */
export function maxDrawdown(curve: EquityPoint[]): number {
  return curve.reduce((mx, p) => Math.max(mx, -p.drawdown), 0)
}

/** 連続した勝ち／負けの最長記録 */
export function streaks(positions: Position[]): { win: number; loss: number } {
  const sorted = [...positions].sort((a, b) => a.closeDate.localeCompare(b.closeDate))
  let win = 0
  let loss = 0
  let cw = 0
  let cl = 0
  for (const p of sorted) {
    if (p.realizedPnl > 0) {
      cw++
      cl = 0
    } else if (p.realizedPnl < 0) {
      cl++
      cw = 0
    } else continue
    win = Math.max(win, cw)
    loss = Math.max(loss, cl)
  }
  return { win, loss }
}

/** 平均保有日数。建玉日が判明しているものだけで計算 */
export function averageHoldingDays(positions: Position[]): number | null {
  const known = positions.filter((p) => p.holdingDays !== null)
  if (known.length === 0) return null
  return known.reduce((s, p) => s + (p.holdingDays ?? 0), 0) / known.length
}

/* ------------------------------------------------------------------ */
/* 期間フィルタ                                                        */
/* ------------------------------------------------------------------ */

export interface DateRange {
  from: string | null
  to: string | null
}

export function filterByRange(positions: Position[], range: DateRange): Position[] {
  if (!range.from && !range.to) return positions
  return positions.filter(
    (p) =>
      (!range.from || p.closeDate >= range.from) && (!range.to || p.closeDate <= range.to),
  )
}

/** データ全体の決済日レンジ */
export function dataRange(positions: Position[]): DateRange {
  if (positions.length === 0) return { from: null, to: null }
  let from = positions[0].closeDate
  let to = positions[0].closeDate
  for (const p of positions) {
    if (p.closeDate < from) from = p.closeDate
    if (p.closeDate > to) to = p.closeDate
  }
  return { from, to }
}
