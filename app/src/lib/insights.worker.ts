/**
 * 検定をメインスレッドから追い出すためのワーカー。
 *
 * 並べ替え検定とブートストラップは合計で1秒前後かかる。描画中に走らせると
 * その間タブが固まるため、ワーカーで計算して結果だけ返す。
 */
import { runInsights, sizeAnalysis, type InsightReport, type SizeAnalysis } from './insights'
import type { Position } from './sbi/types'

export interface WorkerRequest {
  id: number
  positions: Position[]
}

export interface WorkerResponse {
  id: number
  report: InsightReport
  size: SizeAnalysis | null
  ms: number
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, positions } = e.data
  const t0 = performance.now()
  const report = runInsights(positions)
  const size = sizeAnalysis(positions)
  const res: WorkerResponse = { id, report, size, ms: Math.round(performance.now() - t0) }
  self.postMessage(res)
}
