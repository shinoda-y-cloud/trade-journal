import { loadAll } from '../_load'
const { positions } = loadAll()
const m = new Map<string, { name: string; n: number; pnl: number; win: number; long: number; short: number; kinds: Set<string> }>()
for (const p of positions) {
  const k = p.code
  let e = m.get(k)
  if (!e) { e = { name: p.name, n: 0, pnl: 0, win: 0, long: 0, short: 0, kinds: new Set() }; m.set(k, e) }
  e.n++; e.pnl += p.realizedPnl; if (p.realizedPnl > 0) e.win++
  if (p.side === 'long') e.long++; else e.short++
  e.kinds.add(p.kind)
}
const rows = [...m.entries()].sort((a, b) => b[1].n - a[1].n)
console.log('code\tname\tn\tpnl\twin\tlong\tshort\tkinds')
for (const [c, v] of rows) console.log(`${c}\t${v.name}\t${v.n}\t${Math.round(v.pnl)}\t${v.win}\t${v.long}\t${v.short}\t${[...v.kinds].join(',')}`)
console.log('TOTAL codes=', rows.length, 'positions=', positions.length, 'pnl=', Math.round(positions.reduce((s, p) => s + p.realizedPnl, 0)))
