/** 画面をまたいで使う小さな部品 */
import type { ReactNode } from 'react'
import {
  avgLoss,
  avgWin,
  expectancy,
  profitFactor,
  winRate,
  type Group,
  type Stats,
} from '../lib/analytics'
import { percent, ratio, sign, signedYen, yen } from '../lib/format'

export function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'pos' | 'neg' | 'zero'
}) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className={`value ${tone ?? ''}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

export function Card({
  title,
  desc,
  aside,
  children,
}: {
  title?: string
  desc?: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="card">
      {(title || aside) && (
        <header>
          <div>
            {title && <h2>{title}</h2>}
            {desc && <p>{desc}</p>}
          </div>
          {aside}
        </header>
      )}
      {children}
    </section>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button key={o.value} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * 内訳の表。グラフで色分けした情報を必ず文字でも読めるようにするための
 * テーブルビューを兼ねる（アクセシビリティ上の必須要件）。
 */
export function StatsTable({
  rows,
  firstColumn = '区分',
}: {
  rows: (Group<unknown> & { name?: string })[]
  firstColumn?: string
}) {
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>{firstColumn}</th>
            <th>回数</th>
            <th>勝率</th>
            <th>平均利益</th>
            <th>平均損失</th>
            <th>PF</th>
            <th>期待値</th>
            <th>損益</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r.key)}>
              <td>
                {r.name ? (
                  <span className="sym">
                    <b>{r.name}</b>
                    <span>{String(r.key)}</span>
                  </span>
                ) : (
                  r.label
                )}
              </td>
              <td>{r.stats.trades.toLocaleString('ja-JP')}</td>
              <td>{percent(winRate(r.stats), 0)}</td>
              <td>{r.stats.wins ? yen(avgWin(r.stats) ?? 0) : '—'}</td>
              <td>{r.stats.losses ? `-${yen(avgLoss(r.stats) ?? 0)}` : '—'}</td>
              <td>{ratio(profitFactor(r.stats))}</td>
              <td className={sign(expectancy(r.stats) ?? 0)}>{signedYen(expectancy(r.stats) ?? 0)}</td>
              <td className={sign(r.stats.pnl)} style={{ fontWeight: 600 }}>
                {signedYen(r.stats.pnl)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 指標の意味を1行で添える */
export function Footnote({ children }: { children: ReactNode }) {
  return <p className="note" style={{ marginTop: 14, marginBottom: 0 }}>{children}</p>
}

export type StatsLike = Stats
