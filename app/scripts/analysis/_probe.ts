import { loadAll } from '../_load'
const { positions } = loadAll()
const by: Record<string, number> = {}
for (const p of positions) by[`${p.assetClass}/${p.kind}`] = (by[`${p.assetClass}/${p.kind}`] ?? 0) + 1
console.log('件数', positions.length, by)
console.log('pnl合計', positions.reduce((s, p) => s + p.realizedPnl, 0))
console.log('勝', positions.filter((p) => p.realizedPnl > 0).length, '負', positions.filter((p) => p.realizedPnl < 0).length, '±0', positions.filter((p) => p.realizedPnl === 0).length)
for (const p of positions.filter((p) => p.assetClass !== 'domestic_stock').slice(0, 10))
  console.log(p.assetClass, p.kind, p.code, p.quantity, p.openPrice, p.realizedPnl)
console.log('openDate null', positions.filter((p) => p.openDate === null).length)
console.log('holdingDays null', positions.filter((p) => p.holdingDays === null).length)
