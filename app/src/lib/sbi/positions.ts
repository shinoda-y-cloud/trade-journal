/**
 * 約定（Execution）から建玉（Position）を組み立てる。
 *
 * SBIのCSVには「どの新規建てをどの返済で決済したか」の対応関係が無いため、
 * 銘柄・方向・区分・口座ごとにFIFO（先入先出）で突き合わせる。
 * SBIの建玉管理も原則FIFOなので、実態とほぼ一致する。
 *
 * 損益は決済約定が持つ実額をそのまま使い、1回の決済が複数の建玉に
 * またがる場合のみ数量で按分する。自前で単価から再計算はしない
 * （信用の金利・貸株料を再現できず、必ずSBIの数字とズレるため）。
 */
import type { Execution, Position } from './types'

/** 未決済の建玉ロット */
interface Lot {
  openDate: string
  quantity: number
  price: number
  /** 新規時の手数料を1株あたりに割ったもの。部分決済しても按分がずれない */
  feePerUnit: number
}

/** 建玉のグルーピングキー。ここが一致するもの同士でFIFOに突き合わせる */
function lotKey(e: Execution): string {
  return `${e.code}|${e.side}|${e.kind}|${e.account}`
}

export interface BuildPositionsResult {
  positions: Position[]
  /** 対応する新規建てが見つからなかった決済（取込期間より前に建てた玉） */
  orphanCloses: Execution[]
  /** 期末時点で決済されずに残った建玉 */
  openLots: { key: string; name: string; lot: Lot }[]
}

export function buildPositions(executions: Execution[]): BuildPositionsResult {
  // 同日の複数約定は、新規→返済の順に処理しないとデイトレが正しく組めない。
  // 同種どうしは元CSVの行順（seq）を保つ。IndexedDBから読むとID順に並ぶため、
  // ここで並べ直さないとFIFOの突合結果が取り込み方法によってブレる。
  const sorted = [...executions].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.action === b.action ? 0 : a.action === 'open' ? -1 : 1) ||
      a.seq - b.seq,
  )

  const books = new Map<string, Lot[]>()
  const names = new Map<string, string>()
  const positions: Position[] = []
  const orphanCloses: Execution[] = []

  for (const e of sorted) {
    const key = lotKey(e)
    names.set(key, e.name)

    if (e.action === 'open') {
      const book = books.get(key) ?? []
      book.push({
        openDate: e.date,
        quantity: e.quantity,
        price: e.price,
        feePerUnit: e.quantity === 0 ? 0 : e.fee / e.quantity,
      })
      books.set(key, book)
      continue
    }

    // ---- 決済 ----
    const book = books.get(key) ?? []
    let remaining = e.quantity
    const consumed: { lot: Lot; qty: number }[] = []

    while (remaining > 0 && book.length > 0) {
      const lot = book[0]
      const qty = Math.min(lot.quantity, remaining)
      consumed.push({ lot: { ...lot }, qty })
      lot.quantity -= qty
      remaining -= qty
      if (lot.quantity === 0) book.shift()
    }

    const pnlKnown = e.realizedPnl !== null
    const pnl = e.realizedPnl ?? 0
    // 決済側の手数料（信用の金利・貸株料を含む）も1株あたりに割って配る
    const closeFeePerUnit = e.quantity === 0 ? 0 : e.fee / e.quantity

    if (remaining > 0) {
      // 取込期間より前に建てた玉。保有期間は不明だが損益は計上する
      orphanCloses.push(e)
      positions.push({
        id: `${e.id}#orphan`,
        code: e.code,
        name: e.name,
        side: e.side,
        kind: e.kind,
        assetClass: e.assetClass,
        account: e.account,
        openDate: null,
        closeDate: e.date,
        holdingDays: null,
        quantity: remaining,
        openPrice: 0,
        closePrice: e.price,
        fee: closeFeePerUnit * remaining,
        realizedPnl: pnl * (remaining / e.quantity),
        pnlKnown,
      })
    }

    for (const { lot, qty } of consumed) {
      const share = qty / e.quantity
      positions.push({
        id: `${e.id}#${lot.openDate}#${qty}`,
        code: e.code,
        name: e.name,
        side: e.side,
        kind: e.kind,
        assetClass: e.assetClass,
        account: e.account,
        openDate: lot.openDate,
        closeDate: e.date,
        holdingDays: daysBetween(lot.openDate, e.date),
        quantity: qty,
        openPrice: lot.price,
        closePrice: e.price,
        fee: (lot.feePerUnit + closeFeePerUnit) * qty,
        realizedPnl: pnl * share,
        pnlKnown,
      })
    }
  }

  const openLots: BuildPositionsResult['openLots'] = []
  for (const [key, book] of books) {
    for (const lot of book) {
      if (lot.quantity > 0) openLots.push({ key, name: names.get(key) ?? '', lot })
    }
  }

  return { positions, orphanCloses, openLots }
}

/** 日数差。同日決済（デイトレ）は 0 */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

/** 保有期間の区分。分析画面の切り口として使う */
export type HoldingBucket = 'day' | 'overnight' | 'short' | 'mid' | 'long' | 'unknown'

export function holdingBucket(days: number | null): HoldingBucket {
  if (days === null) return 'unknown'
  if (days <= 0) return 'day'
  if (days === 1) return 'overnight'
  if (days <= 5) return 'short'
  if (days <= 20) return 'mid'
  return 'long'
}

export const HOLDING_BUCKET_LABEL: Record<HoldingBucket, string> = {
  day: 'デイトレ',
  overnight: '1日持ち越し',
  short: '2〜5日',
  mid: '6〜20日',
  long: '21日以上',
  unknown: '建玉日不明',
}

/** 表示順 */
export const HOLDING_BUCKETS: HoldingBucket[] = [
  'day',
  'overnight',
  'short',
  'mid',
  'long',
  'unknown',
]
