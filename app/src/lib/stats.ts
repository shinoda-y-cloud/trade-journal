/**
 * 検定と区間推定。
 *
 * ## 設計方針：既定で「同一日の建玉を独立標本として数えない」
 *
 * 1,901件の建玉は216営業日にかたまっている。同じ日に同じ方向で複数建てれば
 * 勝敗は連動するため、建玉を独立と見なした検定は p 値を大きく過小評価する。
 * 実測で、曜日と勝敗の関係は建玉単位で p=0.0022 だったものが、
 * 日をブロックとした並べ替えでは p=0.1048 になった。
 *
 * そのため、このファイルの検定はすべて決済日をクラスタとして扱う。
 * - グループ分けが日単位で決まる場合（曜日など） → 日ラベルの並べ替え検定
 * - グループ分けが建玉単位で決まる場合（建玉金額など） → 日単位のブートストラップ
 *
 * 乱数は固定シード。同じデータなら常に同じ p 値になる。
 */

/** 再現性のある擬似乱数（mulberry32） */
function rng(seed = 12345): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ------------------------------------------------------------------ */
/* 区間推定                                                            */
/* ------------------------------------------------------------------ */

/** 勝率のWilson 95%信頼区間。件数が少ないほど幅が広がる */
export function wilson(wins: number, n: number): { lo: number; hi: number; p: number } {
  if (n === 0) return { lo: 0, hi: 1, p: 0 }
  const z = 1.96
  const p = wins / n
  const d = 1 + (z * z) / n
  const c = p + (z * z) / (2 * n)
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return { lo: Math.max(0, (c - s) / d), hi: Math.min(1, (c + s) / d), p }
}

/** 標準正規の上側確率（Abramowitz-Stegun近似） */
function normalUpper(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  return d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
}

/** 2群の比率差の両側p値（正規近似）。クラスタを考慮しないので参考値 */
export function twoProportionP(w1: number, n1: number, w2: number, n2: number): number {
  if (n1 === 0 || n2 === 0) return 1
  const p = (w1 + w2) / (n1 + n2)
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
  if (se === 0) return 1
  return Math.min(1, 2 * normalUpper(Math.abs(w1 / n1 - w2 / n2) / se))
}

/* ------------------------------------------------------------------ */
/* 並べ替え検定（日ブロック）                                          */
/* ------------------------------------------------------------------ */

export interface DayItem {
  /** クラスタの識別子。決済日 */
  day: string
  /** 検定する量（損益など） */
  value: number
  /** 群の番号 */
  group: number
  /** 勝ちなら1、負けなら0、引き分けは null（勝率の分母から外す） */
  win: number | null
}

export interface TestResult {
  p: number
  /** 群数 */
  groups: number
  /** 最小の群サイズ */
  minN: number
  /** クラスタ（決済日）の数 */
  clusters: number
  method: string
}

/**
 * グループ分けが日単位で決まる場合の並べ替え検定。
 * 日ラベルをシャッフルし、その日に属する全建玉が同じ群を受け取る。
 */
export function permutationByDayBlock(
  items: DayItem[],
  groupCount: number,
  metric: 'value' | 'win' = 'value',
  iters = 10_000,
  seed = 12345,
): TestResult {
  // 日ごとに集計してから回すので、反復あたりのコストは日数に比例する
  const byDay = new Map<string, { group: number; sum: number; n: number }>()
  for (const it of items) {
    const v = metric === 'value' ? it.value : it.win
    if (v === null) continue
    const e = byDay.get(it.day) ?? { group: it.group, sum: 0, n: 0 }
    e.sum += v
    e.n++
    byDay.set(it.day, e)
  }
  const days = [...byDay.values()]
  if (days.length < 4) {
    return { p: 1, groups: groupCount, minN: 0, clusters: days.length, method: '日ブロック並べ替え（クラスタ不足）' }
  }

  const stat = (labels: number[]) => {
    const sums = new Array(groupCount).fill(0)
    const cnts = new Array(groupCount).fill(0)
    for (let i = 0; i < days.length; i++) {
      sums[labels[i]] += days[i].sum
      cnts[labels[i]] += days[i].n
    }
    let total = 0
    let totalN = 0
    for (let g = 0; g < groupCount; g++) {
      total += sums[g]
      totalN += cnts[g]
    }
    const grand = totalN === 0 ? 0 : total / totalN
    // 群平均の重み付き分散（群間平方和）
    let s = 0
    for (let g = 0; g < groupCount; g++) {
      if (cnts[g] > 0) s += cnts[g] * (sums[g] / cnts[g] - grand) ** 2
    }
    return s
  }

  const labels = days.map((d) => d.group)
  const observed = stat(labels)
  const rnd = rng(seed)
  const shuffled = [...labels]
  let ge = 0
  for (let it = 0; it < iters; it++) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    if (stat(shuffled) >= observed) ge++
  }

  const perGroup = new Array(groupCount).fill(0)
  for (const it of items) perGroup[it.group]++

  return {
    p: (ge + 1) / (iters + 1),
    groups: groupCount,
    minN: Math.min(...perGroup),
    clusters: days.length,
    method: `日ブロック並べ替え検定（${iters.toLocaleString('ja-JP')}反復）`,
  }
}

/* ------------------------------------------------------------------ */
/* クラスタ・ブートストラップ                                          */
/* ------------------------------------------------------------------ */

export interface DiffResult {
  /** 群A − 群B の推定値 */
  diff: number
  lo: number
  hi: number
  /** 0を跨ぐかどうかから導いた両側p値 */
  p: number
  nA: number
  nB: number
  clusters: number
  method: string
}

/**
 * 建玉単位で群が決まる場合の差の推定。
 * 決済日を単位に復元抽出することで、同一日の相関を織り込む。
 */
export function clusterBootstrapDiff(
  items: DayItem[],
  metric: 'value' | 'win' = 'value',
  iters = 10_000,
  seed = 12345,
): DiffResult {
  const byDay = new Map<string, { sA: number; nA: number; sB: number; nB: number }>()
  for (const it of items) {
    const v = metric === 'value' ? it.value : it.win
    if (v === null) continue
    const e = byDay.get(it.day) ?? { sA: 0, nA: 0, sB: 0, nB: 0 }
    if (it.group === 0) {
      e.sA += v
      e.nA++
    } else {
      e.sB += v
      e.nB++
    }
    byDay.set(it.day, e)
  }
  const days = [...byDay.values()]
  const totals = days.reduce(
    (a, d) => ({ sA: a.sA + d.sA, nA: a.nA + d.nA, sB: a.sB + d.sB, nB: a.nB + d.nB }),
    { sA: 0, nA: 0, sB: 0, nB: 0 },
  )
  const observed = (totals.nA ? totals.sA / totals.nA : 0) - (totals.nB ? totals.sB / totals.nB : 0)

  if (days.length < 4 || totals.nA === 0 || totals.nB === 0) {
    return { diff: observed, lo: NaN, hi: NaN, p: 1, nA: totals.nA, nB: totals.nB, clusters: days.length, method: 'クラスタ・ブートストラップ（クラスタ不足）' }
  }

  const rnd = rng(seed)
  const draws: number[] = []
  let positive = 0
  for (let i = 0; i < iters; i++) {
    let sA = 0
    let nA = 0
    let sB = 0
    let nB = 0
    for (let k = 0; k < days.length; k++) {
      const d = days[Math.floor(rnd() * days.length)]
      sA += d.sA
      nA += d.nA
      sB += d.sB
      nB += d.nB
    }
    const v = (nA ? sA / nA : 0) - (nB ? sB / nB : 0)
    draws.push(v)
    if (v > 0) positive++
  }
  draws.sort((a, b) => a - b)
  const lo = draws[Math.floor(iters * 0.025)]
  const hi = draws[Math.floor(iters * 0.975)]
  const tail = Math.min(positive, iters - positive)
  return {
    diff: observed,
    lo,
    hi,
    p: Math.min(1, (2 * (tail + 1)) / (iters + 1)),
    nA: totals.nA,
    nB: totals.nB,
    clusters: days.length,
    method: `日クラスタ・ブートストラップ（${iters.toLocaleString('ja-JP')}反復）`,
  }
}

/* ------------------------------------------------------------------ */
/* 多重比較の補正                                                      */
/* ------------------------------------------------------------------ */

/** Holm法。入力と同じ並びで補正後p値を返す */
export function holm(ps: number[]): number[] {
  const idx = ps.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p)
  const out = new Array(ps.length).fill(1)
  let running = 0
  idx.forEach(({ p, i }, rank) => {
    const adj = Math.min(1, (ps.length - rank) * p)
    running = Math.max(running, adj)
    out[i] = running
  })
  return out
}

/**
 * K本の検定を5%水準で回したとき、すべて帰無でも1本以上「有意」が出る確率。
 * ユーザーに多重比較の危険を数字で示すために使う。
 */
export function familywiseRisk(k: number, alpha = 0.05): number {
  return 1 - (1 - alpha) ** k
}

/* ------------------------------------------------------------------ */
/* 相関・記述統計                                                      */
/* ------------------------------------------------------------------ */

export function spearman(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n < 3) return 0
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x)
    const r = new Array(n).fill(0)
    let i = 0
    while (i < n) {
      let j = i
      while (j + 1 < n && idx[j + 1].x === idx[i].x) j++
      const avg = (i + j) / 2 + 1
      for (let k = i; k <= j; k++) r[idx[k].i] = avg
      i = j + 1
    }
    return r
  }
  const rx = rank(xs)
  const ry = rank(ys)
  const mx = rx.reduce((a, b) => a + b, 0) / n
  const my = ry.reduce((a, b) => a + b, 0) / n
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my)
    dx += (rx[i] - mx) ** 2
    dy += (ry[i] - my) ** 2
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

/**
 * 外れ値への頑健性。各群から上位1件と下位1件を「両方」除いて再計算する。
 * 片側だけ除くのは非対称な操作で、結論を作れてしまうため禁止。
 */
export function trimBothEnds<T>(items: T[], valueOf: (t: T) => number, k = 1): T[] {
  if (items.length <= 2 * k) return []
  const sorted = [...items].sort((a, b) => valueOf(a) - valueOf(b))
  return sorted.slice(k, sorted.length - k)
}
