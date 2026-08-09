/** 画面をまたいで使う小さな部品 */
import { useEffect, useState, type ReactNode } from 'react'
import { applyTheme, currentTheme, THEMES, type Theme } from '../lib/theme'
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

/** これ未満の件数では勝率などを確定的に読まない */
export const REFERENCE_N = 30

/**
 * 内訳の表。グラフで色分けした情報を必ず文字でも読めるようにするための
 * テーブルビューを兼ねる（アクセシビリティ上の必須要件）。
 *
 * 件数が {@link REFERENCE_N} 未満の行は勝率を灰色にして「参考」と付ける。
 * n=1 で「勝率100%」と黒字で出すと、確かめられていないことを
 * 確かめたように見せてしまうため。
 */
export function StatsTable({
  rows,
  firstColumn = '区分',
}: {
  rows: (Group<unknown> & { name?: string })[]
  firstColumn?: string
}) {
  const thin = rows.some((r) => r.stats.trades < REFERENCE_N)
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
              <td style={r.stats.trades < REFERENCE_N ? { color: 'var(--ink-muted)' } : undefined}>
                {percent(winRate(r.stats), 0)}
                {r.stats.trades < REFERENCE_N && (
                  <span style={{ fontSize: 10, marginLeft: 5, opacity: 0.85 }}>参考</span>
                )}
              </td>
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
      {thin && (
        <p className="note" style={{ margin: '12px 0 0' }}>
          「参考」は決済{REFERENCE_N}回未満の行です。勝率は数回の結果で大きく振れるため、確定的な数字としては読めません。
        </p>
      )}
    </div>
  )
}

/** 指標の意味を1行で添える */
export function Footnote({ children }: { children: ReactNode }) {
  return <p className="note" style={{ marginTop: 14, marginBottom: 0 }}>{children}</p>
}

export type StatsLike = Stats

/* ------------------------------------------------------------------ */
/* テーマ切り替え                                                      */
/* ------------------------------------------------------------------ */

/**
 * 白 / 紺 / 黒 の切り替え。
 * 選択は localStorage に保存され、次回起動時は index.html の
 * インラインスクリプトが描画前に適用する。
 */
export function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>(() => currentTheme())

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  return (
    <div className={`theme-switch${compact ? ' compact' : ''}`} role="group" aria-label="配色テーマ">
      {THEMES.map((t) => (
        <button
          key={t.value}
          aria-pressed={t.value === theme}
          onClick={() => setTheme(t.value)}
          title={`${t.label}基調`}
        >
          <span className={`swatch swatch-${t.value}`} aria-hidden="true" />
          {t.label}
        </button>
      ))}
    </div>
  )
}
