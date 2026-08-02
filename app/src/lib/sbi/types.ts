/** SBI証券のCSVから取り込んだ取引データの型定義 */

/** 資産クラス */
export type AssetClass = 'domestic_stock' | 'us_stock' | 'fund'

/** 建玉の方向。買いポジション=long / 空売り=short */
export type Side = 'long' | 'short'

/** 新規建て・買付=open / 返済・売却・解約=close */
export type Action = 'open' | 'close'

/** 現物 / 信用 / 投資信託 */
export type TradeKind = 'cash' | 'margin' | 'fund'

/**
 * 約定1件。「約定履歴照会」CSVの1行に対応する。
 *
 * 損益(realizedPnl)は信用取引の返済行にのみ元CSVから入る。
 * 現物売・投信解約・米国株売却の損益は「実現損益」CSVから
 * mergeRealizedPnl() で後付けする。
 */
export interface Execution {
  /** 重複取込を防ぐための決定的なID */
  id: string
  /**
   * 元CSVでの行番号。
   * CSVには時刻が無いため、同日内の約定順はこれでしか復元できない。
   * IndexedDBから読み出すとID順に並ぶので、FIFO突合の前に必ずこれで並べ直す。
   */
  seq: number
  /** 約定日 (yyyy-MM-dd) */
  date: string
  /** 銘柄コード。国内株は4桁、米国株はティッカー */
  code: string
  /** 銘柄名 */
  name: string
  /** 市場 (東証 / PTS（X）など)。投信は null */
  market: string | null
  assetClass: AssetClass
  kind: TradeKind
  action: Action
  side: Side
  /** 約定数量。投信は口数 */
  quantity: number
  /** 約定単価。投信は1万口あたりの基準価額 */
  price: number
  /** 手数料・諸経費等（金利・貸株料を含む）。円 */
  fee: number
  /** 税額。円 */
  tax: number
  /** 受渡日 (yyyy-MM-dd) */
  settleDate: string | null
  /** 預り区分 (特定 / NISA(成) / NISA(つ) など) */
  account: string
  /** 課税区分 (申告 / 非課税 など) */
  taxCategory: string | null
  /** 受渡金額。openの行と現物売・投信解約の行に入る。円 */
  amount: number | null
  /**
   * 実現損益（税引前）。円。
   * 信用返済は元CSV由来、それ以外は実現損益CSVのマージで埋まる。
   * null は「損益不明」を意味し、集計から除外される。
   */
  realizedPnl: number | null
  /** 平均取得価額。実現損益CSVのマージで埋まる */
  avgCost: number | null
  /** 元CSVの「取引」欄の文字列。デバッグ・表示用 */
  rawKind: string
}

/** 「実現損益」CSVの1行 */
export interface RealizedRow {
  date: string
  account: string
  code: string
  name: string
  assetClass: AssetClass
  /** 「取引」欄から判定した区分。信用(margin)は約定履歴側に損益があるため突合不要 */
  kind: TradeKind
  /** 建玉の方向。返済買=空売りの決済 */
  side: Side
  rawKind: string
  quantity: number
  price: number
  avgCost: number
  realizedPnl: number
}

/** 新規と返済を突き合わせて生成する建玉 */
export interface Position {
  id: string
  code: string
  name: string
  side: Side
  kind: TradeKind
  assetClass: AssetClass
  account: string
  /** 建玉を作った日。取込期間より前に建てた玉は null */
  openDate: string | null
  /** 決済しきった日 */
  closeDate: string
  /** 保有日数。同日仕切りは 0（デイトレ）。建玉日が不明なら null */
  holdingDays: number | null
  quantity: number
  /** 加重平均の建単価 */
  openPrice: number
  /** 加重平均の決済単価 */
  closePrice: number
  /** 手数料・諸経費の合計 */
  fee: number
  /** 実現損益（諸経費控除後） */
  realizedPnl: number
  /**
   * 損益が元CSVから判明しているか。
   * 約定履歴CSVだけを取り込むと現物・投信の決済に損益が入らず、
   * 0として集計されてしまう。それを検知して警告するためのフラグ。
   */
  pnlKnown: boolean
}

/** 取り込み結果のサマリ */
export interface ImportResult {
  executions: Execution[]
  /** 取り込んだファイルごとの内訳 */
  files: { name: string; format: SbiFormat; rows: number }[]
  warnings: string[]
}

export type SbiFormat = 'execution_history' | 'realized_pnl' | 'unknown'
