import { useRef, useState } from 'react'
import {
  addImportLog,
  clearAll,
  downloadBackup,
  exportBackup,
  importBackup,
  saveExecutions,
  type ImportLog,
} from '../lib/db'
import { dedupeExecutions, mergeRealizedPnl, parseSbiFile } from '../lib/sbi/parse'
import type { Execution, RealizedRow } from '../lib/sbi/types'
import { Card, Footnote, Tile } from '../components/ui'
import { ImportGuide } from '../components/ImportGuide'
import { longDate } from '../lib/format'

const FORMAT_LABEL: Record<string, string> = {
  execution_history: '約定履歴照会',
  realized_pnl: '実現損益',
  unknown: '不明',
}

interface Report {
  ok: boolean
  lines: string[]
}

export function DataView({
  logs,
  executionCount,
  latestTradeDate,
  onChanged,
}: {
  logs: ImportLog[]
  executionCount: number
  /** 取り込み済みデータの中で最も新しい約定日 */
  latestTradeDate: string | null
  onChanged: () => void
}) {
  // 最新の約定日から何日経ったか。取り込みの目安にする
  const staleDays =
    latestTradeDate === null
      ? null
      : Math.floor((Date.now() - Date.parse(`${latestTradeDate}T00:00:00`)) / 86_400_000)
  const lastImport = logs[0]?.at ?? null
  const csvInput = useRef<HTMLInputElement>(null)
  const jsonInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<Report | null>(null)

  async function handleCsv(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    setReport(null)
    const lines: string[] = []
    try {
      // 1回の取り込みで複数ファイルを受け、実現損益は約定履歴にマージしてから保存する
      const executions: Execution[] = []
      const realized: RealizedRow[] = []
      const parsed: { name: string; format: string }[] = []

      for (const file of Array.from(files)) {
        const r = parseSbiFile(await file.arrayBuffer())
        parsed.push({ name: file.name, format: r.format })
        executions.push(...r.executions)
        realized.push(...r.realized)
        lines.push(
          `${file.name} … ${FORMAT_LABEL[r.format]} / 約定${r.executions.length}件 実現損益${r.realized.length}件`,
        )
        r.warnings.forEach((w) => lines.push(`  ⚠ ${w}`))
      }

      if (executions.length === 0 && realized.length === 0) {
        setReport({ ok: false, lines: [...lines, 'SBI証券のCSVとして読み取れる行がありませんでした。'] })
        return
      }

      // 期間の重なる約定履歴を同時に選んでも壊れないよう、マージ前に重複を潰す
      const unique = dedupeExecutions(executions)
      if (unique.length < executions.length) {
        lines.push(`選んだファイル間で重複していた約定 ${executions.length - unique.length}件をまとめました`)
      }
      executions.length = 0
      executions.push(...unique)

      const { merged, synthesized } = mergeRealizedPnl(executions, realized)
      if (merged > 0) lines.push(`実現損益を${merged}件の決済に突き合わせました`)
      if (synthesized.length > 0) lines.push(`約定履歴に無い決済を${synthesized.length}件補完しました`)

      const res = await saveExecutions(executions)
      lines.push(`保存：新規${res.added}件 / 既存と重複${res.duplicated}件`)
      if (res.preserved > 0) {
        lines.push(`  （うち${res.preserved}件は、既に取り込んである損益をそのまま残しました）`)
      }

      for (const p of parsed) {
        await addImportLog({
          at: new Date().toISOString(),
          fileName: p.name,
          format: FORMAT_LABEL[p.format] ?? p.format,
          added: res.added,
          duplicated: res.duplicated,
        })
      }
      setReport({ ok: true, lines })
      onChanged()
    } catch (e) {
      setReport({ ok: false, lines: [...lines, `エラー：${(e as Error).message}`] })
    } finally {
      setBusy(false)
      if (csvInput.current) csvInput.current.value = ''
    }
  }

  async function handleJson(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    try {
      const res = await importBackup(JSON.parse(await files[0].text()))
      setReport({ ok: true, lines: [`バックアップを読み込みました：新規${res.added}件 / 重複${res.duplicated}件`] })
      onChanged()
    } catch (e) {
      setReport({ ok: false, lines: [`エラー：${(e as Error).message}`] })
    } finally {
      setBusy(false)
      if (jsonInput.current) jsonInput.current.value = ''
    }
  }

  return (
    <div className="grid" style={{ gap: 14 }}>
      {executionCount > 0 && (
        <>
          <div className="grid cols-3">
            <Tile
              label="取り込み済みの最新約定日"
              value={latestTradeDate ? latestTradeDate.slice(5).replace('-', '/') : '—'}
              sub={latestTradeDate ? longDate(latestTradeDate) : undefined}
            />
            <Tile
              label="そこからの経過"
              value={staleDays === null ? '—' : `${staleDays}日`}
              tone={staleDays === null ? undefined : staleDays > 45 ? 'neg' : staleDays > 20 ? undefined : 'pos'}
              sub={staleDays !== null && staleDays > 45 ? '入れ直しどきです' : '月1回で十分です'}
            />
            <Tile
              label="最後に取り込んだ日時"
              value={lastImport ? new Date(lastImport).toLocaleDateString('ja-JP') : '—'}
              sub={lastImport ? new Date(lastImport).toLocaleTimeString('ja-JP') : undefined}
            />
          </div>

        </>
      )}

      <ImportGuide logs={logs} />

      <Card title="CSVを取り込む" desc="SBI証券からダウンロードしたCSVをそのまま読み込めます">
        <input
          ref={csvInput}
          type="file"
          accept=".csv,text/csv"
          multiple
          hidden
          onChange={(e) => handleCsv(e.target.files)}
        />
        <button className="btn primary" disabled={busy} onClick={() => csvInput.current?.click()}>
          {busy ? '読み込み中…' : 'CSVファイルを選ぶ'}
        </button>

        <p className="note" style={{ marginTop: 14, marginBottom: 0 }}>
          上の手順の2にあるCSVを、まとめて選んでください。同じファイルを二度読み込んでも重複はしません。
        </p>

        {report && (
          <pre
            style={{
              marginTop: 16,
              marginBottom: 0,
              padding: 14,
              background: 'var(--plane)',
              border: `1px solid ${report.ok ? 'var(--border)' : 'color-mix(in srgb, var(--neg) 40%, transparent)'}`,
              borderRadius: 10,
              fontSize: 12,
              lineHeight: 1.7,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              fontFamily: 'inherit',
              color: 'var(--ink-2)',
            }}
          >
            {report.lines.join('\n')}
          </pre>
        )}
      </Card>

      <div className="grid cols-2">
        <Card title="バックアップ" desc="取り込んだデータをファイルに書き出します">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" disabled={executionCount === 0} onClick={async () => downloadBackup(await exportBackup())}>
              書き出す（JSON）
            </button>
            <input ref={jsonInput} type="file" accept="application/json,.json" hidden onChange={(e) => handleJson(e.target.files)} />
            <button className="btn" onClick={() => jsonInput.current?.click()}>
              読み込む
            </button>
          </div>
          <Footnote>
            データはこの端末の中にのみ保存されています。アプリを削除すると消えるため、iCloud Driveなどに定期的に書き出しておくことを勧めます。
            別の端末でこのファイルを読み込めば、同じデータを見られます。
          </Footnote>
        </Card>

        <Card title="このアプリについて">
          <div className="note">
            <p style={{ marginTop: 0 }}>
              保存件数：<b style={{ color: 'var(--ink)' }}>{executionCount.toLocaleString('ja-JP')}</b> 件の約定
            </p>
            <p>
              CSVの解析も集計もすべてこの端末の中で行われ、取引データが外部へ送信されることは一切ありません。オフラインでも動作します。
            </p>
            <p style={{ marginBottom: 0 }}>
              表示している損益はすべて<b style={{ color: 'var(--ink)' }}>税引前</b>です。信用取引の金利・貸株料・手数料は差し引き済みです。
            </p>
          </div>
          <div style={{ marginTop: 16 }}>
            <button
              className="btn danger"
              disabled={executionCount === 0}
              onClick={async () => {
                if (!confirm('保存されている取引データをすべて削除します。よろしいですか？')) return
                await clearAll()
                setReport(null)
                onChanged()
              }}
            >
              データをすべて削除
            </button>
          </div>
        </Card>
      </div>

      {logs.length > 0 && (
        <Card title="取り込み履歴">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>ファイル</th>
                  <th>種類</th>
                </tr>
              </thead>
              <tbody>
                {logs.slice(0, 20).map((l, i) => (
                  <tr key={i}>
                    <td>{new Date(l.at).toLocaleString('ja-JP')}</td>
                    <td style={{ textAlign: 'right', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.fileName}</td>
                    <td>{l.format}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
