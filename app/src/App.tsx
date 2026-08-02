import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { buildPositions } from './lib/sbi/positions'
import { loadExecutions, loadImportLogs, type ImportLog } from './lib/db'
import type { Execution } from './lib/sbi/types'
import { dataRange, filterByRange, type DateRange } from './lib/analytics'
import { Dashboard } from './views/Dashboard'
import { SymbolsView } from './views/SymbolsView'
import { AnalysisView } from './views/AnalysisView'
import { DataView } from './views/DataView'
import { PnlCalendar } from './components/PnlCalendar'
import { Card, Segmented } from './components/ui'

type Tab = 'dashboard' | 'calendar' | 'symbols' | 'analysis' | 'data'

interface TabMeta {
  id: Tab
  label: string
  desc: string
  icon: ReactElement
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const TABS: TabMeta[] = [
  {
    id: 'dashboard',
    label: 'サマリー',
    desc: '全期間の成績と累積損益の推移',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" {...stroke}>
        <path d="M3 17l6-6 4 4 8-8" />
        <path d="M16 7h5v5" />
      </svg>
    ),
  },
  {
    id: 'calendar',
    label: 'カレンダー',
    desc: '日ごとの損益。色が濃いほど金額が大きい',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" {...stroke}>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    ),
  },
  {
    id: 'symbols',
    label: '銘柄',
    desc: '得意な銘柄と苦手な銘柄',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" {...stroke}>
        <path d="M4 20v-8M10 20V4M16 20v-6M22 20H2" />
      </svg>
    ),
  },
  {
    id: 'analysis',
    label: '分析',
    desc: 'RRとエッジで、どこで勝ててどこで負けているかを見る',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" {...stroke}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 6v6l4 3" />
      </svg>
    ),
  },
  {
    id: 'data',
    label: 'データ',
    desc: 'CSVの取り込みとバックアップ',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" {...stroke}>
        <path d="M12 3v12M8 11l4 4 4-4" />
        <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
      </svg>
    ),
  },
]

/** 期間の絞り込み。データの末尾から遡る */
type RangeKey = 'all' | '1m' | '3m' | '6m' | '1y'

const RANGES: { value: RangeKey; label: string }[] = [
  { value: 'all', label: '全期間' },
  { value: '1y', label: '1年' },
  { value: '6m', label: '6ヶ月' },
  { value: '3m', label: '3ヶ月' },
  { value: '1m', label: '1ヶ月' },
]

function resolveRange(key: RangeKey, full: DateRange): DateRange {
  if (key === 'all' || !full.to) return full
  const months = { '1m': 1, '3m': 3, '6m': 6, '1y': 12 }[key]
  const to = new Date(`${full.to}T00:00:00Z`)
  to.setUTCMonth(to.getUTCMonth() - months)
  return { from: to.toISOString().slice(0, 10), to: full.to }
}

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [executions, setExecutions] = useState<Execution[] | null>(null)
  const [logs, setLogs] = useState<ImportLog[]>([])
  const [rangeKey, setRangeKey] = useState<RangeKey>('all')

  const reload = useCallback(async () => {
    const [ex, lg] = await Promise.all([loadExecutions(), loadImportLogs()])
    setExecutions(ex)
    setLogs(lg)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const allPositions = useMemo(
    () => (executions ? buildPositions(executions).positions : []),
    [executions],
  )
  const full = useMemo(() => dataRange(allPositions), [allPositions])
  const positions = useMemo(
    () => filterByRange(allPositions, resolveRange(rangeKey, full)),
    [allPositions, rangeKey, full],
  )

  // 損益不明の建玉。約定履歴CSVだけを取り込むと現物・投信がここに落ちる
  const unknownPnl = useMemo(() => allPositions.filter((p) => !p.pnlKnown), [allPositions])

  const hasData = allPositions.length > 0
  // データが無いうちは取り込み画面に固定する
  const active: Tab = executions !== null && !hasData ? 'data' : tab
  const meta = TABS.find((t) => t.id === active)!
  const showRange = hasData && active !== 'data' && active !== 'calendar'

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          <b>Trade Journal</b>
          <span>SBI証券 収支分析</span>
        </div>
        {TABS.map((t) => (
          <button key={t.id} className="navlink" aria-current={active === t.id} onClick={() => setTab(t.id)}>
            {t.icon}
            {t.label}
          </button>
        ))}
        <p className="note" style={{ marginTop: 'auto', padding: '0 12px', fontSize: 11 }}>
          データはこの端末内にのみ保存されます
        </p>
      </nav>

      <main className="main">
        <div className="page-head">
          <div>
            <h1>{meta.label}</h1>
            <p>{meta.desc}</p>
          </div>
          {showRange && <Segmented options={RANGES} value={rangeKey} onChange={setRangeKey} />}
        </div>

        {unknownPnl.length > 0 && active !== 'data' && (
          <div
            style={{
              padding: '13px 16px',
              marginBottom: 14,
              borderRadius: 12,
              background: 'color-mix(in srgb, var(--series-2) 12%, var(--surface))',
              border: '1px solid color-mix(in srgb, var(--series-2) 45%, transparent)',
              fontSize: 12.5,
              lineHeight: 1.75,
            }}
          >
            <b>損益が0のまま集計されている決済が {unknownPnl.length} 件あります。</b>
            <br />
            「約定履歴照会」のCSVには現物・投資信託・米国株の損益が入っていません。
            <b>実現損益（譲渡益税明細）のCSVも一緒に取り込んでください。</b>
            取り込むまで、合計損益・勝率・RRはいずれも正しくありません。
          </div>
        )}

        {executions === null ? (
          <div className="empty">読み込み中…</div>
        ) : active === 'data' ? (
          <>
            {!hasData && (
              <div className="empty" style={{ padding: '12px 20px 34px' }}>
                <h2>まだデータがありません</h2>
                <p>
                  SBI証券からダウンロードした<b>約定履歴照会</b>のCSVを取り込むと、
                  日次・銘柄別・保有期間別など、さまざまな切り口の集計が表示されます。
                </p>
              </div>
            )}
            <DataView logs={logs} executionCount={executions.length} onChanged={reload} />
          </>
        ) : active === 'dashboard' ? (
          <Dashboard positions={positions} />
        ) : active === 'calendar' ? (
          <Card>
            <PnlCalendar positions={allPositions} />
          </Card>
        ) : active === 'symbols' ? (
          <SymbolsView positions={positions} />
        ) : (
          <AnalysisView positions={positions} />
        )}
      </main>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} aria-current={active === t.id} onClick={() => setTab(t.id)}>
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
