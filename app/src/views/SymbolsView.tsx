import { useMemo, useState } from 'react'
import { bySymbol, summarize, winRate } from '../lib/analytics'
import { percent, signedYen } from '../lib/format'
import type { Position } from '../lib/sbi/types'
import { HBars, PolarityLegend } from '../components/charts'
import { Card, Footnote, Segmented, StatsTable } from '../components/ui'

type Sort = 'pnl' | 'trades' | 'winRate'

const SORTS: { value: Sort; label: string }[] = [
  { value: 'pnl', label: '損益順' },
  { value: 'trades', label: '取引回数順' },
  { value: 'winRate', label: '勝率順' },
]

export function SymbolsView({ positions }: { positions: Position[] }) {
  const [sort, setSort] = useState<Sort>('pnl')
  const symbols = useMemo(() => bySymbol(positions), [positions])

  const sorted = useMemo(() => {
    const s = [...symbols]
    if (sort === 'trades') s.sort((a, b) => b.stats.trades - a.stats.trades)
    else if (sort === 'winRate') s.sort((a, b) => (winRate(b.stats) ?? 0) - (winRate(a.stats) ?? 0))
    else s.sort((a, b) => b.stats.pnl - a.stats.pnl)
    return s
  }, [symbols, sort])

  const best = symbols.slice(0, 8)
  const worst = symbols.slice(-8).reverse()
  const total = summarize(positions)

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="grid cols-2">
        <Card title="得意な銘柄" desc="実現損益の上位8銘柄">
          <HBars
            data={best.map((g) => ({
              key: g.key,
              label: g.name,
              sub: `${g.stats.trades}回 · 勝率${percent(winRate(g.stats), 0)}`,
              value: g.stats.pnl,
            }))}
          />
        </Card>
        <Card title="苦手な銘柄" desc="実現損益の下位8銘柄">
          <HBars
            data={worst.map((g) => ({
              key: g.key,
              label: g.name,
              sub: `${g.stats.trades}回 · 勝率${percent(winRate(g.stats), 0)}`,
              value: g.stats.pnl,
            }))}
          />
        </Card>
      </div>

      <Card
        title="銘柄別の成績"
        desc={`${symbols.length}銘柄 · 合計 ${signedYen(total.pnl)}`}
        aside={<Segmented options={SORTS} value={sort} onChange={setSort} />}
      >
        <div style={{ marginBottom: 14 }}>
          <PolarityLegend />
        </div>
        <StatsTable rows={sorted} firstColumn="銘柄" />
        <Footnote>
          PF はプロフィットファクター（総利益 ÷ 総損失）。損失が0の銘柄は「—」と表示されます。同じ銘柄の現物・信用・買い・空売りはすべて合算しています。
        </Footnote>
      </Card>
    </div>
  )
}
