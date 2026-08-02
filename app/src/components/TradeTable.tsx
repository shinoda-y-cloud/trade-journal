/**
 * 建玉1件ずつの明細表。
 * カレンダーの日別ドリルダウンなど、「実際に何をしたのか」を見せる場所で使う。
 */
import { HOLDING_BUCKET_LABEL, holdingBucket } from '../lib/sbi/positions'
import type { Position } from '../lib/sbi/types'
import { sign, signedYen, yen } from '../lib/format'

/** 建玉の値幅（%）。空売りは符号を反転する。建単価が不明なら null */
export function priceMove(p: Position): number | null {
  if (!p.openPrice || !p.closePrice) return null
  const raw = (p.closePrice - p.openPrice) / p.openPrice
  return p.side === 'short' ? -raw : raw
}

/** 建玉の投下金額 */
export function notional(p: Position): number {
  return p.openPrice ? p.openPrice * p.quantity : p.closePrice * p.quantity
}

const SIDE_LABEL: Record<Position['side'], string> = { long: '買い', short: '空売り' }
const KIND_LABEL: Record<Position['kind'], string> = { cash: '現物', margin: '信用', fund: '投信' }

/** 決済の結果ラベル。利確／損切りは損益の符号で判定する */
function outcome(p: Position): { label: string; tone: 'pos' | 'neg' | 'zero' } {
  if (p.realizedPnl > 0) return { label: '利確', tone: 'pos' }
  if (p.realizedPnl < 0) return { label: '損切り', tone: 'neg' }
  return { label: '同値', tone: 'zero' }
}

function holdingLabel(p: Position): string {
  if (p.holdingDays === null) return '不明'
  if (p.holdingDays === 0) return 'デイトレ'
  return `${p.holdingDays}日`
}

/** 価格の表示。小数のある建玉（信用の平均建単価など）は小数第1位まで */
function price(n: number): string {
  if (!n) return '—'
  return Number.isInteger(n) ? n.toLocaleString('ja-JP') : n.toLocaleString('ja-JP', { maximumFractionDigits: 1 })
}

export function TradeTable({ positions }: { positions: Position[] }) {
  const rows = [...positions].sort((a, b) => b.realizedPnl - a.realizedPnl)

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>銘柄</th>
            <th>方向</th>
            <th>数量</th>
            <th>建単価</th>
            <th>決済単価</th>
            <th>値幅</th>
            <th>保有</th>
            <th>手数料</th>
            <th>結果</th>
            <th>損益</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const mv = priceMove(p)
            const oc = outcome(p)
            return (
              <tr key={p.id}>
                <td>
                  <span className="sym">
                    <b>{p.name}</b>
                    <span>
                      {p.code}
                      {p.kind !== 'cash' && ` · ${KIND_LABEL[p.kind]}`}
                    </span>
                  </span>
                </td>
                <td>
                  <span className={p.side === 'long' ? 'pos' : 'neg'} style={{ fontWeight: 600 }}>
                    {SIDE_LABEL[p.side]}
                  </span>
                </td>
                <td>{p.quantity.toLocaleString('ja-JP')}</td>
                <td>{price(p.openPrice)}</td>
                <td>{price(p.closePrice)}</td>
                <td className={mv === null ? 'zero' : sign(mv)}>
                  {mv === null ? '—' : `${mv > 0 ? '+' : ''}${(mv * 100).toFixed(2)}%`}
                </td>
                <td>{holdingLabel(p)}</td>
                <td style={{ color: 'var(--ink-muted)' }}>{p.fee ? yen(p.fee) : '—'}</td>
                <td className={oc.tone} style={{ fontWeight: 600 }}>
                  {oc.label}
                </td>
                <td className={sign(p.realizedPnl)} style={{ fontWeight: 600 }}>
                  {signedYen(p.realizedPnl)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** 明細の上に置く、その日（またはその集合）の要約 */
export function TradeSummary({ positions }: { positions: Position[] }) {
  if (positions.length === 0) return null

  const pnl = positions.reduce((s, p) => s + p.realizedPnl, 0)
  const wins = positions.filter((p) => p.realizedPnl > 0)
  const losses = positions.filter((p) => p.realizedPnl < 0)
  const best = positions.reduce((a, b) => (b.realizedPnl > a.realizedPnl ? b : a))
  const worst = positions.reduce((a, b) => (b.realizedPnl < a.realizedPnl ? b : a))
  const longs = positions.filter((p) => p.side === 'long')
  const shorts = positions.filter((p) => p.side === 'short')
  const codes = new Set(positions.map((p) => p.code))

  const cell = (label: string, value: string, tone?: string, sub?: string) => (
    <div>
      <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 3 }}>{label}</div>
      <div className={tone} style={{ fontSize: 14.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: 'var(--ink-muted)', marginTop: 1 }}>{sub}</div>}
    </div>
  )

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: 16,
        padding: '14px 0 18px',
      }}
    >
      {cell('合計損益', signedYen(pnl), sign(pnl), `${positions.length}回 · ${codes.size}銘柄`)}
      {cell('勝敗', `${wins.length}勝 ${losses.length}敗`, undefined, wins.length + losses.length > 0 ? `勝率 ${Math.round((wins.length / (wins.length + losses.length)) * 100)}%` : undefined)}
      {cell('買い / 空売り', `${longs.length} / ${shorts.length}`, undefined, `${signedYen(longs.reduce((s, p) => s + p.realizedPnl, 0))} / ${signedYen(shorts.reduce((s, p) => s + p.realizedPnl, 0))}`)}
      {cell('最大の利益', signedYen(best.realizedPnl), 'pos', best.name)}
      {cell('最大の損失', signedYen(worst.realizedPnl), 'neg', worst.name)}
      {cell('保有', HOLDING_BUCKET_LABEL[holdingBucket(medianHolding(positions))], undefined, '中央値')}
    </div>
  )
}

function medianHolding(positions: Position[]): number | null {
  const days = positions.map((p) => p.holdingDays).filter((d): d is number => d !== null).sort((a, b) => a - b)
  if (days.length === 0) return null
  return days[Math.floor(days.length / 2)]
}
