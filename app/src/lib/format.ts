/** 表示用の整形。金額は常に円、小数は出さない */

const JPY = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 })

/** 1,234 / -5,678 */
export function yen(n: number): string {
  return JPY.format(Math.round(n))
}

/** 符号付き。+1,234 / -5,678 / 0 */
export function signedYen(n: number): string {
  const r = Math.round(n)
  return r > 0 ? `+${JPY.format(r)}` : JPY.format(r)
}

/** 軸ラベル用の圧縮表記。+1.2万 / -340万 */
export function compactYen(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(abs >= 1e9 ? 0 : 1)}億`
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(abs >= 1e5 ? 0 : 1)}万`
  return `${sign}${JPY.format(Math.round(abs))}`
}

/** 0.4823 → 48.2% */
export function percent(n: number | null, digits = 1): string {
  return n === null ? '—' : `${(n * 100).toFixed(digits)}%`
}

/** 1.234 → 1.23 */
export function ratio(n: number | null, digits = 2): string {
  return n === null ? '—' : n.toFixed(digits)
}

export function num(n: number | null, digits = 1): string {
  return n === null ? '—' : n.toFixed(digits)
}

/** 2026-07-31 → 2026年7月31日 */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${y}年${Number(m)}月${Number(d)}日`
}

/** 2026-07-31 → 7/31 */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}

/** 損益の符号。CSSクラスの出し分けに使う */
export function sign(n: number): 'pos' | 'neg' | 'zero' {
  return n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero'
}
