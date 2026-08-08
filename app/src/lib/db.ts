/**
 * 端末内のデータ保存。IndexedDB のみを使い、外部へは一切送信しない。
 *
 * 保存するのは約定（Execution）だけ。建玉と集計は読み込み時に毎回組み立てる。
 * 3,000件規模で数十ミリ秒なので、派生データを持って不整合を抱えるより安全。
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Execution } from './sbi/types'
import type { TradePlan } from './plans'

const DB_NAME = 'trade-journal'
const DB_VERSION = 2

interface Schema extends DBSchema {
  executions: {
    key: string
    value: Execution
    indexes: { date: string }
  }
  imports: {
    key: number
    value: ImportLog
  }
  /** 事前に記録したトレードプラン */
  plans: {
    key: string
    value: TradePlan
    indexes: { date: string }
  }
}

/** 取り込み履歴。何をいつ入れたかを追えるようにする */
export interface ImportLog {
  id?: number
  at: string
  fileName: string
  format: string
  added: number
  duplicated: number
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null

function db() {
  dbPromise ??= openDB<Schema>(DB_NAME, DB_VERSION, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        const store = d.createObjectStore('executions', { keyPath: 'id' })
        store.createIndex('date', 'date')
        d.createObjectStore('imports', { keyPath: 'id', autoIncrement: true })
      }
      if (oldVersion < 2) {
        const plans = d.createObjectStore('plans', { keyPath: 'id' })
        plans.createIndex('date', 'date')
      }
    },
  })
  return dbPromise
}

export async function loadExecutions(): Promise<Execution[]> {
  return (await db()).getAll('executions')
}

/**
 * 約定を保存する。IDは内容から決まるため、同じCSVを何度取り込んでも重複しない。
 * 追加できた件数と、既存と重複した件数を返す。
 */
export async function saveExecutions(
  executions: Execution[],
): Promise<{ added: number; duplicated: number }> {
  const d = await db()
  const tx = d.transaction('executions', 'readwrite')
  let added = 0
  let duplicated = 0
  await Promise.all(
    executions.map(async (e) => {
      const existing = await tx.store.get(e.id)
      if (existing) duplicated++
      else added++
      await tx.store.put(e)
    }),
  )
  await tx.done
  return { added, duplicated }
}

export async function addImportLog(log: Omit<ImportLog, 'id'>): Promise<void> {
  await (await db()).add('imports', log as ImportLog)
}

export async function loadImportLogs(): Promise<ImportLog[]> {
  return (await (await db()).getAll('imports')).reverse()
}

/* ------------------------------------------------------------------ */
/* トレードプラン                                                      */
/* ------------------------------------------------------------------ */

export async function loadPlans(): Promise<TradePlan[]> {
  return (await db()).getAll('plans')
}

export async function savePlan(plan: TradePlan): Promise<void> {
  await (await db()).put('plans', plan)
}

export async function deletePlan(id: string): Promise<void> {
  await (await db()).delete('plans', id)
}

/* ------------------------------------------------------------------ */

export async function clearAll(): Promise<void> {
  const d = await db()
  await d.clear('executions')
  await d.clear('imports')
}

/** プランだけを消す。取引データには触れない */
export async function clearPlans(): Promise<void> {
  await (await db()).clear('plans')
}

/* ------------------------------------------------------------------ */
/* バックアップ                                                        */
/* ------------------------------------------------------------------ */

export interface Backup {
  app: 'trade-journal'
  version: number
  exportedAt: string
  executions: Execution[]
  /** v2以降。古いバックアップには入っていない */
  plans?: TradePlan[]
}

export async function exportBackup(): Promise<Backup> {
  return {
    app: 'trade-journal',
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    executions: await loadExecutions(),
    plans: await loadPlans(),
  }
}

/** バックアップJSONを読み込む。既存データには追記され、重複は無視される */
export async function importBackup(json: unknown): Promise<{ added: number; duplicated: number }> {
  const b = json as Partial<Backup>
  if (b?.app !== 'trade-journal' || !Array.isArray(b.executions)) {
    throw new Error('このアプリのバックアップファイルではありません')
  }
  if (Array.isArray(b.plans)) {
    const d = await db()
    const tx = d.transaction('plans', 'readwrite')
    await Promise.all(b.plans.map((p) => tx.store.put(p)))
    await tx.done
  }
  return saveExecutions(b.executions)
}

/** バックアップをファイルとして保存させる */
export function downloadBackup(backup: Backup): void {
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `trade-journal-${backup.exportedAt.slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}
