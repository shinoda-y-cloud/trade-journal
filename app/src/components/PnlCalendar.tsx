/**
 * 日次損益のカレンダー。
 *
 * セルの色は diverging ヒートマップ（青=利益 / 赤=損失、中点は面の色）。
 * 濃さはその月の最大絶対損益に対する相対値。色だけに頼らないよう、
 * 取引があった日には必ず金額を文字でも表示する。
 */
import { useMemo, useState } from 'react'
import { compactYen, longDate } from '../lib/format'
import { signedYen } from '../lib/format'
import type { Position } from '../lib/sbi/types'
import { TradeSummary, TradeTable } from './TradeTable'

const WEEK = ['月', '火', '水', '木', '金', '土', '日']

interface DayCell {
  date: string
  day: number
  pnl: number | null
  trades: number
}

export function PnlCalendar({ positions }: { positions: Position[] }) {
  const daily = useMemo(() => {
    const m = new Map<string, { pnl: number; trades: number }>()
    for (const p of positions) {
      const e = m.get(p.closeDate) ?? { pnl: 0, trades: 0 }
      e.pnl += p.realizedPnl
      e.trades++
      m.set(p.closeDate, e)
    }
    return m
  }, [positions])

  const months = useMemo(() => {
    const set = new Set<string>()
    for (const d of daily.keys()) set.add(d.slice(0, 7))
    return [...set].sort()
  }, [daily])

  const [cursor, setCursor] = useState(() => months[months.length - 1] ?? '')
  const [picked, setPicked] = useState<DayCell | null>(null)

  // 選択日の建玉。日付が変わるたびに絞り込む
  const dayPositions = useMemo(
    () => (picked ? positions.filter((p) => p.closeDate === picked.date) : []),
    [positions, picked],
  )

  if (months.length === 0) return null
  const month = months.includes(cursor) ? cursor : months[months.length - 1]
  const idx = months.indexOf(month)

  const [y, m] = month.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1))
  const lead = (first.getUTCDay() + 6) % 7 // 月曜始まり
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()

  const cells: (DayCell | null)[] = Array.from({ length: lead }, () => null)
  let monthPnl = 0
  let monthTrades = 0
  for (let d = 1; d <= days; d++) {
    const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const e = daily.get(date)
    if (e) {
      monthPnl += e.pnl
      monthTrades += e.trades
    }
    cells.push({ date, day: d, pnl: e?.pnl ?? null, trades: e?.trades ?? 0 })
  }

  const span = Math.max(...cells.map((c) => (c?.pnl ? Math.abs(c.pnl) : 0)), 1)

  /**
   * 損益の絶対値から塗りの濃さを決める。中点はセル背景そのもの。
   * 4段階に量子化して、わずかな差が濃淡として過剰に読まれないようにする。
   * 最濃を72%に留めてあるのは、その上に載る文字（常に --ink）が
   * ライト・ダークどちらでもコントラスト比4.5:1を確保できる上限のため。
   */
  const fill = (pnl: number | null) => {
    if (pnl === null || pnl === 0) return 'transparent'
    const t = Math.min(Math.abs(pnl) / span, 1)
    const step = [20, 38, 55, 72][Math.min(Math.floor(t * 4), 3)]
    return `color-mix(in srgb, ${pnl > 0 ? 'var(--pos)' : 'var(--neg)'} ${step}%, var(--surface))`
  }

  return (
    <div>
      <div style={{ maxWidth: 760 }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 15 }}>
            {y}年{m}月
          </h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
            <span className={monthPnl >= 0 ? 'pos' : 'neg'} style={{ fontWeight: 600 }}>
              {signedYen(monthPnl)}
            </span>
            <span> · {monthTrades}回</span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn" disabled={idx === 0} onClick={() => setCursor(months[idx - 1])} aria-label="前の月" style={{ opacity: idx === 0 ? 0.4 : 1, padding: '7px 12px' }}>
            ‹
          </button>
          <button
            className="btn"
            disabled={idx === months.length - 1}
            onClick={() => setCursor(months[idx + 1])}
            aria-label="次の月"
            style={{ opacity: idx === months.length - 1 ? 0.4 : 1, padding: '7px 12px' }}
          >
            ›
          </button>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', gap: 4 }}>
        {WEEK.map((w, i) => (
          <div
            key={w}
            style={{
              fontSize: 11,
              textAlign: 'center',
              paddingBottom: 4,
              color: i === 5 ? 'var(--pos)' : i === 6 ? 'var(--neg)' : 'var(--ink-muted)',
            }}
          >
            {w}
          </div>
        ))}
        {cells.map((c, i) =>
          c === null ? (
            <div key={`p${i}`} />
          ) : (
            <button
              key={c.date}
              onClick={() => setPicked(picked?.date === c.date ? null : c)}
              aria-label={`${longDate(c.date)} ${c.pnl === null ? '取引なし' : signedYen(c.pnl)}`}
              style={{
                aspectRatio: '1 / 1',
                border: `1px solid ${picked?.date === c.date ? 'var(--ink)' : 'var(--border)'}`,
                borderRadius: 8,
                background: fill(c.pnl),
                color: 'var(--ink)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                padding: 2,
                minWidth: 0,
              }}
            >
              <span style={{ fontSize: 11, opacity: c.pnl === null ? 0.45 : 0.8, fontVariantNumeric: 'tabular-nums' }}>{c.day}</span>
              {c.pnl !== null && (
                <span style={{ fontSize: 10.5, fontWeight: 650, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                  {compactYen(c.pnl)}
                </span>
              )}
            </button>
          ),
        )}
      </div>
      </div>

      {picked && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--grid)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 14 }}>{longDate(picked.date)}</h3>
            <button
              className="btn"
              onClick={() => setPicked(null)}
              style={{ padding: '5px 11px', fontSize: 12 }}
            >
              閉じる
            </button>
          </div>
          {picked.pnl === null ? (
            <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginTop: 10 }}>この日の決済はありません。</div>
          ) : (
            <>
              <TradeSummary positions={dayPositions} />
              <TradeTable positions={dayPositions} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
