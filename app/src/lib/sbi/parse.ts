/**
 * SBI証券のCSVを Execution[] に変換する。
 *
 * 対応する3形式:
 *   1. 約定履歴照会        … 全取引（新規・返済の両方）。主データ
 *   2. 実現損益(譲渡益税)   … 商品ごとに分かれた損益。1の補完に使う
 *   3. 特定口座損益明細     … 現物と信用の損益が1ファイルに入る。2の代わりになる
 *
 * いずれもヘッダー位置がファイルごとに違うため、明細ヘッダー行を動的に検出する。
 */
import { decodeSbiCsv, parseCsv, toIsoDate, toNumber, toNumberOr0 } from './csv'
import type {
  Action,
  AssetClass,
  Execution,
  RealizedRow,
  SbiFormat,
  Side,
  TradeKind,
} from './types'

/** 約定履歴CSVの「取引」欄 → 内部表現 */
const TRADE_KIND_MAP: Record<
  string,
  { kind: TradeKind; action: Action; side: Side; assetClass: AssetClass }
> = {
  株式現物買: { kind: 'cash', action: 'open', side: 'long', assetClass: 'domestic_stock' },
  株式現物売: { kind: 'cash', action: 'close', side: 'long', assetClass: 'domestic_stock' },
  信用新規買: { kind: 'margin', action: 'open', side: 'long', assetClass: 'domestic_stock' },
  信用返済売: { kind: 'margin', action: 'close', side: 'long', assetClass: 'domestic_stock' },
  信用新規売: { kind: 'margin', action: 'open', side: 'short', assetClass: 'domestic_stock' },
  信用返済買: { kind: 'margin', action: 'close', side: 'short', assetClass: 'domestic_stock' },
  投信金額買付: { kind: 'fund', action: 'open', side: 'long', assetClass: 'fund' },
  投信金額解約: { kind: 'fund', action: 'close', side: 'long', assetClass: 'fund' },
}

/** 明細ヘッダー行（1列目が「約定日」で、かつ列数が十分ある行）を探す */
function findHeaderIndex(rows: string[][]): number {
  return rows.findIndex((r) => r.length > 3 && r[0]?.trim() === '約定日')
}

/** 特定口座損益明細のヘッダー行（1列目が「銘柄コード」）を探す */
function findSettlementHeaderIndex(rows: string[][]): number {
  return rows.findIndex((r) => r.length > 5 && r[0]?.trim() === '銘柄コード')
}

/** ファイル形式を判定する */
export function detectFormat(rows: string[][]): SbiFormat {
  const si = findSettlementHeaderIndex(rows)
  if (si >= 0) {
    const h = rows[si].map((c) => c.trim())
    if (h.includes('損益金額/徴収額') && h.includes('取得/新規年月日')) return 'settlement_detail'
  }
  const hi = findHeaderIndex(rows)
  if (hi < 0) return 'unknown'
  const header = rows[hi].map((c) => c.trim())
  if (header.includes('銘柄コード') && header.includes('受渡金額/決済損益')) {
    return 'execution_history'
  }
  if (header.some((c) => c.startsWith('実現損益'))) return 'realized_pnl'
  return 'unknown'
}

function indexOfHeader(header: string[]): Record<string, number> {
  const idx: Record<string, number> = {}
  header.forEach((name, i) => {
    idx[name.trim()] = i
  })
  return idx
}

/** 明細行だけを取り出す（空行・サマリブロックを除外） */
function detailRows(rows: string[][], headerIndex: number): string[][] {
  return rows
    .slice(headerIndex + 1)
    .filter((r) => r.length > 3 && toIsoDate(r[0]) !== null)
}

/* ------------------------------------------------------------------ */
/* 1. 約定履歴照会                                                      */
/* ------------------------------------------------------------------ */

export function parseExecutionHistory(rows: string[][]): {
  executions: Execution[]
  warnings: string[]
} {
  const warnings: string[] = []
  const hi = findHeaderIndex(rows)
  const idx = indexOfHeader(rows[hi])
  const get = (r: string[], key: string) => r[idx[key]]?.trim() ?? ''

  const executions: Execution[] = []
  const unknownKinds = new Set<string>()
  // 1つの注文が同一価格で複数回に分かれて約定すると、全列が同じ行が並ぶ。
  // 内容だけでIDを作ると別々の約定が1件に潰れるため、出現順の連番を付ける。
  // CSVの行順は安定しているので、同じファイルを再取込しても同じIDになる。
  const seen = new Map<string, number>()

  let seq = 0
  for (const r of detailRows(rows, hi)) {
    seq++
    const rawKind = get(r, '取引')
    const mapped = TRADE_KIND_MAP[rawKind]
    if (!mapped) {
      unknownKinds.add(rawKind)
      continue
    }

    const date = toIsoDate(get(r, '約定日'))!
    const name = get(r, '銘柄')
    // 投資信託には銘柄コードが振られていないので、ファンド名をコード代わりに使う
    const code = get(r, '銘柄コード') || name
    const quantity = toNumberOr0(get(r, '約定数量'))
    const price = toNumberOr0(get(r, '約定単価'))
    const amount = toNumber(get(r, '受渡金額/決済損益'))
    const market = get(r, '市場')

    const base = makeId([date, code, rawKind, quantity, price, get(r, '受渡日'), amount])
    const dupSeq = (seen.get(base) ?? 0) + 1
    seen.set(base, dupSeq)

    executions.push({
      id: `${base}#${dupSeq}`,
      seq,
      date,
      code,
      name,
      market: market === '--' || market === '' ? null : market,
      assetClass: mapped.assetClass,
      kind: mapped.kind,
      action: mapped.action,
      side: mapped.side,
      quantity,
      price,
      fee: toNumberOr0(get(r, '手数料/諸経費等')),
      tax: toNumberOr0(get(r, '税額')),
      settleDate: toIsoDate(get(r, '受渡日')),
      account: get(r, '預り'),
      taxCategory: normalizeDash(get(r, '課税')),
      // 信用の返済行では最終列が「決済損益」、それ以外は「受渡金額」
      amount: mapped.kind === 'margin' && mapped.action === 'close' ? null : amount,
      realizedPnl:
        mapped.kind === 'margin' && mapped.action === 'close' ? amount : null,
      avgCost: null,
      rawKind,
    })
  }

  if (unknownKinds.size > 0) {
    warnings.push(
      `未対応の取引種別を${unknownKinds.size}種スキップしました: ${[...unknownKinds].join(', ')}`,
    )
  }
  return { executions, warnings }
}

/* ------------------------------------------------------------------ */
/* 2. 実現損益（譲渡益税明細）                                          */
/* ------------------------------------------------------------------ */

/** "ＥＮＥＯＳホールディングス 5020" → { name, code } */
function splitNameAndCode(raw: string, assetClass: AssetClass): { name: string; code: string } {
  const s = raw.trim()
  if (assetClass === 'fund') return { name: s, code: s }
  // 国内株は末尾4桁、米国株は末尾の英字ティッカー
  const m = s.match(/^(.*?)[ 　]+([0-9A-Z][0-9A-Z.]{0,5})$/)
  if (m) return { name: m[1].trim(), code: m[2] }
  return { name: s, code: s }
}

export function parseRealizedPnl(rows: string[][]): {
  realized: RealizedRow[]
  warnings: string[]
} {
  const warnings: string[] = []
  const hi = findHeaderIndex(rows)
  const idx = indexOfHeader(rows[hi])
  const header = Object.keys(idx)

  // 1行目の商品種別で資産クラスを判定する
  const title = rows.find((r) => r[0]?.trim())?.[0]?.trim() ?? ''
  const assetClass: AssetClass =
    title.includes('米国') || title.includes('外国')
      ? 'us_stock'
      : title.includes('投資信託')
        ? 'fund'
        : 'domestic_stock'

  const nameKey =
    header.find((h) => h === '銘柄名/ティッカー') ??
    header.find((h) => h === 'ファンド名') ??
    '銘柄名'
  const pnlKey = header.find((h) => h.startsWith('実現損益'))!
  // 単価の列名が「単価」「解約額単価」と揺れる
  const priceKey = header.find((h) => h === '単価') ?? header.find((h) => h.includes('単価'))!

  const get = (r: string[], key: string) => r[idx[key]]?.trim() ?? ''
  const realized: RealizedRow[] = []

  for (const r of detailRows(rows, hi)) {
    const { name, code } = splitNameAndCode(get(r, nameKey), assetClass)
    const pnl = toNumber(get(r, pnlKey))
    if (pnl === null) {
      warnings.push(`実現損益が読み取れない行をスキップ: ${get(r, '約定日')} ${name}`)
      continue
    }
    const rawKind = get(r, '取引')
    realized.push({
      date: toIsoDate(get(r, '約定日'))!,
      account: get(r, '口座'),
      code,
      name,
      assetClass,
      kind: rawKind.startsWith('返済') ? 'margin' : assetClass === 'fund' ? 'fund' : 'cash',
      side: rawKind === '返済買' ? 'short' : 'long',
      rawKind,
      quantity: toNumberOr0(get(r, '数量')),
      price: toNumberOr0(get(r, priceKey)),
      avgCost: toNumberOr0(get(r, '平均取得価額')),
      realizedPnl: pnl,
    })
  }
  return { realized, warnings }
}

/* ------------------------------------------------------------------ */
/* 3. 特定口座損益明細                                                  */
/* ------------------------------------------------------------------ */

/** 特定口座損益明細の「取引」欄 → 内部表現 */
const SETTLEMENT_KIND_MAP: Record<
  string,
  { kind: TradeKind; side: Side; assetClass: AssetClass }
> = {
  現物売: { kind: 'cash', side: 'long', assetClass: 'domestic_stock' },
  信用返済売: { kind: 'margin', side: 'long', assetClass: 'domestic_stock' },
  信用返済買: { kind: 'margin', side: 'short', assetClass: 'domestic_stock' },
  国内投信解約: { kind: 'fund', side: 'long', assetClass: 'fund' },
  外国株式売: { kind: 'cash', side: 'long', assetClass: 'us_stock' },
}

/**
 * 特定口座損益明細を実現損益として読む。
 *
 * この形式は現物と信用の決済損益が1ファイルにまとまっており、
 * 商品ごとに分かれた「実現損益」CSVの代わりになる。
 * ただし特定口座のみなので、NISA・米国株・投資信託は含まれない。
 *
 * 明細行のあいだに「譲渡益税徴収額」「譲渡益税還付金」の行が挟まる。
 * どちらも取引が空なので、それで除外する。
 *
 * なお「取得/新規年月日」は取得側の受渡日で、約定日とは基準が違うため
 * 保有期間の算出には使わない（保有期間は約定履歴のFIFO突合で出す）。
 */
export function parseSettlementDetail(rows: string[][]): {
  realized: RealizedRow[]
  warnings: string[]
} {
  const warnings: string[] = []
  const hi = findSettlementHeaderIndex(rows)
  const idx = indexOfHeader(rows[hi])
  const get = (r: string[], key: string) => r[idx[key]]?.trim() ?? ''

  const realized: RealizedRow[] = []
  const unknownKinds = new Set<string>()

  for (const r of rows.slice(hi + 1)) {
    if (r.length < 12) continue
    const rawKind = get(r, '取引')
    if (!rawKind) continue // 譲渡益税徴収額・還付金の行
    const date = toIsoDate(get(r, '約定日'))
    if (date === null) continue

    const mapped = SETTLEMENT_KIND_MAP[rawKind]
    if (!mapped) {
      unknownKinds.add(rawKind)
      continue
    }

    // 数量は「100株」のように単位が付く
    const quantity = toNumberOr0(get(r, '数量').replace(/[^0-9.-]/g, ''))
    const amount = toNumberOr0(get(r, '売却/決済金額'))
    // 損益が「--」の行は同値決済（±0）。読み飛ばすと決済が1件欠ける
    const pnl = toNumberOr0(get(r, '損益金額/徴収額'))

    // 投信と外国株には銘柄コードが振られていないので、銘柄名をコード代わりに使う。
    // 全角スペースを半角に揃えて、他形式のCSVと表記を一致させる
    const name = get(r, '銘柄').replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim()
    realized.push({
      date,
      account: '特定',
      code: get(r, '銘柄コード') || name,
      name,
      assetClass: mapped.assetClass,
      kind: mapped.kind,
      side: mapped.side,
      rawKind,
      quantity,
      // 突合キーに単価を使うので、金額と数量から戻す
      price: quantity ? amount / quantity : 0,
      avgCost: 0,
      realizedPnl: pnl,
    })
  }

  if (unknownKinds.size > 0) {
    warnings.push(`未対応の取引種別をスキップしました: ${[...unknownKinds].join(', ')}`)
  }
  return { realized, warnings }
}

/* ------------------------------------------------------------------ */
/* 重複排除                                                            */
/* ------------------------------------------------------------------ */

/**
 * 同じIDの約定をまとめる。
 *
 * 期間の重なる約定履歴を2本同時に選ぶと、同じ約定が2件ずつ現れる。
 * この状態で mergeRealizedPnl を通すと、実現損益は片方にしか当たらず、
 * あとで重複排除したときに「損益が入っていない方」が残ることがある。
 * そのため、マージより前に必ずここを通す。
 *
 * 損益や平均取得価額が入っている方を優先して残す。
 */
export function dedupeExecutions(executions: Execution[]): Execution[] {
  const byId = new Map<string, Execution>()
  for (const e of executions) {
    const prev = byId.get(e.id)
    if (!prev) {
      byId.set(e.id, e)
      continue
    }
    byId.set(e.id, {
      ...prev,
      realizedPnl: prev.realizedPnl ?? e.realizedPnl,
      avgCost: prev.avgCost ?? e.avgCost,
    })
  }
  return [...byId.values()]
}

/* ------------------------------------------------------------------ */
/* マージ                                                              */
/* ------------------------------------------------------------------ */

/**
 * 実現損益CSVの損益を、約定履歴の決済レコードに突き合わせる。
 *
 * 約定履歴には現物売・投信解約の「損益」が入っていない（最終列が受渡金額のため）
 * ので、ここで埋める。信用返済は約定履歴側に既に損益があるため対象外。
 *
 * 米国株は約定履歴に一切現れないため、突合できなかった行から
 * 決済レコードを合成して補う。
 *
 * 突合キーは 約定日 + 銘柄コード + 数量 + 単価。
 * 一意にならない場合は、同キーの未使用行を先頭から消費する。
 */
export function mergeRealizedPnl(
  executions: Execution[],
  realized: RealizedRow[],
): { merged: number; synthesized: Execution[]; duplicated: number; unmatched: RealizedRow[] } {
  // 信用返済の損益は約定履歴側が正。突合対象から外す
  const targets = realized.filter((r) => r.kind !== 'margin')

  const index = (key: (r: RealizedRow) => string) => {
    const m = new Map<string, RealizedRow[]>()
    for (const r of targets) {
      const k = key(r)
      const list = m.get(k)
      if (list) list.push(r)
      else m.set(k, [r])
    }
    return m
  }

  // 同じ行を2度使わないよう、消費済みを共有で持つ
  const used = new Set<RealizedRow>()
  const take = (m: Map<string, RealizedRow[]>, k: string): RealizedRow | null => {
    const list = m.get(k)
    if (!list) return null
    while (list.length > 0) {
      const r = list.shift()!
      if (!used.has(r)) {
        used.add(r)
        return r
      }
    }
    return null
  }

  const exact = index((r) => joinKey(r.date, r.code, r.quantity, r.price))
  // 単価を見ないゆるいキー。投資信託は形式によって単価の意味が違い
  // （基準価額と解約額単価）、日・銘柄・数量は揃うのに単価だけ一致しない。
  // 同じ日・同じ銘柄・同じ数量なら同一の決済とみなす。
  const loose = index((r) => `${r.date}|${r.code}|${r.quantity}`)

  let merged = 0
  const apply = (ex: Execution, row: RealizedRow) => {
    ex.realizedPnl = row.realizedPnl
    ex.avgCost = row.avgCost
    merged++
  }

  const pending: Execution[] = []
  for (const ex of executions) {
    if (ex.action !== 'close' || ex.realizedPnl !== null) continue
    const row = take(exact, joinKey(ex.date, ex.code, ex.quantity, ex.price))
    if (row) apply(ex, row)
    else pending.push(ex)
  }
  // 完全一致で埋まらなかったものだけを、ゆるいキーで再度突合する
  for (const ex of pending) {
    const row = take(loose, `${ex.date}|${ex.code}|${ex.quantity}`)
    if (row) apply(ex, row)
  }

  // 残った行のうち、その日・その銘柄の決済約定が約定履歴に一切無いものだけを合成する。
  // 決済約定が存在するのに余っている行は、別形式の同じ損益が二重に入っているだけなので捨てる
  // （実現損益CSVと特定口座損益明細を両方選んだ場合に起きる）。
  const closedDayCode = new Set(
    executions.filter((e) => e.action === 'close').map((e) => `${e.date}|${e.code}`),
  )
  const leftover = targets.filter((r) => !used.has(r))
  const duplicated = leftover.filter((r) => closedDayCode.has(`${r.date}|${r.code}`))
  // 合成対象も、銘柄コードを除いた中身で重複を落とす。
  // 米国株は約定履歴に一切現れないため、実現損益CSVと特定口座損益明細の
  // 両方を選ぶと同じ決済が2件合成されてしまう。両者は銘柄コードの表記が
  // 違う（SOFI と 銘柄名）ので、コードを使わないキーで判定する。
  const seq = new Map<string, number>()
  const seenSynth = new Set<string>()
  const synthesized = leftover
    .filter((r) => !closedDayCode.has(`${r.date}|${r.code}`))
    .filter((r) => {
      const k = `${r.date}|${r.assetClass}|${r.quantity}|${r.realizedPnl}`
      if (seenSynth.has(k)) return false
      seenSynth.add(k)
      return true
    })
    .map((r) => {
      const base = joinKey(r.date, r.code, r.quantity, r.price)
      const n = (seq.get(base) ?? 0) + 1
      seq.set(base, n)
      return toSyntheticExecution(r, n)
    })
  executions.push(...synthesized)

  return { merged, synthesized, duplicated: duplicated.length, unmatched: [] }
}

/** 約定履歴に存在しない実現損益行から、決済レコードを組み立てる */
function toSyntheticExecution(r: RealizedRow, seq: number): Execution {
  return {
    id: makeId([r.date, r.code, r.rawKind, r.quantity, r.price, 'realized', seq]),
    seq: 1_000_000 + seq,
    date: r.date,
    code: r.code,
    name: r.name,
    market: null,
    assetClass: r.assetClass,
    kind: r.kind,
    action: 'close',
    side: r.side,
    quantity: r.quantity,
    price: r.price,
    // 実現損益CSVには手数料の列が無い。損益には既に反映済みなので0で扱う
    fee: 0,
    tax: 0,
    settleDate: null,
    account: r.account,
    taxCategory: null,
    amount: null,
    realizedPnl: r.realizedPnl,
    avgCost: r.avgCost,
    rawKind: r.rawKind,
  }
}

/* ------------------------------------------------------------------ */

function joinKey(date: string, code: string, quantity: number, price: number): string {
  return `${date}|${code}|${quantity}|${price}`
}

function normalizeDash(s: string): string | null {
  return s === '' || s === '--' ? null : s
}

/** 内容から決まる安定したID。同じCSVを二重に取り込んでも重複しない */
function makeId(parts: (string | number | null)[]): string {
  return parts.map((p) => String(p ?? '')).join('|')
}

/* ------------------------------------------------------------------ */
/* エントリポイント                                                     */
/* ------------------------------------------------------------------ */

export interface ParsedFile {
  format: SbiFormat
  executions: Execution[]
  realized: RealizedRow[]
  warnings: string[]
}

/** 1ファイルを解析する。形式は自動判定 */
export function parseSbiFile(buf: ArrayBuffer): ParsedFile {
  const rows = parseCsv(decodeSbiCsv(buf))
  const format = detectFormat(rows)

  if (format === 'execution_history') {
    const { executions, warnings } = parseExecutionHistory(rows)
    return { format, executions, realized: [], warnings }
  }
  if (format === 'realized_pnl') {
    const { realized, warnings } = parseRealizedPnl(rows)
    return { format, executions: [], realized, warnings }
  }
  if (format === 'settlement_detail') {
    const { realized, warnings } = parseSettlementDetail(rows)
    return { format, executions: [], realized, warnings }
  }
  return {
    format: 'unknown',
    executions: [],
    realized: [],
    warnings: ['SBI証券のCSVとして認識できませんでした'],
  }
}
