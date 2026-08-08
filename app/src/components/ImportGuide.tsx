/**
 * 取り込み手順。
 *
 * 「どこから何を落として、どこに置くんだったか」を毎回忘れる、という問題への対処。
 *
 * このアプリが確実に知っているのはファイル名のパターンと中身の形式だけなので、
 * それを軸にしたチェックリストにしてある。SBIサイトのメニュー位置と保存先フォルダは
 * 本人しか知らないため、一度書けば残るメモ欄を用意している（この端末にのみ保存）。
 *
 * 各ファイル種別の「最後に取り込んだ日」は取り込み履歴から実際に出しているので、
 * 何が足りていないかが状態として見える。
 */
import { useState } from 'react'
import type { ImportLog } from '../lib/db'
import { Card, Footnote } from './ui'

const KEY = {
  url: 'trade-journal.sbi-url',
  menu: 'trade-journal.menu-note',
  folder: 'trade-journal.folder-note',
} as const

/**
 * 落とすべきCSVの種類。判別はファイル名の接頭辞で行う。
 *
 * SBIのメニュー名は、実際のCSVの中身から特定したもの。
 * ・SaveFile_ は2行目に「約定履歴照会」と書かれている → 取引履歴
 * ・DOMESTIC_STOCK_ はヘッダーに 種類=現物 の行を持つ。決済明細は信用取引の
 *   決済を出す画面なので現物は現れない → 譲渡損益
 */
const FILE_KINDS = [
  {
    key: 'SaveFile_',
    menu: '取引履歴',
    label: '約定履歴照会',
    required: true,
    what: '全取引（新規建て・返済の両方）が入った主データ',
    why: 'これが無いと保有期間もエントリー価格も分かりません',
    file: 'SaveFile_000001_003081.csv のような名前',
  },
  {
    key: 'DOMESTIC_STOCK_',
    menu: '譲渡損益',
    label: '国内株式',
    required: true,
    what: '現物取引の損益',
    why: '約定履歴には現物の損益が入っていないため、これが無いと損益が0で集計されます。「現物」と「信用」でフィルタが分かれている場合、必要なのは現物の方です（信用は取引履歴と重複しますが、入れても害はありません）',
    file: 'DOMESTIC_STOCK_20260802023656.csv のような名前',
  },
  {
    key: 'FOREIGN_STOCK_',
    menu: '譲渡損益',
    label: '米国株式',
    required: false,
    what: '米国株の損益',
    why: '米国株は約定履歴に一切現れないため、これが唯一のデータ源です',
    file: 'FOREIGN_STOCK_20260802023740.csv のような名前',
  },
  {
    key: 'FUND_',
    menu: '譲渡損益',
    label: '投資信託',
    required: false,
    what: '投資信託の損益',
    why: '投信をやっていなければ不要です',
    file: 'FUND_20260802023729.csv のような名前',
  },
] as const

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <span
        style={{
          flex: 'none',
          width: 24,
          height: 24,
          borderRadius: 999,
          background: 'var(--ink)',
          color: 'var(--plane)',
          display: 'grid',
          placeItems: 'center',
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {n}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.8, color: 'var(--ink-2)' }}>{children}</div>
      </div>
    </div>
  )
}

/** 一度書いたら残るメモ欄 */
function Note({
  storageKey,
  label,
  placeholder,
}: {
  storageKey: string
  label: string
  placeholder: string
}) {
  const [value, setValue] = useState(() => localStorage.getItem(storageKey) ?? '')
  const [saved, setSaved] = useState(true)
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginBottom: 5 }}>{label}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          className="url-input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            setValue(e.target.value)
            setSaved(false)
          }}
          onBlur={() => {
            localStorage.setItem(storageKey, value)
            setSaved(true)
          }}
        />
        <button
          className="btn"
          onClick={() => {
            localStorage.setItem(storageKey, value)
            setSaved(true)
          }}
        >
          {saved ? '保存済み' : '保存'}
        </button>
      </div>
    </div>
  )
}

export function ImportGuide({ logs }: { logs: ImportLog[] }) {
  const [url, setUrl] = useState(() => localStorage.getItem(KEY.url) ?? '')
  const [editingUrl, setEditingUrl] = useState(false)

  /** 種類ごとに、最後に取り込んだ日時を履歴から探す */
  const lastOf = (prefix: string): string | null => {
    const hit = logs.find((l) => l.fileName.startsWith(prefix))
    return hit ? hit.at : null
  }

  return (
    <Card title="取り込み手順" desc="忘れてもここを見れば分かるようにしてあります">
      <div style={{ display: 'grid', gap: 22 }}>
        <Step n={1} title="SBI証券のダウンロード画面を開く">
          {url && !editingUrl ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <a className="btn primary" href={url} target="_blank" rel="noreferrer noopener">
                SBIを開く
              </a>
              <button className="btn" style={{ padding: '7px 12px', fontSize: 12 }} onClick={() => setEditingUrl(true)}>
                URLを変更
              </button>
            </div>
          ) : (
            <>
              ブラウザでSBIのダウンロード画面まで進み、そのURLをここに貼っておくと、次回から1タップで開けます。
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <input
                  className="url-input"
                  value={url}
                  placeholder="https://site1.sbisec.co.jp/... "
                  onChange={(e) => setUrl(e.target.value)}
                />
                <button
                  className="btn"
                  onClick={() => {
                    localStorage.setItem(KEY.url, url.trim())
                    setEditingUrl(false)
                  }}
                >
                  保存
                </button>
              </div>
            </>
          )}
          <Note
            storageKey={KEY.menu}
            label="メニューの場所（自分用メモ）"
            placeholder="例：口座管理 → 取引履歴／実現損益 …次回のために書いておく"
          />
        </Step>

        <Step n={2} title="Myメニューの「損益/履歴」から落とす（期間は毎回「全期間」でOK）">
          使うのは <b style={{ color: 'var(--ink)' }}>取引履歴</b> と <b style={{ color: 'var(--ink)' }}>譲渡損益</b> の2つです。
          <b>決済明細は不要</b>です（信用の決済損益は取引履歴の方に入っており、実データで1円まで一致することを確認済み）。
          <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
            {FILE_KINDS.map((k) => {
              const last = lastOf(k.key)
              return (
                <div
                  key={k.key}
                  style={{
                    padding: '11px 13px',
                    borderRadius: 10,
                    background: 'var(--plane)',
                    border: `1px solid ${last ? 'var(--border)' : k.required ? 'color-mix(in srgb, var(--series-2) 45%, transparent)' : 'var(--border)'}`,
                  }}
                >
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span
                      style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        borderRadius: 6,
                        background: 'var(--surface-raised)',
                        border: '1px solid var(--border-strong)',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {k.menu}
                    </span>
                    <b style={{ fontSize: 13, color: 'var(--ink)' }}>{k.label}</b>
                    <span
                      style={{
                        fontSize: 10.5,
                        padding: '1px 7px',
                        borderRadius: 999,
                        background: k.required
                          ? 'color-mix(in srgb, var(--neg) 16%, transparent)'
                          : 'color-mix(in srgb, var(--ink) 8%, transparent)',
                        color: k.required ? 'var(--neg)' : 'var(--ink-muted)',
                        fontWeight: 600,
                      }}
                    >
                      {k.required ? '必須' : '該当すれば'}
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: last ? 'var(--ink-muted)' : 'var(--series-2)' }}>
                      {last ? `最終取込 ${new Date(last).toLocaleDateString('ja-JP')}` : 'まだ取り込んでいません'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 4 }}>{k.what}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 3 }}>{k.why}</div>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--ink-muted)',
                      marginTop: 5,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    }}
                  >
                    {k.file}
                  </div>
                </div>
              )
            })}
          </div>
        </Step>

        <Step n={3} title="保存先を決めておく">
          iPhoneとMacの両方で使うなら、<b>iCloud Drive の中にフォルダを1つ作って、そこに固定</b>するのが確実です。
          Macで落として、iPhoneの「ファイル」アプリから同じフォルダを開けます。
          <Note
            storageKey={KEY.folder}
            label="保存先フォルダ（自分用メモ）"
            placeholder="例：iCloud Drive / 株 / SBI-CSV"
          />
        </Step>

        <Step n={4} title="下の「CSVファイルを選ぶ」で、落としたファイルを全部まとめて選ぶ">
          1つずつ選ぶ必要はありません。<b>同じファイルを二度読み込んでも重複しない</b>ので、
          前回どこまで入れたかを覚えておく必要もありません。増えた分だけが足されます。
          <br />
          <br />
          1日分が増えても集計はほとんど動かないので、<b style={{ color: 'var(--ink)' }}>月1回で十分</b>です。
          日々記録するのは「プラン」の方で、CSVは後から答え合わせに使います。
        </Step>
      </div>

      <Footnote>
        メモとURLはこの端末にだけ保存されます。ログイン情報は一切扱いません。
        証券口座の認証を代行する仕組みは、このアプリには入れていません。
      </Footnote>
    </Card>
  )
}
