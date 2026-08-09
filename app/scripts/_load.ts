/**
 * 開発用：csv-data の実CSVを読み込んで建玉まで組み立てる共通ローダー。
 * 分析スクリプトはこれを import して使う。
 *
 *   import { loadAll } from './_load'
 *   const { positions, executions } = loadAll()
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { dedupeExecutions, mergeRealizedPnl, parseSbiFile } from '../src/lib/sbi/parse'
import { buildPositions } from '../src/lib/sbi/positions'
import type { Execution, Position, RealizedRow } from '../src/lib/sbi/types'

export function loadAll(dir = join(import.meta.dirname, '../../csv-data')): {
  executions: Execution[]
  realized: RealizedRow[]
  positions: Position[]
} {
  if (!existsSync(dir)) {
    console.error(`検証用のCSVが見つかりません: ${dir}`)
    console.error('SBI証券から落としたCSVをこのフォルダに置いてから実行してください。')
    console.error('（取引データはリポジトリに含めない方針のため、手元にしか存在しません）')
    process.exit(2)
  }

  const executions: Execution[] = []
  const realized: RealizedRow[] = []
  for (const f of readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.csv')).sort()) {
    const b = readFileSync(join(dir, f))
    const r = parseSbiFile(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
    executions.push(...r.executions)
    realized.push(...r.realized)
  }
  // 期間の重なるファイルを同時に読んでも壊れないよう、マージ前に重複を潰す
  const unique = dedupeExecutions(executions)
  mergeRealizedPnl(unique, realized)
  return { executions: unique, realized, positions: buildPositions(unique).positions }
}

/** 決済日の曜日（0=月 … 6=日） */
export function weekdayOf(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7
}

export const WEEKDAY_JA = ['月', '火', '水', '木', '金', '土', '日']

/** 勝率のWilson信頼区間（95%）。件数が少ないときに幅で不確かさが見える */
export function wilson(wins: number, n: number): { lo: number; hi: number; p: number } {
  if (n === 0) return { lo: 0, hi: 1, p: 0 }
  const z = 1.96
  const p = wins / n
  const d = 1 + (z * z) / n
  const c = p + (z * z) / (2 * n)
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return { lo: Math.max(0, (c - s) / d), hi: Math.min(1, (c + s) / d), p }
}

/** 2群の勝率差の両側p値（正規近似の2比率検定） */
export function twoProportionP(w1: number, n1: number, w2: number, n2: number): number {
  if (n1 === 0 || n2 === 0) return 1
  const p1 = w1 / n1
  const p2 = w2 / n2
  const p = (w1 + w2) / (n1 + n2)
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
  if (se === 0) return 1
  const z = Math.abs(p1 - p2) / se
  // 標準正規の上側確率（Abramowitz-Stegun近似）を2倍
  const t = 1 / (1 + 0.2316419 * z)
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  const upper = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return Math.min(1, 2 * upper)
}

/**
 * 並べ替え検定：グループ分けが損益合計に対して意味を持つかを、
 * ラベルをシャッフルした分布と比較して判定する。多重比較に強い。
 */
export function permutationP(
  values: number[],
  groupIndex: number[],
  groupCount: number,
  iterations = 20000,
  seed = 12345,
): number {
  const stat = (idx: number[]) => {
    const sums = new Array(groupCount).fill(0)
    const cnts = new Array(groupCount).fill(0)
    for (let i = 0; i < values.length; i++) {
      sums[idx[i]] += values[i]
      cnts[idx[i]]++
    }
    let s = 0
    for (let g = 0; g < groupCount; g++) if (cnts[g] > 0) s += (sums[g] / cnts[g]) ** 2 * cnts[g]
    return s
  }
  const observed = stat(groupIndex)
  // 再現性のある擬似乱数（mulberry32）
  let a = seed
  const rnd = () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const shuffled = [...groupIndex]
  let ge = 0
  for (let it = 0; it < iterations; it++) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    if (stat(shuffled) >= observed) ge++
  }
  return (ge + 1) / (iterations + 1)
}
