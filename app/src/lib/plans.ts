/**
 * トレードプラン（事前記録）。
 *
 * ## なぜ必要か
 *
 * SBIのCSVには「結果」しか入っていない。そのため、
 *   ・計画的に持ち越したのか、切れずに持ち越したのか
 *   ・損切り価格を決めていたのか、決めていなかったのか
 *   ・狙っていたRRは何倍だったのか
 * が一切分からない。実データの分析では「買いの持ち越し106件」が損益の中心だと
 * 分かったが、それが手法の問題なのか執行の問題なのかは判定できなかった。
 *
 * エントリー前に意図を記録しておけば、決済後にCSVと突き合わせて
 * **計画と結果の差**が測れるようになる。これは記録に無い情報を
 * 後から取り出すことはできない、という限界への唯一の対処になる。
 *
 * ## R倍数
 *
 * 損切り価格を決めていれば、1トレードのリスク額が確定する。
 *
 *     リスク額 = |エントリー価格 − 損切り価格| × 数量
 *     R倍数    = 実現損益 ÷ リスク額
 *
 * -1R より悪い決済は「損切りを守れなかった」ことを意味する。
 * 円建ての損益と違い、建玉サイズが変わっても比較できる。
 */
import type { Position, Side, TradeKind } from './sbi/types'

export interface TradePlan {
  id: string
  /** 記録した日時 */
  createdAt: string
  /** エントリー予定日 (yyyy-MM-dd) */
  date: string
  code: string
  name: string
  side: Side
  kind: TradeKind
  /** 想定エントリー価格 */
  entryPrice: number
  /** 損切り価格。ここを決めないとR倍数が計算できない */
  stopPrice: number
  /** 目標価格。任意 */
  targetPrice: number | null
  /** 予定数量。任意（突合できれば実際の数量を使う） */
  quantity: number | null
  /** 持ち越す予定か */
  intent: 'day' | 'swing'
  memo: string
  /** 手動で紐づけた建玉ID。null なら自動突合に任せる */
  matchedPositionId: string | null
  /** 自動突合をやめる（対応する建玉が無い＝見送った、など） */
  dismissed: boolean
}

export const INTENT_LABEL: Record<TradePlan['intent'], string> = {
  day: 'デイトレ予定',
  swing: '持ち越し予定',
}

/* ------------------------------------------------------------------ */
/* 計画そのものの評価（突合前でも計算できる）                            */
/* ------------------------------------------------------------------ */

export interface PlanMath {
  /** 1株あたりのリスク幅 */
  riskPerShare: number
  /** 1株あたりの狙い幅。目標未設定なら null */
  rewardPerShare: number | null
  /** 計画RR */
  plannedRR: number | null
  /** 計画RRで損益分岐に必要な勝率 */
  requiredWinRate: number | null
  /** リスク額（円）。数量が分かる場合のみ */
  riskAmount: number | null
  /** 損切りがエントリーに対して正しい向きにあるか */
  stopValid: boolean
}

export function planMath(p: TradePlan, quantity?: number | null): PlanMath {
  // 買いは損切りが下、空売りは上にある
  const stopValid = p.side === 'long' ? p.stopPrice < p.entryPrice : p.stopPrice > p.entryPrice
  const riskPerShare = Math.abs(p.entryPrice - p.stopPrice)
  const rewardPerShare = p.targetPrice === null ? null : Math.abs(p.targetPrice - p.entryPrice)
  const plannedRR = rewardPerShare === null || riskPerShare === 0 ? null : rewardPerShare / riskPerShare
  const qty = quantity ?? p.quantity
  return {
    riskPerShare,
    rewardPerShare,
    plannedRR,
    requiredWinRate: plannedRR === null ? null : 1 / (1 + plannedRR),
    riskAmount: qty ? riskPerShare * qty : null,
    stopValid,
  }
}

/* ------------------------------------------------------------------ */
/* 実際の建玉との突合                                                   */
/* ------------------------------------------------------------------ */

/** 突合を許す日数。プラン日から何日先までのエントリーを同一視するか */
const MATCH_WINDOW_DAYS = 7

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

export interface MatchedPlan {
  plan: TradePlan
  position: Position | null
  /** 自動で突き合わせたか、手動指定か */
  auto: boolean
}

/**
 * プランと建玉を突き合わせる。
 * 銘柄コード・方向が一致し、建玉日がプラン日から{@link MATCH_WINDOW_DAYS}日以内のものを、
 * 日付の近い順に、1建玉につき1プランだけ割り当てる。
 */
export function matchPlans(plans: TradePlan[], positions: Position[]): MatchedPlan[] {
  const byId = new Map(positions.map((p) => [p.id, p]))
  const claimed = new Set<string>()
  const result: MatchedPlan[] = []

  // 手動指定を先に確定させる
  const manual = new Map<string, Position | null>()
  for (const plan of plans) {
    if (plan.matchedPositionId) {
      const pos = byId.get(plan.matchedPositionId) ?? null
      if (pos) claimed.add(pos.id)
      manual.set(plan.id, pos)
    }
  }

  const sorted = [...plans].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
  for (const plan of sorted) {
    if (manual.has(plan.id)) {
      result.push({ plan, position: manual.get(plan.id)!, auto: false })
      continue
    }
    if (plan.dismissed) {
      result.push({ plan, position: null, auto: true })
      continue
    }
    const candidates = positions
      .filter(
        (pos) =>
          !claimed.has(pos.id) &&
          pos.code === plan.code &&
          pos.side === plan.side &&
          pos.openDate !== null &&
          daysBetween(plan.date, pos.openDate) >= 0 &&
          daysBetween(plan.date, pos.openDate) <= MATCH_WINDOW_DAYS,
      )
      .sort(
        (x, y) =>
          daysBetween(plan.date, x.openDate!) - daysBetween(plan.date, y.openDate!) ||
          x.id.localeCompare(y.id),
      )
    const hit = candidates[0] ?? null
    if (hit) claimed.add(hit.id)
    result.push({ plan, position: hit, auto: true })
  }

  return result.sort((a, b) => b.plan.date.localeCompare(a.plan.date))
}

/* ------------------------------------------------------------------ */
/* 計画と結果の突き合わせ                                               */
/* ------------------------------------------------------------------ */

export interface PlanOutcome {
  plan: TradePlan
  position: Position
  math: PlanMath
  /** R倍数 = 実現損益 ÷ リスク額。リスク額が出せなければ null */
  r: number | null
  /** 損切り価格より不利な水準で決済したか（-1Rより悪いか） */
  stopBroken: boolean
  /** 予定どおりの保有区分だったか */
  intentHonored: boolean
  /** 予定はデイトレだったが持ち越した */
  unplannedOvernight: boolean
}

export function outcomeOf(m: MatchedPlan): PlanOutcome | null {
  if (!m.position) return null
  const pos = m.position
  const math = planMath(m.plan, pos.quantity)
  const r = math.riskAmount && math.riskAmount > 0 ? pos.realizedPnl / math.riskAmount : null
  const isDay = pos.holdingDays === 0
  return {
    plan: m.plan,
    position: pos,
    math,
    r,
    // 許容誤差を少し置く。手数料の分だけ -1R をわずかに割ることがあるため
    stopBroken: r !== null && r < -1.1,
    intentHonored: (m.plan.intent === 'day') === isDay,
    unplannedOvernight: m.plan.intent === 'day' && !isDay,
  }
}

/* ------------------------------------------------------------------ */
/* 規律の集計                                                          */
/* ------------------------------------------------------------------ */

export interface Discipline {
  /** 突合できたプラン数 */
  matched: number
  /** まだ建玉が見つかっていないプラン数 */
  pending: number
  /** R倍数が計算できた件数 */
  withR: number
  /** 損切りを守れなかった件数 */
  stopBroken: number
  /** デイトレ予定だったのに持ち越した件数と、その損益 */
  unplannedOvernight: number
  unplannedOvernightPnl: number
  /** 計画RRの平均（目標を書いたプランのみ） */
  avgPlannedRR: number | null
  /** 実際のR倍数の平均 */
  avgR: number | null
  /** 勝ちの平均R / 負けの平均R */
  avgWinR: number | null
  avgLossR: number | null
  /** 実現RR = 平均勝ちR ÷ |平均負けR| */
  realizedRR: number | null
  /** R倍数の分布（ヒストグラム用） */
  rValues: number[]
  outcomes: PlanOutcome[]
}

export function discipline(matches: MatchedPlan[]): Discipline {
  const outcomes = matches.map(outcomeOf).filter((o): o is PlanOutcome => o !== null)
  const withR = outcomes.filter((o) => o.r !== null)
  const rValues = withR.map((o) => o.r!)
  const winR = rValues.filter((r) => r > 0)
  const lossR = rValues.filter((r) => r < 0)
  const plannedRRs = matches.map((m) => planMath(m.plan).plannedRR).filter((x): x is number => x !== null)
  const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)
  const unplanned = outcomes.filter((o) => o.unplannedOvernight)

  const avgWinR = mean(winR)
  const avgLossR = mean(lossR)

  return {
    matched: outcomes.length,
    pending: matches.filter((m) => !m.position && !m.plan.dismissed).length,
    withR: withR.length,
    stopBroken: outcomes.filter((o) => o.stopBroken).length,
    unplannedOvernight: unplanned.length,
    unplannedOvernightPnl: unplanned.reduce((s, o) => s + o.position.realizedPnl, 0),
    avgPlannedRR: mean(plannedRRs),
    avgR: mean(rValues),
    avgWinR,
    avgLossR,
    realizedRR: avgWinR !== null && avgLossR !== null && avgLossR !== 0 ? avgWinR / Math.abs(avgLossR) : null,
    rValues,
    outcomes,
  }
}

/** 決定的なID。時刻とランダムを混ぜる */
export function newPlanId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
