import { loadAll, wilson, twoProportionP, permutationP, weekdayOf, WEEKDAY_JA } from '../_load'
import type { Execution } from '../../src/lib/sbi/types'

const { executions } = loadAll()

// 東証（外）の中身確認
const gai = executions.filter(e => e.market === '東証（外）')
console.log('東証（外） codes:', [...new Set(gai.map(e => `${e.code} ${e.name}`))].join(' / '))
console.log('null market:', [...new Set(executions.filter(e=>e.market===null).map(e=>`${e.code} ${e.name} ${e.kind}`))].join(' / '))

// ---- market を持ち回るFIFO（src/lib/sbi/positions.ts と同ロジック） ----
interface Lot { openDate: string; quantity: number; price: number; feePerUnit: number; market: string | null }
export interface MPos {
  code: string; name: string; side: string; kind: string; account: string
  openDate: string | null; closeDate: string; holdingDays: number | null
  quantity: number; realizedPnl: number
  openMarket: string | null; closeMarket: string | null
}
const sorted = [...executions].sort((a,b)=>
  a.date.localeCompare(b.date) || (a.action===b.action?0:a.action==='open'?-1:1) || a.seq-b.seq)
const books = new Map<string, Lot[]>()
const positions: MPos[] = []
const key = (e: Execution) => `${e.code}|${e.side}|${e.kind}|${e.account}`
const days = (f:string,t:string)=>Math.round((Date.parse(t+'T00:00:00Z')-Date.parse(f+'T00:00:00Z'))/86400000)

for (const e of sorted) {
  if (e.action === 'open') {
    const b = books.get(key(e)) ?? []
    b.push({ openDate: e.date, quantity: e.quantity, price: e.price, feePerUnit: e.quantity?e.fee/e.quantity:0, market: e.market })
    books.set(key(e), b); continue
  }
  const b = books.get(key(e)) ?? []
  let rem = e.quantity
  const consumed: {lot:Lot;qty:number}[] = []
  while (rem>0 && b.length>0) {
    const lot=b[0]; const q=Math.min(lot.quantity,rem)
    consumed.push({lot:{...lot},qty:q}); lot.quantity-=q; rem-=q; if(lot.quantity===0) b.shift()
  }
  const pnl = e.realizedPnl ?? 0
  if (rem>0) positions.push({ code:e.code,name:e.name,side:e.side,kind:e.kind,account:e.account,
    openDate:null,closeDate:e.date,holdingDays:null,quantity:rem,realizedPnl:pnl*(rem/e.quantity),
    openMarket:null,closeMarket:e.market })
  for (const {lot,qty} of consumed) positions.push({ code:e.code,name:e.name,side:e.side,kind:e.kind,account:e.account,
    openDate:lot.openDate,closeDate:e.date,holdingDays:days(lot.openDate,e.date),quantity:qty,
    realizedPnl:pnl*(qty/e.quantity), openMarket:lot.market, closeMarket:e.market })
}
console.log('\nrebuilt positions:', positions.length, 'pnl', Math.round(positions.reduce((s,p)=>s+p.realizedPnl,0)))

export function grp(m: string|null): string {
  if (m===null) return '不明'
  if (m.startsWith('PTS')) return 'PTS'
  return '東証'
}
export { positions }

function stat(rows: MPos[]) {
  const n=rows.length, pnl=rows.reduce((s,r)=>s+r.realizedPnl,0)
  const w=rows.filter(r=>r.realizedPnl>0).length, l=rows.filter(r=>r.realizedPnl<0).length
  const wins=rows.filter(r=>r.realizedPnl>0), loss=rows.filter(r=>r.realizedPnl<0)
  const aw=wins.length?wins.reduce((s,r)=>s+r.realizedPnl,0)/wins.length:0
  const al=loss.length?loss.reduce((s,r)=>s+r.realizedPnl,0)/loss.length:0
  return {n,pnl:Math.round(pnl),w,l,winRate:n?w/n:0,exp:n?pnl/n:0,avgWin:Math.round(aw),avgLoss:Math.round(al)}
}
function show(label:string, rows:MPos[]) {
  const s=stat(rows); const ci=wilson(s.w,s.n)
  console.log(`${label.padEnd(18)} n=${String(s.n).padStart(4)} 損益=${String(s.pnl).padStart(9)} 期待値=${s.exp.toFixed(0).padStart(6)} 勝率=${(s.winRate*100).toFixed(1)}% [${(ci.lo*100).toFixed(1)}-${(ci.hi*100).toFixed(1)}] 平均勝=${s.avgWin} 平均負=${s.avgLoss}`)
}

console.log('\n=== 2. 市場の組み合わせ（エントリー→決済） ===')
const combos = new Map<string, MPos[]>()
for (const p of positions) {
  const k = `${grp(p.openMarket)}→${grp(p.closeMarket)}`
  ;(combos.get(k) ?? combos.set(k,[]).get(k)!).push(p)
}
for (const [k,v] of [...combos].sort((a,b)=>b[1].length-a[1].length)) show(k,v)

console.log('\n=== エントリー市場のみ（決済不問） ===')
const byOpen = new Map<string,MPos[]>()
for (const p of positions) { const k=grp(p.openMarket); (byOpen.get(k)??byOpen.set(k,[]).get(k)!).push(p) }
for (const [k,v] of byOpen) show(k,v)

console.log('\n=== PTS細分（X/O/J） エントリー ===')
const byOpenFine = new Map<string,MPos[]>()
for (const p of positions) { const k=String(p.openMarket); (byOpenFine.get(k)??byOpenFine.set(k,[]).get(k)!).push(p) }
for (const [k,v] of [...byOpenFine].sort((a,b)=>b[1].length-a[1].length)) show(k,v)

console.log('\n=== 決済市場のみ ===')
const byClose = new Map<string,MPos[]>()
for (const p of positions) { const k=grp(p.closeMarket); (byClose.get(k)??byClose.set(k,[]).get(k)!).push(p) }
for (const [k,v] of byClose) show(k,v)
