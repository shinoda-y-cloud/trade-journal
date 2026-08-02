/**
 * 分析画面。
 *
 * 8つの仮説を実データで検証したところ7つが棄却された。棄却の理由は毎回
 * 「外れ値1〜2件が結論を作っていた」「同一日の建玉を独立標本として数えていた」
 * 「純損益の割合と総損失の割合を取り違えていた」「非有意を効果なしと読み替えていた」
 * のいずれかだった。
 *
 * そのためこの画面は、傾向を提示する場所ではなく
 * **見つけたつもりになるのを防ぐ場所**として設計してある。
 *   - 検定を含まない確かな記述（集中度・スタイル変化）を先に置く
 *   - 検定はすべて日クラスタ補正のうえHolm補正し、既定の判定は「検出できず」
 *   - 差が出なかった軸も等しく列挙する（多重比較の分母を隠さない）
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  byAccount,
  byHolding,
  byKind,
  bySide,
  byWeekday,
  type Group,
} from '../lib/analytics'
import {
  AI_THEMES,
  concentration,
  describeConcentration,
  fmtP,
  GATE,
  regimeByMonth,
  themeOf,
  themeShares,
  type AxisResult,
  type InsightReport,
  type SizeAnalysis,
} from '../lib/insights'
import type { WorkerRequest, WorkerResponse } from '../lib/insights.worker'
import { compactYen, percent, signedYen, yen } from '../lib/format'
import type { Position } from '../lib/sbi/types'
import { HBars, Histogram, MagnitudeBars, PnlBars, PolarityLegend, Waterfall } from '../components/charts'
import { Card, Footnote, StatsTable } from '../components/ui'
import { TradeTable } from '../components/TradeTable'
import { EdgeSection } from './EdgeSection'

/* ------------------------------------------------------------------ */

/**
 * 検定をワーカーで走らせる。
 * 並べ替えとブートストラップで1秒前後かかるため、メインスレッドでは回さない。
 */
function useInsights(positions: Position[]): { report: InsightReport | null; size: SizeAnalysis | null; ms: number } {
  const [state, setState] = useState<{ report: InsightReport | null; size: SizeAnalysis | null; ms: number }>({
    report: null,
    size: null,
    ms: 0,
  })
  const workerRef = useRef<Worker | null>(null)
  const idRef = useRef(0)

  useEffect(() => {
    const w = new Worker(new URL('../lib/insights.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      // 期間を切り替えて古い結果が遅れて届いた場合は捨てる
      if (e.data.id !== idRef.current) return
      setState({ report: e.data.report, size: e.data.size, ms: e.data.ms })
    }
    workerRef.current = w
    return () => {
      w.terminate()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    const w = workerRef.current
    if (!w) return
    idRef.current += 1
    setState({ report: null, size: null, ms: 0 })
    w.postMessage({ id: idRef.current, positions } satisfies WorkerRequest)
  }, [positions])

  return state
}

/** 計算待ちの間に出す枠 */
function Computing({ label }: { label: string }) {
  return (
    <div style={{ padding: '38px 0', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 13 }}>
      {label}
    </div>
  )
}

const VERDICT_STYLE: Record<AxisResult['verdict'], { bg: string; fg: string }> = {
  差を検出: { bg: 'color-mix(in srgb, var(--pos) 18%, transparent)', fg: 'var(--pos)' },
  検出できず: { bg: 'color-mix(in srgb, var(--ink) 8%, transparent)', fg: 'var(--ink-2)' },
  n不足: { bg: 'color-mix(in srgb, var(--series-2) 18%, transparent)', fg: 'var(--series-2)' },
}

function Badge({ verdict }: { verdict: AxisResult['verdict'] }) {
  const s = VERDICT_STYLE[verdict]
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        background: s.bg,
        color: s.fg,
        whiteSpace: 'nowrap',
      }}
    >
      {verdict}
    </span>
  )
}

/** 検定を含まない、確かな事実をひとつ */
function Fact({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <span
        style={{
          flex: 'none',
          width: 26,
          height: 26,
          borderRadius: 8,
          background: 'var(--surface-raised)',
          border: '1px solid var(--border)',
          display: 'grid',
          placeItems: 'center',
          fontSize: 12,
          fontWeight: 650,
          color: 'var(--ink-2)',
        }}
      >
        {n}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.75, color: 'var(--ink-2)' }}>{children}</div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

export function AnalysisView({ positions }: { positions: Position[] }) {
  const conc = useMemo(() => concentration(positions), [positions])
  const regime = useMemo(() => regimeByMonth(positions), [positions])
  const themes = useMemo(() => themeShares(positions), [positions])
  const { report, size, ms } = useInsights(positions)

  const holding = useMemo(() => byHolding(positions), [positions])
  const side = useMemo(() => bySide(positions), [positions])
  const kind = useMemo(() => byKind(positions), [positions])
  const weekday = useMemo(() => byWeekday(positions), [positions])
  const account = useMemo(() => byAccount(positions), [positions])

  const ai = positions.filter((p) => AI_THEMES.includes(themeOf(p.code)))
  const recent = regime.slice(-3)
  const recentAiShare =
    recent.reduce((s, r) => s + r.n * r.aiShare, 0) / (recent.reduce((s, r) => s + r.n, 0) || 1)

  const worst5 = conc.worst.find((w) => w.n === 5)
  const first = regime[0]
  const last = regime[regime.length - 1]

  return (
    <div className="grid" style={{ gap: 14 }}>
      {/* ---------------------------------------------------------- */}
      <EdgeSection positions={positions} />

      {/* ---------------------------------------------------------- */}
      <Card title="この期間について確かに言えること" desc="検定を必要としない、数え上げるだけで確かめられる事実">
        <div style={{ display: 'grid', gap: 18 }}>
          <Fact n={1} title="損益の大半は、ごく少数の建玉で決まっている">
            {describeConcentration(conc)}
            {worst5 && (
              <>
                {' '}
                上位5件では {percent(worst5.shareOfNet, 1)}（損失そのものに対しては {percent(worst5.shareOfGrossLoss, 1)}）です。
              </>
            )}
          </Fact>

          {size && (
            <Fact n={2} title="建玉を大きくすると、勝率ではなく振れ幅が変わっていた">
              金額の五分位で見た勝率は{' '}
              {percent(Math.min(...size.quintiles.map((q) => q.winRate ?? 0)), 1)} 〜{' '}
              {percent(Math.max(...size.quintiles.map((q) => q.winRate ?? 0)), 1)} の範囲に散らばっており、金額の大小とは対応していません。
              一方、1回あたりの損益が1万円を超えた割合は
              {size.bands.map((b, i) => (
                <span key={b.label}>
                  {i > 0 && ' → '}
                  {b.label} {percent(b.bigMoveRate, 1)}
                </span>
              ))}
              と単調に増えています。標準偏差の比は Q5/Q1 で {size.sdRatio.toFixed(1)}倍（{size.sdTest.method} p={fmtP(size.sdTest.p)}）。
              振れた方向は勝ち{size.bigMoves.wins}件 {signedYen(size.bigMoves.winPnl)} / 負け{size.bigMoves.losses}件 {signedYen(size.bigMoves.lossPnl)} で、ほぼ半々でした。
            </Fact>
          )}

          {first && last && (
            <Fact n={3} title="期間の中で取引のやり方そのものが入れ替わっている">
              建玉金額の中央値は {compactYen(first.medianNotional ?? 0)} → {compactYen(last.medianNotional ?? 0)}、
              AI・半導体の比率は {percent(first.aiShare, 1)} → {percent(last.aiShare, 1)}、
              現物の比率は {percent(first.cashShare, 1)} → {percent(last.cashShare, 1)} と変わりました。
              全期間をひとまとめにした集計は、実質的に別々のやり方を平均したものになります。
            </Fact>
          )}
        </div>
      </Card>

      {/* ---------------------------------------------------------- */}
      <Card title="損益の集中度" desc="実現損益は、総利益と総損失の差し引き残り">
        <Waterfall grossProfit={conc.grossProfit} grossLoss={conc.grossLoss} />
        <div style={{ marginTop: 6 }}>
          <PolarityLegend />
        </div>

        <div className="table-wrap" style={{ marginTop: 20 }}>
          <table className="data">
            <thead>
              <tr>
                <th>損失の大きい順</th>
                <th>累計</th>
                <th>純損益比</th>
                <th>総損失比</th>
                <th>利益の大きい順</th>
                <th>累計</th>
                <th>総利益比</th>
              </tr>
            </thead>
            <tbody>
              {conc.worst.map((w, i) => (
                <tr key={w.n}>
                  <td>上位{w.n}件</td>
                  <td className="neg">{signedYen(w.sum)}</td>
                  <td>{percent(w.shareOfNet, 1)}</td>
                  <td>{percent(w.shareOfGrossLoss, 1)}</td>
                  <td>上位{conc.best[i].n}件</td>
                  <td className="pos">{signedYen(conc.best[i].sum)}</td>
                  <td>{percent(conc.best[i].shareOfGrossProfit, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Footnote>
          「純損益比」は差し引き後の {signedYen(conc.net)} に対する割合です。損失そのもの（{signedYen(conc.grossLoss)}）に対する割合は別列に出しています。
          上位10件の純損益比は100%を超えますが、これは「損失の100%超」という意味ではありません。純損益が総利益と総損失の小さな差分であるために起きる見え方です。
          この2つを取り違えると、実態より深刻な結論を作ってしまいます。
        </Footnote>

        <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--grid)' }}>
          <h3 style={{ fontSize: 13, marginBottom: 12 }}>損失の大きかった5件</h3>
          <TradeTable positions={conc.worstTrades} />
        </div>
        <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--grid)' }}>
          <h3 style={{ fontSize: 13, marginBottom: 12 }}>利益の大きかった5件</h3>
          <TradeTable positions={conc.bestTrades} />
        </div>
      </Card>

      {/* ---------------------------------------------------------- */}
      {size ? (
        <Card
          title="建玉金額と振れ幅"
          desc={`国内株${size.included.toLocaleString('ja-JP')}件が対象（投信・米国株${size.excluded}件は金額の単位が揃わないため除外）`}
        >
          <Histogram
            values={positions
              .filter((p) => p.assetClass === 'domestic_stock' && p.openPrice)
              .map((p) => p.openPrice * p.quantity)}
            markers={[{ value: size.median, label: '中央値' }]}
          />
          <p className="note" style={{ margin: '4px 0 22px' }}>
            中央値 {yen(size.median)}円 ／ 四分位 {yen(size.q1)}〜{yen(size.q3)}円 ／ 上位1割 {yen(size.p90)}円以上 ／ 最大 {yen(size.max)}円
          </p>

          <div className="grid cols-2">
            <div>
              <h3 style={{ fontSize: 13, marginBottom: 4 }}>1回あたりの期待値</h3>
              <p className="note" style={{ margin: '0 0 8px' }}>符号が揃っていません</p>
              <PnlBars
                height={230}
                data={size.quintiles.map((q) => ({ key: q.label, label: q.label, value: Math.round(q.expectancy) }))}
              />
              <PolarityLegend />
            </div>
            <div>
              <h3 style={{ fontSize: 13, marginBottom: 4 }}>1回あたり損益の標準偏差</h3>
              <p className="note" style={{ margin: '0 0 8px' }}>金額が大きいほど単調に増えています</p>
              <MagnitudeBars
                unit="円"
                data={size.quintiles.map((q) => ({
                  key: q.label,
                  label: `${q.label}（${compactYen(q.lo)}〜）`,
                  value: q.sd,
                  display: Math.round(q.sd).toLocaleString('ja-JP'),
                }))}
              />
            </div>
          </div>

          <div style={{ marginTop: 22 }}>
            <h3 style={{ fontSize: 13, marginBottom: 8 }}>損益が1万円を超えた割合</h3>
            <MagnitudeBars
              unit="%"
              data={size.bands.map((b) => ({
                key: b.label,
                label: `${b.label}（${b.n}件）`,
                value: b.bigMoveRate * 100,
                display: (b.bigMoveRate * 100).toFixed(1),
              }))}
            />
          </div>

          <div className="table-wrap" style={{ marginTop: 22 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>五分位</th>
                  <th>金額レンジ</th>
                  <th>件数</th>
                  <th>勝率</th>
                  <th>期待値</th>
                  <th>標準偏差</th>
                  <th>損益</th>
                </tr>
              </thead>
              <tbody>
                {size.quintiles.map((q) => (
                  <tr key={q.label}>
                    <td>{q.label}</td>
                    <td>{yen(q.lo)} 〜 {yen(q.hi)}</td>
                    <td>{q.n}</td>
                    <td>{percent(q.winRate, 1)}</td>
                    <td className={q.expectancy >= 0 ? 'pos' : 'neg'}>{signedYen(q.expectancy)}</td>
                    <td>{yen(q.sd)}</td>
                    <td className={q.pnl >= 0 ? 'pos' : 'neg'} style={{ fontWeight: 600 }}>{signedYen(q.pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Footnote>
            建玉金額の大小による勝率・損益率の差は、このデータでは検出できませんでした。差が無いことの証明ではありません。
            はっきり連動していたのは1回あたりの振れ幅だけです。
            <br />
            <br />
            建玉金額は期間を通じて拡大しており、同時に成績も変化しています。<b>金額と時期が交絡しているため、金額単独の効果はこのデータでは分離できません。</b>
            <br />
            Q1の勝率が低いのは金額のためではなく銘柄構成によるものです（Q1には特定の銘柄が集中しています）。
            <br />
            建玉金額は 数量 × 加重平均建単価 です。証拠金や口座残高に対する比率ではないため、「資金に対してどれだけ張ったか」は本データからは計算できません。
          </Footnote>
        </Card>
      ) : (
        <Card title="建玉金額と振れ幅">
          <Computing label="建玉金額の分布と振れ幅を計算しています…" />
        </Card>
      )}

      {/* ---------------------------------------------------------- */}
      <Card title="取引スタイルの変化" desc="月ごとの件数・成績と、その月の建玉金額・銘柄構成">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>月</th>
                <th>件数</th>
                <th>勝率</th>
                <th>損益</th>
                <th>建玉金額の中央値</th>
                <th>AI・半導体の比率</th>
                <th>現物の比率</th>
              </tr>
            </thead>
            <tbody>
              {regime.map((r) => (
                <tr key={r.month}>
                  <td>{r.month.replace('-', '年')}月</td>
                  <td>{r.n}</td>
                  <td>{percent(r.winRate, 1)}</td>
                  <td className={r.pnl >= 0 ? 'pos' : 'neg'} style={{ fontWeight: 600 }}>{signedYen(r.pnl)}</td>
                  <td>{r.medianNotional === null ? '—' : yen(r.medianNotional)}</td>
                  <td>{percent(r.aiShare, 1)}</td>
                  <td>{percent(r.cashShare, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Footnote>
          この表は、全期間をひとまとめにした集計をどこまで信じてよいかを判断するためのものです。
          建玉金額・銘柄構成・商品区分がこれだけ動いていると、13ヶ月の平均は「別々のやり方の平均」になります。
          期間を絞って見比べることをお勧めします（画面上部の期間切り替えが使えます）。
        </Footnote>
      </Card>

      {/* ---------------------------------------------------------- */}
      <Card title="「主力はAI・半導体銘柄」は正しいか" desc="銘柄をテーマで分類した構成比">
        <div className="note" style={{ marginBottom: 18, lineHeight: 1.8 }}>
          <b style={{ color: 'var(--ink)' }}>時期によって別のものです。</b>
          全期間の通算では、AI・データセンター関連と半導体・電子部品は {ai.length}件で全体の {percent(ai.length / (positions.length || 1), 1)}。
          最も多いのは {themes[0]?.theme}（{themes[0]?.n}件・{percent(themes[0]?.share ?? 0, 1)}）です。
          一方、直近3ヶ月に限れば AI・半導体は {percent(recentAiShare, 1)}、直近月は {percent(last?.aiShare ?? 0, 1)} を占めています。
          <br />
          <br />
          ただし「何%か」は物差しの選び方で動きます。取引回数では {percent(ai.length / (positions.length || 1), 1)} ですが、
          建玉金額のシェアで見ると
          {' '}{percent(themes.filter((t) => AI_THEMES.includes(t.theme)).reduce((s, t) => s + t.notionalShare, 0), 1)} です。
          分類そのものも判断を含みます（フジクラを電線メーカーとして非鉄に分類すれば比率は下がります）。
        </div>

        <HBars
          data={themes.map((t) => ({
            key: t.theme,
            label: t.theme,
            sub: `${t.n}件`,
            value: t.n,
          }))}
        />

        <Footnote>
          <b>テーマごとの成績の比較は出していません。</b>
          全体で見るとAI・半導体とそれ以外に勝率の差はありませんが、買いと空売りに分けると符号が逆になって打ち消し合っています（Simpsonのパラドックス）。
          さらに直近のAI建玉は実質3銘柄に集中しているため、テーマの効果と個別銘柄の効果を分離できません。
          この構成で成績を比べた表を出すと、確かめられていないことを確かめたように見せてしまいます。
        </Footnote>
      </Card>

      {/* ---------------------------------------------------------- */}
      <Card
        title="検定した軸の一覧"
        desc={report ? `この画面では ${report.familySize} 本の検定を回しています（計算 ${ms}ms）` : undefined}
      >
        {!report ? (
          <Computing label="日クラスタ補正つきの並べ替え検定とブートストラップを実行しています…" />
        ) : (
        <>
        <div className="note" style={{ marginBottom: 16, lineHeight: 1.8 }}>
          検定を多く回すほど、すべてが偶然でも「差がある」が混ざります。{report.familySize}本なら
          その確率は {percent(report.familyRisk, 1)} です。そのため判定にはHolm補正後のp値を使い、
          さらに<b>「各群{GATE.minGroupN}件以上」「補正後 p&lt;{GATE.maxAdjustedP}」「各群から上下1件ずつ除いても符号が保たれる」「前半と後半で符号が一致する」</b>
          の4つをすべて満たしたものだけを「差を検出」としています。
          <br />
          検定はすべて<b>決済日をクラスタとして扱い</b>ます。同じ日に同じ方向で複数建てれば勝敗は連動するため、
          建玉を独立標本として数えるとp値を大きく過小評価します（実測で p=0.007 が p=0.21 に変わった軸があります）。
        </div>

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>軸</th>
                <th>群A</th>
                <th>群B</th>
                <th>差</th>
                <th>95%区間</th>
                <th>p</th>
                <th>補正後p</th>
                <th>判定</th>
              </tr>
            </thead>
            <tbody>
              {[...report.axes]
                .sort((a, b) => a.adjP - b.adjP)
                .map((x) => (
                  <tr key={x.key}>
                    <td>
                      <span className="sym">
                        <b>{x.label}</b>
                        <span style={{ whiteSpace: 'normal' }}>{x.question}</span>
                      </span>
                    </td>
                    <td>
                      {percent(x.a.winRate, 1)}
                      <div style={{ fontSize: 10.5, color: 'var(--ink-muted)' }}>{x.a.label} n={x.a.n}</div>
                    </td>
                    <td>
                      {percent(x.b.winRate, 1)}
                      <div style={{ fontSize: 10.5, color: 'var(--ink-muted)' }}>{x.b.label} n={x.b.n}</div>
                    </td>
                    <td className={x.diff >= 0 ? 'pos' : 'neg'}>
                      {(x.diff * 100).toFixed(1)}pt
                    </td>
                    <td style={{ color: 'var(--ink-muted)' }}>
                      {Number.isFinite(x.lo) ? `${(x.lo * 100).toFixed(1)} 〜 ${(x.hi * 100).toFixed(1)}pt` : '—'}
                    </td>
                    <td>{fmtP(x.rawP)}</td>
                    <td style={{ fontWeight: 600 }}>{fmtP(x.adjP)}</td>
                    <td>
                      <Badge verdict={x.verdict} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 22, display: 'grid', gap: 14 }}>
          {[...report.axes]
            .sort((a, b) => a.adjP - b.adjP)
            .map((x) => (
              <div
                key={x.key}
                style={{
                  padding: 14,
                  borderRadius: 10,
                  background: 'var(--plane)',
                  border: '1px solid var(--border)',
                }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
                  <Badge verdict={x.verdict} />
                  <b style={{ fontSize: 13 }}>{x.label}</b>
                </div>
                <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.75, color: 'var(--ink-2)' }}>{x.sentence}</p>
                <p style={{ margin: '8px 0 0', fontSize: 11.5, lineHeight: 1.7, color: 'var(--ink-muted)' }}>{x.caveat}</p>
              </div>
            ))}
        </div>
        </>
        )}
      </Card>

      {/* ---------------------------------------------------------- */}
      <Section
        title="保有期間別"
        desc="建玉から決済までの日数で分類"
        groups={holding}
        firstColumn="保有期間"
        footnote="デイトレと持ち越しの合計損益の差は、上位数件の建玉に依存しています。上位5件を除くと持ち越しは黒字に転じ、中央値では持ち越しの方が上です。「持ち越すと負けた」ではなく「持ち越した数件で大きく振れた」が、このデータから言えることです。"
      />
      <Section title="方向別" desc="買いポジションと空売りの比較" groups={side} firstColumn="方向" />
      <Section title="商品区分別" desc="現物・信用・投資信託" groups={kind} firstColumn="区分" footnote="現物の取引は期間の前半に集中しており、区分と時期が交絡しています。" />
      <Section
        title="曜日別"
        desc="決済した曜日で分類"
        groups={weekday}
        firstColumn="曜日"
        footnote="決済日基準です。建玉を作った曜日ではありません。特定の曜日が最も悪いという形では安定しません — 日をクラスタとして再抽出すると、最下位になる曜日は入れ替わります。上の検定一覧をご覧ください。"
      />
      <Section title="口座別" desc="特定口座・NISAなど" groups={account} firstColumn="口座" />
    </div>
  )
}

/* ------------------------------------------------------------------ */

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
