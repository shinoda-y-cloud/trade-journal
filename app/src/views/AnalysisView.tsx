import { useMemo } from 'react'
import {
  byAccount,
  byHolding,
  byKind,
  bySide,
  byWeekday,
  type Group,
} from '../lib/analytics'
import type { Position } from '../lib/sbi/types'
import { HBars, PolarityLegend } from '../components/charts'
import { Card, Footnote, StatsTable } from '../components/ui'

function Section({
  title,
  desc,
  groups,
  firstColumn,
  footnote,
}: {
  title: string
  desc: string
  groups: Group<unknown>[]
  firstColumn: string
  footnote?: string
}) {
  return (
    <Card title={title} desc={desc}>
      <HBars
        data={groups.map((g) => ({
          key: String(g.key),
          label: g.label,
          sub: `${g.stats.trades.toLocaleString('ja-JP')}回`,
          value: g.stats.pnl,
        }))}
      />
      <div style={{ margin: '16px 0 14px' }}>
        <PolarityLegend />
      </div>
      <StatsTable rows={groups} firstColumn={firstColumn} />
      {footnote && <Footnote>{footnote}</Footnote>}
    </Card>
  )
}

export function AnalysisView({ positions }: { positions: Position[] }) {
  const holding = useMemo(() => byHolding(positions), [positions])
  const side = useMemo(() => bySide(positions), [positions])
  const kind = useMemo(() => byKind(positions), [positions])
  const weekday = useMemo(() => byWeekday(positions), [positions])
  const account = useMemo(() => byAccount(positions), [positions])

  return (
    <div className="grid" style={{ gap: 14 }}>
      <Section
        title="保有期間別"
        desc="建玉から決済までの日数で分類"
        groups={holding}
        firstColumn="保有期間"
        footnote="建玉と決済は銘柄・方向・口座ごとにFIFO（先入先出）で突き合わせています。取込期間より前に建てた玉は「建玉日不明」に入ります。"
      />
      <Section
        title="方向別"
        desc="買いポジションと空売りの比較"
        groups={side}
        firstColumn="方向"
      />
      <Section title="商品区分別" desc="現物・信用・投資信託" groups={kind} firstColumn="区分" />
      <Section
        title="曜日別"
        desc="決済した曜日で分類"
        groups={weekday}
        firstColumn="曜日"
        footnote="決済日基準です。建玉を作った曜日ではありません。"
      />
      <Section title="口座別" desc="特定口座・NISAなど" groups={account} firstColumn="口座" />
    </div>
  )
}
