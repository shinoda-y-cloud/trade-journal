/**
 * 「勝ち方の構造」。
 *
 * 勝率だけを見ても良し悪しは決まらない。損益がトントンになる勝率は
 * 損益比（RR）だけで決まるので、見るべきは
 *   エッジ ＝ 実際の勝率 − 損益分岐に必要な勝率
 * になる。この画面はエッジを軸に、どの切り口で勝てていて
 * どの切り口で負けているかを並べる。
 */
import { useMemo, useState } from 'react'
import { dimensions, edgeStat, type EdgeRow, type EdgeStat } from '../lib/edge'
import { themeOf } from '../lib/insights'
import { percent, ratio, sign, signedYen, yen } from '../lib/format'
import type { Position } from '../lib/sbi/types'
import { HBars, PolarityLegend } from '../components/charts'
import { Card, Footnote, Segmented, REFERENCE_N } from '../components/ui'

function num(n: number | null, digits = 2): string {
  return n === null || !Number.isFinite(n) ? '—' : n.toFixed(digits)
}

function pt(n: number | null): string {
  return n === null ? '—' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}pt`
}

/** 勝ち側と負け側の分布を左右に並べる */
function ShapeRow({ label, win, loss }: { label: string; win: string; loss: string }) {
  return (
    <tr>
      <td style={{ color: 'var(--ink-muted)' }}>{label}</td>
      <td className="pos" style={{ fontWeight: 600 }}>{win}</td>
      <td className="neg" style={{ fontWeight: 600 }}>{loss}</td>
    </tr>
  )
}

export function EdgeSection({ positions }: { positions: Position[] }) {
  const [dim, setDim] = useState('side-holding')
  const dims = useMemo(() => dimensions(themeOf), [])
  const overall = useMemo(() => edgeStat(positions), [positions])

  const active = dims.find((d) => d.key === dim) ?? dims[0]
  const rows = useMemo(
    () => active.split(positions).sort((a, b) => (b.stat.edge ?? -9) - (a.stat.edge ?? -9)),
    [active, positions],
  )

  // 今の勝率でトントンにするために必要なRR。
  // 期待値0の条件 W×平均利益 =(1−W)×平均損失 から RR = (1−W)/W
  const rrNeeded = overall.winRate ? (1 - overall.winRate) / overall.winRate : null
  // 最も損益を削っている行
  const worstRow = [...rows].sort((a, b) => a.stat.pnl - b.stat.pnl)[0]
  const bestRow = [...rows].filter((r) => r.stat.n >= REFERENCE_N).sort((a, b) => (b.stat.edge ?? -9) - (a.stat.edge ?? -9))[0]

  return (
    <>
      <Card title="勝ち方の構造" desc="勝率とRR（損益比）のどちらが効いているか">
        <div className="grid cols-3" style={{ gap: 14, marginBottom: 20 }}>
          <div className="tile">
            <div className="label">損益分岐に必要な勝率</div>
            <div className="value">{percent(overall.breakEven, 1)}</div>
            <div className="sub">RR {num(overall.rr)} から決まる</div>
          </div>
          <div className="tile">
            <div className="label">実際の勝率</div>
            <div className="value">{percent(overall.winRate, 1)}</div>
            <div className="sub">{overall.wins}勝 {overall.losses}敗</div>
          </div>
          <div className="tile">
            <div className="label">エッジ（実際 − 必要）</div>
            <div className={`value ${sign(overall.edge ?? 0)}`}>{pt(overall.edge)}</div>
            <div className="sub">1回あたり {signedYen(overall.expectancy)}</div>
          </div>
        </div>

        <div className="note" style={{ lineHeight: 1.85, marginBottom: 22 }}>
          損益がトントンになる勝率は、RR（平均利益 ÷ 平均損失）だけで決まります（
          <b style={{ color: 'var(--ink-2)' }}>必要勝率 = 1 ÷ (1 + RR)</b>）。
          いまの RR は <b style={{ color: 'var(--ink)' }}>{num(overall.rr)}</b> なので、
          利益を残すには <b style={{ color: 'var(--ink)' }}>{percent(overall.breakEven, 1)}</b> 勝つ必要があります。
          実際は {percent(overall.winRate, 1)} なので {pt(overall.edge)} 足りていません。
          <br />
          <br />
          <b style={{ color: 'var(--ink)' }}>
            つまり、勝率が足りないのではなく、RRが1を下回っているために必要な勝率が上がっています。
          </b>
          {rrNeeded && (
            <>
              {' '}
              いまの勝率 {percent(overall.winRate, 1)} を活かすなら、必要なRRは{' '}
              <b style={{ color: 'var(--ink)' }}>{num(rrNeeded)}</b> です（現在 {num(overall.rr)}）。
              逆にRRを1.5まで上げられれば、必要勝率は 40.0% まで下がります。
            </>
          )}
        </div>

        <h3 style={{ fontSize: 13, marginBottom: 10 }}>勝ちと負けの形</h3>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th></th>
                <th>勝ちトレード（{overall.wins}件）</th>
                <th>負けトレード（{overall.losses}件）</th>
              </tr>
            </thead>
            <tbody>
              <ShapeRow label="平均" win={yen(overall.avgWin)} loss={`-${yen(overall.avgLoss)}`} />
              <ShapeRow label="中央値" win={yen(overall.medWin)} loss={`-${yen(overall.medLoss)}`} />
              <ShapeRow label="最大" win={yen(overall.maxWin)} loss={`-${yen(overall.maxLoss)}`} />
            </tbody>
          </table>
        </div>
        <Footnote>
          中央値どうしを比べると {yen(overall.medWin)}円 と {yen(overall.medLoss)}円 で、
          普段の利確幅と損切り幅はほぼ揃っています（中央値ベースのRR {num(overall.rrMedian)}）。
          平均で差がつくのは、最大の負け {yen(overall.maxLoss)}円 が最大の勝ち {yen(overall.maxWin)}円 の
          {(overall.maxLoss / (overall.maxWin || 1)).toFixed(1)}倍あるためです。
          {overall.avgWin > 0 && (
            <>
              {' '}最大の負け1件は、平均的な勝ち {Math.round(overall.maxLoss / overall.avgWin)}回分に相当します。
            </>
          )}
        </Footnote>
      </Card>

      <Card
        title="どこにエッジがあるか"
        desc={active.desc}
        aside={
          <Segmented
            options={dims.map((d) => ({ value: d.key, label: d.label }))}
            value={dim}
            onChange={setDim}
          />
        }
      >
        {bestRow && worstRow && bestRow.key !== worstRow.key && (
          <div className="note" style={{ lineHeight: 1.85, marginBottom: 20 }}>
            この切り口で最もエッジが高いのは <b style={{ color: 'var(--pos)' }}>{bestRow.label}</b>（
            {bestRow.stat.n}件・エッジ {pt(bestRow.stat.edge)}・RR {num(bestRow.stat.rr)}）、
            最も損益を削っているのは <b style={{ color: 'var(--neg)' }}>{worstRow.label}</b>（
            {worstRow.stat.n}件・{signedYen(worstRow.stat.pnl)}・RR {num(worstRow.stat.rr)}）です。
            {overall.pnl < 0 && worstRow.stat.pnl < 0 && (
              <>
                {' '}
                全体の損益 {signedYen(overall.pnl)} に対し、この{worstRow.stat.n}件だけで{' '}
                <b style={{ color: 'var(--ink)' }}>{percent(worstRow.stat.pnl / overall.pnl, 0)}</b> を占めます。
              </>
            )}
          </div>
        )}

        <HBars
          data={rows.map((r) => ({
            key: r.key,
            label: r.label,
            sub: `${r.stat.n}回 · RR ${num(r.stat.rr)}${r.stat.n < REFERENCE_N ? ' · 参考' : ''}`,
            value: (r.stat.edge ?? 0) * 100,
          }))}
          format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}pt`}
        />
        <p className="note" style={{ margin: '10px 0 16px' }}>
          横軸はエッジ（実際の勝率 − 必要な勝率）です。正なら、その切り口の期待値はプラスでした。
        </p>
        <PolarityLegend />

        <div className="table-wrap" style={{ marginTop: 18 }}>
          <table className="data">
            <thead>
              <tr>
                <th>{active.label}</th>
                <th>件数</th>
                <th>勝率</th>
                <th>平均利益</th>
                <th>平均損失</th>
                <th>RR</th>
                <th>必要勝率</th>
                <th>エッジ</th>
                <th>期待値</th>
                <th>損益</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <EdgeTableRow key={r.key} row={r} />
              ))}
            </tbody>
          </table>
        </div>

        <Footnote>
          <b>RR</b> = 平均利益 ÷ 平均損失。<b>必要勝率</b> = 1 ÷ (1 + RR)。<b>エッジ</b> = 実際の勝率 − 必要勝率。
          エッジが正なら、その切り口の期待値はプラスでした。
          <br />
          「参考」は決済{REFERENCE_N}回未満の行です。数回の結果で大きく振れるため、確定的な数字としては読めません。
          <br />
          <br />
          これは<b>過去の記録の記述</b>であり、将来同じ結果になることを意味しません。
          また各行は他の要因と絡んでいます（たとえば持ち越した建玉は、そもそも思惑と逆に動いたから持ち越されている可能性があります）。
          エッジの差が「その選択が原因で生じた」ことの証明にはなりません。
        </Footnote>
      </Card>
    </>
  )
}

function EdgeTableRow({ row }: { row: EdgeRow }) {
  const s: EdgeStat = row.stat
  const thin = s.n < REFERENCE_N
  const muted = thin ? { color: 'var(--ink-muted)' } : undefined
  return (
    <tr>
      <td>
        {row.sub ? (
          <span className="sym">
            <b>{row.label}</b>
            <span>{row.sub}</span>
          </span>
        ) : (
          row.label
        )}
      </td>
      <td>{s.n.toLocaleString('ja-JP')}</td>
      <td style={muted}>
        {percent(s.winRate, 1)}
        {thin && <span style={{ fontSize: 10, marginLeft: 5 }}>参考</span>}
      </td>
      <td>{s.wins ? yen(s.avgWin) : '—'}</td>
      <td>{s.losses ? `-${yen(s.avgLoss)}` : '—'}</td>
      <td style={{ fontWeight: 600, ...(muted ?? {}) }}>{ratio(s.rr)}</td>
      <td style={muted}>{percent(s.breakEven, 1)}</td>
      <td className={sign(s.edge ?? 0)} style={{ fontWeight: 600 }}>
        {pt(s.edge)}
      </td>
      <td className={sign(s.expectancy)}>{signedYen(s.expectancy)}</td>
      <td className={sign(s.pnl)} style={{ fontWeight: 600 }}>
        {signedYen(s.pnl)}
      </td>
    </tr>
  )
}
