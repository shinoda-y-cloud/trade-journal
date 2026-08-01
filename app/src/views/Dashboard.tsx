import { useMemo, useState } from 'react'
import {
  averageHoldingDays,
  byPeriod,
  equityCurve,
  expectancy,
  formatPeriodKey,
  maxDrawdown,
  payoffRatio,
  profitFactor,
  streaks,
  summarize,
  winRate,
  type Period,
} from '../lib/analytics'
import { num, percent, ratio, sign, signedYen, yen } from '../lib/format'
import type { Position } from '../lib/sbi/types'
import { EquityChart, PnlBars, PolarityLegend } from '../components/charts'
import { Card, Segmented, Tile, Footnote } from '../components/ui'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'week', label: '週' },
  { value: 'month', label: '月' },
  { value: 'quarter', label: '四半期' },
  { value: 'year', label: '年' },
]

export function Dashboard({ positions }: { positions: Position[] }) {
  const [period, setPeriod] = useState<Period>('month')

  const stats = useMemo(() => summarize(positions), [positions])
  const curve = useMemo(() => equityCurve(positions), [positions])
  const bars = useMemo(
    () =>
      byPeriod(positions, period).map((g) => ({
        key: g.key,
        label: formatPeriodKey(g.key, period).replace(/^\d{4}年/, ''),
        value: g.stats.pnl,
      })),
    [positions, period],
  )
  const st = useMemo(() => streaks(positions), [positions])
  const dd = maxDrawdown(curve)
  const hold = averageHoldingDays(positions)

  return (
    <div className="grid" style={{ gap: 14 }}>
      <Card>
        <div className="hero">
          <span className="label">実現損益（累計・税引前）</span>
          <span className={`value ${sign(stats.pnl)}`}>{signedYen(stats.pnl)}</span>
          <span className="sub" style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>
            {curve.length > 0 && `${curve[0].date} 〜 ${curve[curve.length - 1].date} · `}
            {stats.trades.toLocaleString('ja-JP')}回の決済 · 手数料等 {yen(stats.fee)}円を含む
          </span>
        </div>
        <div style={{ marginTop: 18 }}>
          <EquityChart points={curve} />
        </div>
      </Card>

      <div className="grid cols-4">
        <Tile label="勝率" value={percent(winRate(stats))} sub={`${stats.wins}勝 ${stats.losses}敗`} />
        <Tile
          label="1回あたり期待値"
          value={signedYen(expectancy(stats) ?? 0)}
          tone={sign(expectancy(stats) ?? 0)}
          sub="決済1回あたりの平均損益"
        />
        <Tile label="プロフィットファクター" value={ratio(profitFactor(stats))} sub={`総利益 ${yen(stats.grossProfit)} / 総損失 ${yen(stats.grossLoss)}`} />
        <Tile label="最大ドローダウン" value={dd === 0 ? '—' : `-${yen(dd)}`} tone={dd === 0 ? 'zero' : 'neg'} sub="累積損益のピークからの下落幅" />
      </div>

      <div className="grid cols-4">
        <Tile label="ペイオフレシオ" value={ratio(payoffRatio(stats))} sub="平均利益 ÷ 平均損失" />
        <Tile label="平均保有日数" value={hold === null ? '—' : num(hold, 1)} sub="建玉から決済まで" />
        <Tile label="最大連勝" value={`${st.win}`} sub="連続して利益が出た回数" />
        <Tile label="最大連敗" value={`${st.loss}`} sub="連続して損失が出た回数" />
      </div>

      <Card
        title={`${PERIODS.find((p) => p.value === period)!.label}ごとの損益`}
        aside={<Segmented options={PERIODS} value={period} onChange={setPeriod} />}
      >
        <PnlBars data={bars} />
        <div style={{ marginTop: 12 }}>
          <PolarityLegend />
        </div>
        <Footnote>
          プロフィットファクターは 1.0 を上回ると総利益が総損失を上回っている状態です。金額は税引前で、信用取引の金利・貸株料は差し引き済みです。
        </Footnote>
      </Card>
    </div>
  )
}
