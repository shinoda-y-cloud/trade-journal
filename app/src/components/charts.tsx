/**
 * グラフ部品。外部チャートライブラリは使わず素のSVGで描く。
 *
 * 色の設計：損益は「極性」を持つ量なので diverging（青=利益 / 赤=損失、
 * 中点はグレー）で統一する。カテゴリ配色は使わない — 同じ青が
 * 「利益」と「買い建て」の両方を意味してしまう衝突を避けるため。
 *
 * マーク仕様は data-viz スキルに準拠：棒は24px以下・データ端のみ4px丸め、
 * 線は2px、隣接する棒の間に2pxの余白、グリッドは1px実線で控えめに。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { compactYen, shortDate, signedYen } from '../lib/format'

/* ------------------------------------------------------------------ */

/**
 * 親要素の幅に追従させる。
 *
 * 1px未満の変化では state を更新しない。棒の位置や列幅を幅から計算している
 * 部品があるため、微小な差で再測定→再描画が往復すると止まらなくなる。
 */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const apply = (next: number) => setW((prev) => (Math.abs(prev - next) < 1 ? prev : Math.round(next)))
    const ro = new ResizeObserver(([entry]) => apply(entry.contentRect.width))
    ro.observe(el)
    apply(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** データ端だけを丸めた棒。ベースライン側は角のまま */
function barPath(x: number, w: number, base: number, y: number, r = 4): string {
  const up = y <= base
  const rr = Math.min(r, w / 2, Math.abs(base - y))
  return up
    ? `M${x},${base} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${base} Z`
    : `M${x},${base} L${x},${y - rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y - rr} L${x + w},${base} Z`
}

/** 目盛りに使うきりのいい数値 */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min]
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10
  const ticks: number[] = []
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-6; t += step) ticks.push(t)
  return ticks
}

/** カーソル追従のツールチップ枠 */
function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x - 70, 4), Math.max(width - 148, 4))
  return (
    <div className="tt" style={{ position: 'absolute', left, top: Math.max(y - 60, 4), width: 144 }}>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 累積損益カーブ                                                       */
/* ------------------------------------------------------------------ */

export interface CurvePoint {
  date: string
  cumulative: number
}

export function EquityChart({ points, height = 260 }: { points: CurvePoint[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  const pad = { top: 14, right: 12, bottom: 24, left: 56 }
  const iw = Math.max(width - pad.left - pad.right, 10)
  const ih = height - pad.top - pad.bottom

  if (points.length === 0) return <div ref={ref} style={{ height }} />

  const values = points.map((p) => p.cumulative)
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  const ticks = niceTicks(lo, hi)
  const yMin = Math.min(lo, ticks[0])
  const yMax = Math.max(hi, ticks[ticks.length - 1])

  const X = (i: number) => (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw)
  const Y = (v: number) => ih - ((v - yMin) / (yMax - yMin || 1)) * ih
  const zeroY = Y(0)

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(i)},${Y(p.cumulative)}`).join(' ')
  const area = `${line} L${X(points.length - 1)},${zeroY} L${X(0)},${zeroY} Z`

  const last = points[points.length - 1]
  const positive = last.cumulative >= 0
  const color = positive ? 'var(--pos)' : 'var(--neg)'

  const hp = hover === null ? null : points[hover]

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg
        width="100%"
        height={height}
        role="img"
        aria-label="累積損益の推移"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const rel = e.clientX - r.left - pad.left
          const i = Math.round((rel / iw) * (points.length - 1))
          setHover(Math.min(Math.max(i, 0), points.length - 1))
        }}
      >
        <g transform={`translate(${pad.left},${pad.top})`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={iw} y1={Y(t)} y2={Y(t)} stroke="var(--grid)" strokeWidth={1} />
              <text
                x={-10}
                y={Y(t)}
                dy="0.32em"
                textAnchor="end"
                fontSize={11}
                fill="var(--ink-muted)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {compactYen(t)}
              </text>
            </g>
          ))}
          {/* ゼロ基準線は他のグリッドより一段濃く */}
          <line x1={0} x2={iw} y1={zeroY} y2={zeroY} stroke="var(--axis)" strokeWidth={1} />

          <path d={area} fill={color} fillOpacity={0.1} />
          <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {/* 終点だけ直接ラベルを置く */}
          <circle cx={X(points.length - 1)} cy={Y(last.cumulative)} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />

          {hp && (
            <>
              <line x1={X(hover!)} x2={X(hover!)} y1={0} y2={ih} stroke="var(--axis)" strokeWidth={1} />
              <circle cx={X(hover!)} cy={Y(hp.cumulative)} r={4.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
            </>
          )}

          <text x={0} y={ih + 17} fontSize={11} fill="var(--ink-muted)">
            {shortDate(points[0].date)}
          </text>
          <text x={iw} y={ih + 17} fontSize={11} fill="var(--ink-muted)" textAnchor="end">
            {shortDate(last.date)}
          </text>
        </g>
      </svg>
      {hp && (
        <Tooltip x={X(hover!) + pad.left} y={Y(hp.cumulative) + pad.top} width={width}>
          <div className="k">{hp.date}</div>
          <div className="v">累積 {signedYen(hp.cumulative)}</div>
        </Tooltip>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 期間別の損益（縦棒・diverging）                                       */
/* ------------------------------------------------------------------ */

export interface BarDatum {
  key: string
  label: string
  value: number
}

export function PnlBars({ data, height = 240 }: { data: BarDatum[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  // 下向きの棒に付く数値ラベルが軸ラベルと重ならないよう、下の余白を広く取る
  const pad = { top: 18, right: 12, bottom: 46, left: 56 }
  const iw = Math.max(width - pad.left - pad.right, 10)
  const ih = height - pad.top - pad.bottom

  if (data.length === 0) return <div ref={ref} style={{ height }} />

  const values = data.map((d) => d.value)
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values))
  const yMin = Math.min(0, ...values, ticks[0])
  const yMax = Math.max(0, ...values, ticks[ticks.length - 1])
  const Y = (v: number) => ih - ((v - yMin) / (yMax - yMin || 1)) * ih
  const zeroY = Y(0)

  const band = iw / data.length
  // 棒は24px上限、隣接する棒の間には必ず2px以上の余白を残す
  const bw = Math.max(Math.min(band - 2, 24), 2)

  // ラベルは全点に打たず、最大と最小だけ
  const maxI = values.indexOf(Math.max(...values))
  const minI = values.indexOf(Math.min(...values))
  const labelled = new Set(data.length > 2 ? [maxI, minI] : data.map((_, i) => i))

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width="100%" height={height} role="img" aria-label="期間ごとの損益">
        <g transform={`translate(${pad.left},${pad.top})`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={iw} y1={Y(t)} y2={Y(t)} stroke="var(--grid)" strokeWidth={1} />
              <text x={-10} y={Y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--ink-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {compactYen(t)}
              </text>
            </g>
          ))}
          <line x1={0} x2={iw} y1={zeroY} y2={zeroY} stroke="var(--axis)" strokeWidth={1} />

          {data.map((d, i) => {
            const x = i * band + (band - bw) / 2
            const y = Y(d.value)
            const color = d.value >= 0 ? 'var(--pos)' : 'var(--neg)'
            return (
              <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                {/* 当たり判定を棒より広く取る */}
                <rect x={i * band} y={0} width={band} height={ih} fill="transparent" />
                <path d={barPath(x, bw, zeroY, y)} fill={color} opacity={hover === null || hover === i ? 1 : 0.45} />
                {labelled.has(i) && (
                  <text
                    x={x + bw / 2}
                    y={d.value >= 0 ? Math.max(y - 7, -6) : Math.min(y + 15, ih + 15)}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={600}
                    fill="var(--ink-2)"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {compactYen(d.value)}
                  </text>
                )}
              </g>
            )
          })}

          {data.map((d, i) =>
            data.length <= 14 || i % Math.ceil(data.length / 10) === 0 ? (
              <text key={d.key} x={i * band + band / 2} y={ih + 35} textAnchor="middle" fontSize={10.5} fill="var(--ink-muted)">
                {d.label}
              </text>
            ) : null,
          )}
        </g>
      </svg>
      {hover !== null && (
        <Tooltip x={hover * band + band / 2 + pad.left} y={Y(data[hover].value) + pad.top} width={width}>
          <div className="k">{data[hover].label}</div>
          <div className="v">{signedYen(data[hover].value)}</div>
        </Tooltip>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 横棒（内訳の比較用）                                                 */
/* ------------------------------------------------------------------ */

export interface HBarDatum extends BarDatum {
  sub?: string
}

export function HBars({
  data,
  format = signedYen,
}: {
  data: HBarDatum[]
  /** 値ラベルの整形。既定は円表記 */
  format?: (v: number) => string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  if (data.length === 0) return <div ref={ref} />

  const labelW = Math.round(Math.min(Math.max(width * 0.34, 110), 220))
  const valueW = 90
  const track = Math.max(width - labelW - valueW - 16, 40)
  const span = Math.max(...data.map((d) => Math.abs(d.value)), 1)

  // 全て同符号なら軸を端に寄せ、目盛り幅をフルに使う。
  // 正負が混在するときだけ中央にゼロ軸を置く。
  const hasPos = data.some((d) => d.value > 0)
  const hasNeg = data.some((d) => d.value < 0)
  const split = hasPos && hasNeg
  const zero = split ? track / 2 : hasNeg ? track : 0
  const reach = split ? track / 2 : track

  return (
    <div ref={ref} style={{ display: 'grid', gap: 8 }}>
      {data.map((d) => {
        const w = Math.max((Math.abs(d.value) / span) * reach, 2)
        const positive = d.value >= 0
        return (
          <div key={d.key} style={{ display: 'grid', gridTemplateColumns: `${labelW}px 1fr ${valueW}px`, alignItems: 'center', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {d.label}
              </div>
              {d.sub && (
                <div style={{ fontSize: 10.5, color: 'var(--ink-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.sub}
                </div>
              )}
            </div>
            <svg width="100%" height={20} role="img" aria-label={`${d.label} ${format(d.value)}`}>
              <line x1={zero} x2={zero} y1={0} y2={20} stroke="var(--axis)" strokeWidth={1} />
              <rect x={positive ? zero : zero - w} y={3} width={w} height={14} rx={4} fill={positive ? 'var(--pos)' : 'var(--neg)'} />
            </svg>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                textAlign: 'right',
                fontVariantNumeric: 'tabular-nums',
                color: positive ? 'var(--pos)' : 'var(--neg)',
              }}
            >
              {format(d.value)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** 損益の色分けを説明する凡例。色だけに意味を負わせないために必ず添える */
export function PolarityLegend() {
  return (
    <div className="legend">
      <span>
        <i style={{ background: 'var(--pos)' }} />
        利益
      </span>
      <span>
        <i style={{ background: 'var(--neg)' }} />
        損失
      </span>
    </div>
  )
}

/** 初回マウント後にフェードインさせる（描画のちらつき防止） */
export function useMounted() {
  const [m, setM] = useState(false)
  useEffect(() => setM(true), [])
  return m
}

/* ------------------------------------------------------------------ */
/* ウォーターフォール（総利益・総損失・純損益の関係）                   */
/* ------------------------------------------------------------------ */

export function Waterfall({
  grossProfit,
  grossLoss,
  height = 220,
}: {
  grossProfit: number
  grossLoss: number
  height?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const net = grossProfit + grossLoss

  const pad = { top: 26, right: 12, bottom: 34, left: 62 }
  const iw = Math.max(width - pad.left - pad.right, 10)
  const ih = height - pad.top - pad.bottom

  const lo = Math.min(0, net, grossLoss + grossProfit)
  const hi = Math.max(0, grossProfit)
  const ticks = niceTicks(lo, hi)
  const yMin = Math.min(lo, ticks[0])
  const yMax = Math.max(hi, ticks[ticks.length - 1])
  const Y = (v: number) => ih - ((v - yMin) / (yMax - yMin || 1)) * ih

  // 総利益を積み上げ、そこから総損失を引き、残りが純損益
  const bars = [
    { label: '総利益', from: 0, to: grossProfit, color: 'var(--pos)', value: grossProfit },
    { label: '総損失', from: grossProfit, to: net, color: 'var(--neg)', value: grossLoss },
    { label: '純損益', from: 0, to: net, color: net >= 0 ? 'var(--pos)' : 'var(--neg)', value: net },
  ]
  const band = iw / bars.length
  const bw = Math.max(Math.min(band - 2, 72), 2)

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width="100%" height={height} role="img" aria-label="総利益と総損失の差し引き">
        <g transform={`translate(${pad.left},${pad.top})`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={iw} y1={Y(t)} y2={Y(t)} stroke="var(--grid)" strokeWidth={1} />
              <text x={-10} y={Y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--ink-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {compactYen(t)}
              </text>
            </g>
          ))}
          <line x1={0} x2={iw} y1={Y(0)} y2={Y(0)} stroke="var(--axis)" strokeWidth={1} />

          {bars.map((b, i) => {
            const x = i * band + (band - bw) / 2
            const top = Math.min(Y(b.from), Y(b.to))
            const h = Math.max(Math.abs(Y(b.to) - Y(b.from)), 2)
            return (
              <g key={b.label}>
                <rect x={x} y={top} width={bw} height={h} rx={4} fill={b.color} />
                <text
                  x={x + bw / 2}
                  y={top - 8}
                  textAnchor="middle"
                  fontSize={11.5}
                  fontWeight={600}
                  fill="var(--ink-2)"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {signedYen(b.value)}
                </text>
                <text x={x + bw / 2} y={ih + 20} textAnchor="middle" fontSize={11.5} fill="var(--ink-muted)">
                  {b.label}
                </text>
              </g>
            )
          })}

          {/* 総利益の頭と総損失の始点を結ぶ補助線 */}
          <line
            x1={band / 2 + bw / 2}
            x2={band + (band - bw) / 2}
            y1={Y(grossProfit)}
            y2={Y(grossProfit)}
            stroke="var(--axis)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          <line
            x1={band + band / 2 + bw / 2 - bw / 2}
            x2={2 * band + (band - bw) / 2}
            y1={Y(net)}
            y2={Y(net)}
            stroke="var(--axis)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        </g>
      </svg>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 大きさだけを表す棒（極性を持たない量）                               */
/* ------------------------------------------------------------------ */

export interface MagnitudeDatum {
  key: string
  label: string
  value: number
  /** 棒の先に出す文字。省略すると値をそのまま出す */
  display?: string
}

/**
 * 標準偏差や発生率のように「符号を持たない大きさ」を表す横棒。
 * 損益の青赤とは別の色相を使い、極性のある量と取り違えられないようにする。
 */
export function MagnitudeBars({ data, unit = '' }: { data: MagnitudeDatum[]; unit?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  if (data.length === 0) return <div ref={ref} />

  const labelW = Math.round(Math.min(Math.max(width * 0.28, 92), 180))
  const valueW = 84
  const track = Math.max(width - labelW - valueW - 16, 40)
  const span = Math.max(...data.map((d) => d.value), 1e-9)

  return (
    <div ref={ref} style={{ display: 'grid', gap: 8 }}>
      {data.map((d) => (
        <div key={d.key} style={{ display: 'grid', gridTemplateColumns: `${labelW}px 1fr ${valueW}px`, alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {d.label}
          </div>
          <svg width="100%" height={20} role="img" aria-label={`${d.label} ${d.display ?? d.value}${unit}`}>
            <line x1={0} x2={0} y1={0} y2={20} stroke="var(--axis)" strokeWidth={1} />
            <rect x={0} y={3} width={Math.max((d.value / span) * track, 2)} height={14} rx={4} fill="var(--series-2)" />
          </svg>
          <div style={{ fontSize: 12.5, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--ink-2)' }}>
            {d.display ?? d.value.toLocaleString('ja-JP')}
            {unit}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* ヒストグラム                                                        */
/* ------------------------------------------------------------------ */

export function Histogram({
  values,
  bins = 24,
  height = 170,
  format = (v: number) => compactYen(v),
  markers = [],
}: {
  values: number[]
  bins?: number
  height?: number
  format?: (v: number) => string
  markers?: { value: number; label: string }[]
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const pad = { top: 12, right: 12, bottom: 30, left: 34 }
  const iw = Math.max(width - pad.left - pad.right, 10)
  const ih = height - pad.top - pad.bottom

  if (values.length === 0) return <div ref={ref} style={{ height }} />

  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const w = (hi - lo) / bins || 1
  const counts = new Array(bins).fill(0)
  for (const v of values) counts[Math.min(Math.floor((v - lo) / w), bins - 1)]++
  const peak = Math.max(...counts, 1)

  const X = (v: number) => ((v - lo) / (hi - lo || 1)) * iw
  const bw = Math.max(iw / bins - 2, 1)

  return (
    <div ref={ref}>
      <svg width="100%" height={height} role="img" aria-label="建玉金額の分布">
        <g transform={`translate(${pad.left},${pad.top})`}>
          <line x1={0} x2={iw} y1={ih} y2={ih} stroke="var(--axis)" strokeWidth={1} />
          {counts.map((c, i) => (
            <rect
              key={i}
              x={(i * iw) / bins + 1}
              y={ih - (c / peak) * ih}
              width={bw}
              height={Math.max((c / peak) * ih, c > 0 ? 1.5 : 0)}
              rx={3}
              fill="var(--series-2)"
              opacity={0.85}
            />
          ))}
          {markers.map((m) => (
            <g key={m.label}>
              <line x1={X(m.value)} x2={X(m.value)} y1={0} y2={ih} stroke="var(--ink-2)" strokeWidth={1} strokeDasharray="3 3" />
              <text x={X(m.value)} y={-1} textAnchor="middle" fontSize={10} fill="var(--ink-muted)">
                {m.label}
              </text>
            </g>
          ))}
          <text x={0} y={ih + 18} fontSize={10.5} fill="var(--ink-muted)">
            {format(lo)}
          </text>
          <text x={iw} y={ih + 18} textAnchor="end" fontSize={10.5} fill="var(--ink-muted)">
            {format(hi)}
          </text>
          <text x={-8} y={4} textAnchor="end" fontSize={10} fill="var(--ink-muted)">
            {peak}
          </text>
        </g>
      </svg>
    </div>
  )
}
