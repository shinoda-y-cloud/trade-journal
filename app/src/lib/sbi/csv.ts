/** SBIのCSV（CP932、引用符あり、区切り記号はカンマ）を配列に落とす低レベル処理 */

/**
 * Shift_JIS(CP932) でデコードする。
 * SBIのCSVは全てCP932だが、将来UTF-8で出力されるようになっても壊れないよう
 * BOM付きUTF-8を先に判定する。
 */
export function decodeSbiCsv(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  return new TextDecoder('shift_jis').decode(bytes)
}

/** RFC4180準拠のCSVパース。引用符内の改行・エスケープ("")に対応 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }

    if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\r') {
      // \r\n の \r は捨てる
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += c
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/**
 * "1,234" "+849" "-2,100" "--" "" を数値にする。
 * 数値として解釈できない場合は null（「値なし」と「0」を区別するため）。
 */
export function toNumber(raw: string | undefined): number | null {
  if (raw == null) return null
  const s = raw.replace(/,/g, '').replace(/\s/g, '').replace(/^\+/, '')
  if (s === '' || s === '--' || s === '-') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** 数値として読めなければ 0 を返す（手数料・税額など、欠損=0が正しい列で使う） */
export function toNumberOr0(raw: string | undefined): number {
  return toNumber(raw) ?? 0
}

/** "2025/7/1" "2025年07月03日" → "2025-07-01" */
export function toIsoDate(raw: string | undefined): string | null {
  if (!raw) return null
  const s = raw.trim()
  const m = s.match(/^(\d{4})[/年-](\d{1,2})[/月-](\d{1,2})/)
  if (!m) return null
  const [, y, mo, d] = m
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
}
