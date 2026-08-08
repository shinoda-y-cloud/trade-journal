/**
 * トレードプラン（事前記録）の画面。
 *
 * エントリー前に「方向・損切り価格・目標価格・持ち越す予定か」を書いておき、
 * 決済後にCSVと自動で突き合わせる。これで初めて
 *   ・計画したRR vs 実際のR倍数
 *   ・損切りを守れた率
 *   ・デイトレのつもりが持ち越した件数
 * が測れるようになる。CSVの結果だけからは、どれも取り出せない。
 */
import { useMemo, useState } from 'react'
import {
  INTENT_LABEL,
  discipline,
  matchPlans,
  newPlanId,
  planMath,
  type TradePlan,
} from '../lib/plans'
import { deletePlan, savePlan } from '../lib/db'
import { longDate, percent, ratio, sign, signedYen, yen } from '../lib/format'
import type { Position, Side, TradeKind } from '../lib/sbi/types'
import { Card, Footnote, Tile } from '../components/ui'
import { Histogram } from '../components/charts'

const todayIso = () => new Date().toISOString().slice(0, 10)

interface Draft {
  date: string
  code: string
  name: string
  side: Side
  kind: TradeKind
  entryPrice: string
  stopPrice: string
  targetPrice: string
  quantity: string
  intent: TradePlan['intent']
  memo: string
}

const emptyDraft = (): Draft => ({
  date: todayIso(),
  code: '',
  name: '',
  side: 'long',
  kind: 'margin',
  entryPrice: '',
  stopPrice: '',
  targetPrice: '',
  quantity: '',
  intent: 'day',
  memo: '',
})

function toPlan(d: Draft, id: string, createdAt: string): TradePlan | null {
  const entry = Number(d.entryPrice)
  const stop = Number(d.stopPrice)
  if (!d.code.trim() || !Number.isFinite(entry) || entry <= 0 || !Number.isFinite(stop) || stop <= 0) return null
  const target = d.targetPrice.trim() ? Number(d.targetPrice) : null
  const qty = d.quantity.trim() ? Number(d.quantity) : null
  return {
    id,
    createdAt,
    date: d.date,
    code: d.code.trim(),
    name: d.name.trim() || d.code.trim(),
    side: d.side,
    kind: d.kind,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target !== null && Number.isFinite(target) ? target : null,
    quantity: qty !== null && Number.isFinite(qty) ? qty : null,
    intent: d.intent,
    memo: d.memo.trim(),
    matchedPositionId: null,
    dismissed: false,
  }
}

/** R倍数の表示。-1Rを割ったものは強調する */
function RCell({ r }: { r: number | null }) {
  if (r === null) return <span style={{ color: 'var(--ink-muted)' }}>—</span>
  const broken = r < -1.1
  return (
    <span className={sign(r)} style={{ fontWeight: 600 }}>
      {r >= 0 ? '+' : ''}
      {r.toFixed(2)}R{broken && <span style={{ fontSize: 10, marginLeft: 4 }}>超過</span>}
    </span>
  )
}

export function PlanView({
  plans,
  positions,
  onChanged,
}: {
  plans: TradePlan[]
  positions: Position[]
  onChanged: () => void
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 既に取引したことのある銘柄から候補を作る
  const known = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of positions) m.set(p.code, p.name)
    return [...m].sort((a, b) => a[0].localeCompare(b[0]))
  }, [positions])

  const matches = useMemo(() => matchPlans(plans, positions), [plans, positions])
  const disc = useMemo(() => discipline(matches), [matches])

  // 入力中のプランを、そのまま計算にかける
  const preview = useMemo(() => {
    const p = toPlan(draft, 'preview', '')
    return p ? planMath(p) : null
  }, [draft])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))

  async function submit() {
    const plan = toPlan(draft, editing ?? newPlanId(), new Date().toISOString())
    if (!plan) {
      setError('銘柄コード・エントリー価格・損切り価格は必須です。')
      return
    }
    if (!planMath(plan).stopValid) {
      setError(
        plan.side === 'long'
          ? '買いの損切り価格は、エントリー価格より下に置いてください。'
          : '空売りの損切り価格は、エントリー価格より上に置いてください。',
      )
      return
    }
    setError(null)
    await savePlan(plan)
    setDraft(emptyDraft())
    setEditing(null)
    onChanged()
  }

  return (
    <div className="grid" style={{ gap: 14 }}>
      {/* -------------------------------------------------------- */}
      <Card title={editing ? 'プランを編集' : '新しいプランを記録'} desc="エントリーする前に書く。書いた内容は後でCSVと自動照合されます">
        <div className="form-grid">
          <label>
            <span>エントリー予定日</span>
            <input type="date" value={draft.date} onChange={(e) => set('date', e.target.value)} />
          </label>
          <label>
            <span>銘柄コード</span>
            <input
              value={draft.code}
              list="known-codes"
              placeholder="9984"
              inputMode="numeric"
              onChange={(e) => {
                const v = e.target.value
                set('code', v)
                const hit = known.find(([c]) => c === v.trim())
                if (hit) set('name', hit[1])
              }}
            />
            <datalist id="known-codes">
              {known.map(([c, n]) => (
                <option key={c} value={c}>
                  {n}
                </option>
              ))}
            </datalist>
          </label>
          <label>
            <span>銘柄名</span>
            <input value={draft.name} placeholder="ソフトバンクグループ" onChange={(e) => set('name', e.target.value)} />
          </label>

          <label>
            <span>方向</span>
            <select value={draft.side} onChange={(e) => set('side', e.target.value as Side)}>
              <option value="long">買い</option>
              <option value="short">空売り</option>
            </select>
          </label>
          <label>
            <span>区分</span>
            <select value={draft.kind} onChange={(e) => set('kind', e.target.value as TradeKind)}>
              <option value="margin">信用</option>
              <option value="cash">現物</option>
            </select>
          </label>
          <label>
            <span>持ち越す予定か</span>
            <select value={draft.intent} onChange={(e) => set('intent', e.target.value as TradePlan['intent'])}>
              <option value="day">デイトレ予定</option>
              <option value="swing">持ち越し予定</option>
            </select>
          </label>

          <label>
            <span>エントリー価格</span>
            <input value={draft.entryPrice} inputMode="decimal" placeholder="5000" onChange={(e) => set('entryPrice', e.target.value)} />
          </label>
          <label>
            <span>
              損切り価格 <b style={{ color: 'var(--neg)' }}>必須</b>
            </span>
            <input value={draft.stopPrice} inputMode="decimal" placeholder="4900" onChange={(e) => set('stopPrice', e.target.value)} />
          </label>
          <label>
            <span>目標価格（任意）</span>
            <input value={draft.targetPrice} inputMode="decimal" placeholder="5200" onChange={(e) => set('targetPrice', e.target.value)} />
          </label>
          <label>
            <span>数量（任意）</span>
            <input value={draft.quantity} inputMode="numeric" placeholder="100" onChange={(e) => set('quantity', e.target.value)} />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            <span>根拠メモ（任意）</span>
            <input value={draft.memo} placeholder="決算跨ぎを避ける / 出来高急増" onChange={(e) => set('memo', e.target.value)} />
          </label>
        </div>

        {preview && (
          <div
            style={{
              marginTop: 18,
              padding: '14px 16px',
              borderRadius: 12,
              background: 'var(--plane)',
              border: `1px solid ${preview.stopValid ? 'var(--border)' : 'color-mix(in srgb, var(--neg) 45%, transparent)'}`,
            }}
          >
            <div className="grid cols-3" style={{ gap: 14 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>1株あたりのリスク</div>
                <div style={{ fontSize: 17, fontWeight: 640 }}>
                  {preview.riskPerShare.toLocaleString('ja-JP', { maximumFractionDigits: 1 })}円
                </div>
                {preview.riskAmount !== null && (
                  <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>合計 {yen(preview.riskAmount)}円</div>
                )}
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>計画RR</div>
                <div style={{ fontSize: 17, fontWeight: 640 }}>{ratio(preview.plannedRR)}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                  {preview.plannedRR === null ? '目標価格を入れると出ます' : '目標 ÷ リスク'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>損益分岐に必要な勝率</div>
                <div style={{ fontSize: 17, fontWeight: 640 }}>{percent(preview.requiredWinRate, 1)}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>1 ÷ (1 + 計画RR)</div>
              </div>
            </div>
            {!preview.stopValid && (
              <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--neg)' }}>
                損切り価格の向きが逆です。
                {draft.side === 'long' ? '買いならエントリーより下' : '空売りならエントリーより上'}に置いてください。
              </p>
            )}
          </div>
        )}

        {error && <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--neg)' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={submit}>
            {editing ? '更新する' : '記録する'}
          </button>
          {editing && (
            <button
              className="btn"
              onClick={() => {
                setDraft(emptyDraft())
                setEditing(null)
                setError(null)
              }}
            >
              取り消す
            </button>
          )}
        </div>

        <Footnote>
          損切り価格を必ず書くのは、そこが決まらないと1トレードのリスク額が確定せず、
          <b>R倍数（実現損益 ÷ リスク額）</b>が計算できないためです。R倍数は建玉サイズが変わっても比較できるので、
          円建ての損益より素直に「守れたか」が見えます。
        </Footnote>
      </Card>

      {/* -------------------------------------------------------- */}
      {disc.matched > 0 && (
        <>
          <div className="grid cols-4">
            <Tile
              label="計画どおり決済できた率"
              value={percent(disc.matched === 0 ? null : (disc.matched - disc.stopBroken) / disc.matched, 0)}
              sub={`損切り超過 ${disc.stopBroken}件 / ${disc.matched}件`}
              tone={disc.stopBroken === 0 ? 'pos' : disc.stopBroken / disc.matched > 0.2 ? 'neg' : undefined}
            />
            <Tile
              label="計画RR（平均）"
              value={ratio(disc.avgPlannedRR)}
              sub={`必要勝率 ${percent(disc.avgPlannedRR === null ? null : 1 / (1 + disc.avgPlannedRR), 1)}`}
            />
            <Tile
              label="実現RR（平均）"
              value={ratio(disc.realizedRR)}
              sub={`勝ち ${ratio(disc.avgWinR)}R / 負け ${ratio(disc.avgLossR)}R`}
            />
            <Tile
              label="予定外の持ち越し"
              value={`${disc.unplannedOvernight}件`}
              tone={disc.unplannedOvernight === 0 ? 'pos' : 'neg'}
              sub={disc.unplannedOvernight === 0 ? 'デイトレ予定は全て当日決済' : signedYen(disc.unplannedOvernightPnl)}
            />
          </div>

          {disc.rValues.length >= 8 && (
            <Card title="R倍数の分布" desc="1トレードの結果を、計画したリスクの何倍だったかで見る">
              <Histogram
                values={disc.rValues}
                bins={Math.min(24, Math.max(8, Math.ceil(disc.rValues.length / 3)))}
                format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}R`}
                markers={[{ value: -1, label: '-1R（損切り）' }]}
              />
              <Footnote>
                −1Rより左にある山は、決めた損切りを超えて損失を出したトレードです。ここが薄いほど計画どおり執行できています。
                右の裾が伸びているほど、リスクに対して大きく取れています。
              </Footnote>
            </Card>
          )}
        </>
      )}

      {/* -------------------------------------------------------- */}
      <Card
        title="記録したプラン"
        desc={
          plans.length === 0
            ? 'まだありません'
            : `${plans.length}件（照合済み ${disc.matched}件 / 待ち ${disc.pending}件）`
        }
      >
        {plans.length === 0 ? (
          <div className="note" style={{ lineHeight: 1.8 }}>
            エントリーする前に上のフォームで記録してください。決済してCSVを取り込むと、
            銘柄コードと方向が一致する建玉に自動で紐づき、計画と結果の差が出ます。
            <br />
            <br />
            いまのCSVからは「106件の買いを持ち越した」ことは分かりますが、
            <b>持ち越すつもりだったのか、切れずに持ち越したのか</b>は分かりません。
            その区別こそが、対処の分かれ目になります。
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>予定日</th>
                  <th>銘柄</th>
                  <th>方向</th>
                  <th>エントリー</th>
                  <th>損切り</th>
                  <th>目標</th>
                  <th>計画RR</th>
                  <th>予定</th>
                  <th>結果</th>
                  <th>R倍数</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {matches.map((m) => {
                  const math = planMath(m.plan, m.position?.quantity)
                  const r =
                    m.position && math.riskAmount && math.riskAmount > 0
                      ? m.position.realizedPnl / math.riskAmount
                      : null
                  const unplanned = m.position && m.plan.intent === 'day' && m.position.holdingDays !== 0
                  return (
                    <tr key={m.plan.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{m.plan.date.slice(5).replace('-', '/')}</td>
                      <td>
                        <span className="sym">
                          <b>{m.plan.name}</b>
                          <span>{m.plan.code}</span>
                        </span>
                      </td>
                      <td className={m.plan.side === 'long' ? 'pos' : 'neg'} style={{ fontWeight: 600 }}>
                        {m.plan.side === 'long' ? '買い' : '空売り'}
                      </td>
                      <td>{m.plan.entryPrice.toLocaleString('ja-JP')}</td>
                      <td>{m.plan.stopPrice.toLocaleString('ja-JP')}</td>
                      <td>{m.plan.targetPrice?.toLocaleString('ja-JP') ?? '—'}</td>
                      <td>{ratio(math.plannedRR)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {INTENT_LABEL[m.plan.intent]}
                        {unplanned && (
                          <div style={{ fontSize: 10, color: 'var(--neg)' }}>
                            実際は{m.position!.holdingDays}日持ち越し
                          </div>
                        )}
                      </td>
                      <td>
                        {m.position ? (
                          <span className={sign(m.position.realizedPnl)} style={{ fontWeight: 600 }}>
                            {signedYen(m.position.realizedPnl)}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--ink-muted)' }}>照合待ち</span>
                        )}
                      </td>
                      <td>
                        <RCell r={r} />
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button
                          className="btn"
                          style={{ padding: '4px 9px', fontSize: 11 }}
                          onClick={() => {
                            setEditing(m.plan.id)
                            setDraft({
                              date: m.plan.date,
                              code: m.plan.code,
                              name: m.plan.name,
                              side: m.plan.side,
                              kind: m.plan.kind,
                              entryPrice: String(m.plan.entryPrice),
                              stopPrice: String(m.plan.stopPrice),
                              targetPrice: m.plan.targetPrice === null ? '' : String(m.plan.targetPrice),
                              quantity: m.plan.quantity === null ? '' : String(m.plan.quantity),
                              intent: m.plan.intent,
                              memo: m.plan.memo,
                            })
                            window.scrollTo({ top: 0, behavior: 'smooth' })
                          }}
                        >
                          編集
                        </button>{' '}
                        <button
                          className="btn danger"
                          style={{ padding: '4px 9px', fontSize: 11 }}
                          onClick={async () => {
                            if (!confirm(`${longDate(m.plan.date)} ${m.plan.name} のプランを削除します。`)) return
                            await deletePlan(m.plan.id)
                            onChanged()
                          }}
                        >
                          削除
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {plans.length > 0 && (
          <Footnote>
            照合は、銘柄コードと方向が一致し、建玉日が予定日から7日以内の建玉を、日付の近い順に1件ずつ割り当てています。
            同じ銘柄を同じ日に複数回建てた場合、どれが対応するかは特定できないため、記録した順に割り当てます。
            <br />
            <b>R倍数</b> = 実現損益 ÷（|エントリー価格 − 損切り価格| × 数量）。
            −1Rより悪い決済には「超過」と付きます。決めた損切りを超えて損失を出した、という意味です。
          </Footnote>
        )}
      </Card>
    </div>
  )
}
