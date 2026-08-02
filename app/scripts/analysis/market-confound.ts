import { loadAll, wilson, twoProportionP, permutationP } from '../_load'
import type { Execution } from '../../src/lib/sbi/types'
const { executions } = loadAll()
interface Lot { openDate:string; quantity:number; price:number; market:string|null }
interface MPos { code:string;name:string;side:string;kind:string;account:string
  openDate:string|null;closeDate:string;holdingDays:number|null;quantity:number
  openPrice:number;realizedPnl:number;openMarket:string|null;closeMarket:string|null }
const sorted=[...executions].sort((a,b)=>a.date.localeCompare(b.date)||(a.action===b.action?0:a.action==='open'?-1:1)||a.seq-b.seq)
const books=new Map<string,Lot[]>(); const P:MPos[]=[]
const key=(e:Execution)=>`${e.code}|${e.side}|${e.kind}|${e.account}`
const days=(f:string,t:string)=>Math.round((Date.parse(t+'T00:00:00Z')-Date.parse(f+'T00:00:00Z'))/86400000)
for(const e of sorted){
  if(e.action==='open'){const b=books.get(key(e))??[];b.push({openDate:e.date,quantity:e.quantity,price:e.price,market:e.market});books.set(key(e),b);continue}
  const b=books.get(key(e))??[];let rem=e.quantity;const c:{lot:Lot;qty:number}[]=[]
  while(rem>0&&b.length>0){const lot=b[0];const q=Math.min(lot.quantity,rem);c.push({lot:{...lot},qty:q});lot.quantity-=q;rem-=q;if(lot.quantity===0)b.shift()}
  const pnl=e.realizedPnl??0
  if(rem>0)P.push({code:e.code,name:e.name,side:e.side,kind:e.kind,account:e.account,openDate:null,closeDate:e.date,holdingDays:null,quantity:rem,openPrice:0,realizedPnl:pnl*(rem/e.quantity),openMarket:null,closeMarket:e.market})
  for(const{lot,qty}of c)P.push({code:e.code,name:e.name,side:e.side,kind:e.kind,account:e.account,openDate:lot.openDate,closeDate:e.date,holdingDays:days(lot.openDate,e.date),quantity:qty,openPrice:lot.price,realizedPnl:pnl*(qty/e.quantity),openMarket:lot.market,closeMarket:e.market})
}
const grp=(m:string|null)=>m===null?'不明':m.startsWith('PTS')?'PTS':'東証'
const known=P.filter(p=>p.openMarket!==null)
const S=(r:MPos[])=>{const n=r.length,pnl=r.reduce((s,x)=>s+x.realizedPnl,0),w=r.filter(x=>x.realizedPnl>0).length
  return {n,pnl:Math.round(pnl),w,wr:n?w/n:0,exp:n?pnl/n:0}}
const fmt=(l:string,r:MPos[])=>{const s=S(r);return `${l.padEnd(22)} n=${String(s.n).padStart(4)} 損益=${String(s.pnl).padStart(9)} 期待値=${s.exp.toFixed(0).padStart(6)} 勝率=${(s.wr*100).toFixed(1)}%`}

const pts=known.filter(p=>grp(p.openMarket)==='PTS'), tse=known.filter(p=>grp(p.openMarket)==='東証')
console.log('=== 全体検定（エントリー市場 PTS vs 東証）===')
const sp=S(pts),st=S(tse)
console.log('勝率 p =', twoProportionP(sp.w,sp.n,st.w,st.n).toExponential(3))
console.log('損益 permutation p =', permutationP(known.map(p=>p.realizedPnl), known.map(p=>grp(p.openMarket)==='PTS'?0:1),2).toFixed(5))

console.log('\n=== 交絡A: 取引区分（現物/信用）で層別 ===')
for(const k of ['margin','cash']){
  const a=pts.filter(p=>p.kind===k), b=tse.filter(p=>p.kind===k)
  console.log(fmt(`${k} PTS入`,a)); console.log(fmt(`${k} 東証入`,b))
  if(a.length&&b.length) console.log(`  勝率p=${twoProportionP(S(a).w,a.length,S(b).w,b.length).toFixed(4)}`)
}

console.log('\n=== 交絡B: 銘柄別（PTS入とTSE入の両方が n>=15 の銘柄）===')
const codes=[...new Set(known.map(p=>p.code))]
let ptsBetter=0, tseBetter=0
const rows:string[]=[]
for(const c of codes){
  const a=pts.filter(p=>p.code===c), b=tse.filter(p=>p.code===c)
  if(a.length<15||b.length<15) continue
  const sa=S(a),sb=S(b)
  if(sa.exp>sb.exp) ptsBetter++; else tseBetter++
  rows.push(`${c} ${a[0].name.slice(0,8).padEnd(9)} PTS入 n=${String(sa.n).padStart(3)} 期待値=${sa.exp.toFixed(0).padStart(6)} 勝率=${(sa.wr*100).toFixed(1)}% | 東証入 n=${String(sb.n).padStart(3)} 期待値=${sb.exp.toFixed(0).padStart(6)} 勝率=${(sb.wr*100).toFixed(1)}% | p=${twoProportionP(sa.w,sa.n,sb.w,sb.n).toFixed(3)}`)
}
rows.forEach(r=>console.log(r))
console.log(`銘柄内でPTS入の方が期待値高い: ${ptsBetter} / 東証入の方が高い: ${tseBetter}`)

console.log('\n=== 銘柄構成の偏り（PTS入比率）===')
for(const c of codes){
  const a=pts.filter(p=>p.code===c).length, b=tse.filter(p=>p.code===c).length
  if(a+b<30) continue
  console.log(`${c} ${(pts.find(p=>p.code===c)?.name??tse.find(p=>p.code===c)?.name??'').slice(0,10).padEnd(11)} 計${String(a+b).padStart(4)} PTS入率=${(a/(a+b)*100).toFixed(1)}%`)
}

console.log('\n=== 交絡C: 保有期間で層別 ===')
const hb=(d:number|null)=>d===null?'不明':d<=0?'デイトレ':d===1?'1日':d<=5?'2-5日':d<=20?'6-20日':'21日+'
for(const k of ['デイトレ','1日','2-5日','6-20日','21日+']){
  const a=pts.filter(p=>hb(p.holdingDays)===k), b=tse.filter(p=>hb(p.holdingDays)===k)
  console.log(fmt(`${k} PTS入`,a)); console.log(fmt(`${k} 東証入`,b))
  if(a.length>=30&&b.length>=30) console.log(`  勝率p=${twoProportionP(S(a).w,a.length,S(b).w,b.length).toFixed(4)}`)
}

console.log('\n=== 交絡D: 建玉金額（openPrice*quantity）で層別 ===')
const notional=(p:MPos)=>p.openPrice*p.quantity
console.log('PTS入 中央値', Math.round([...pts].sort((a,b)=>notional(a)-notional(b))[Math.floor(pts.length/2)]!==undefined?notional([...pts].sort((a,b)=>notional(a)-notional(b))[Math.floor(pts.length/2)]):0))
console.log('東証入 中央値', Math.round(notional([...tse].sort((a,b)=>notional(a)-notional(b))[Math.floor(tse.length/2)])))
const qs=[0,150000,300000,600000,Infinity]
for(let i=0;i<qs.length-1;i++){
  const f=(r:MPos[])=>r.filter(p=>notional(p)>=qs[i]&&notional(p)<qs[i+1])
  const a=f(pts),b=f(tse)
  console.log(fmt(`${qs[i]/10000}-${qs[i+1]/10000}万 PTS入`,a)); console.log(fmt(`${qs[i]/10000}-${qs[i+1]/10000}万 東証入`,b))
  if(a.length>=30&&b.length>=30) console.log(`  勝率p=${twoProportionP(S(a).w,a.length,S(b).w,b.length).toFixed(4)}`)
}

console.log('\n=== 交絡E: 月別（PTS利用率と成績の時系列）===')
const months=[...new Set(known.map(p=>p.closeDate.slice(0,7)))].sort()
for(const m of months){
  const a=pts.filter(p=>p.closeDate.slice(0,7)===m), b=tse.filter(p=>p.closeDate.slice(0,7)===m)
  const sa=S(a),sb=S(b)
  console.log(`${m} PTS入率=${((a.length/(a.length+b.length))*100).toFixed(0)}% | PTS入 n=${String(sa.n).padStart(3)} 損益=${String(sa.pnl).padStart(8)} 勝率${(sa.wr*100).toFixed(0)}% | 東証入 n=${String(sb.n).padStart(3)} 損益=${String(sb.pnl).padStart(8)} 勝率${(sb.wr*100).toFixed(0)}%`)
}

console.log('\n=== 交絡F: side（買い/空売り）===')
for(const s of ['long','short']){
  const a=pts.filter(p=>p.side===s), b=tse.filter(p=>p.side===s)
  console.log(fmt(`${s} PTS入`,a)); console.log(fmt(`${s} 東証入`,b))
  if(a.length>=30&&b.length>=30) console.log(`  勝率p=${twoProportionP(S(a).w,a.length,S(b).w,b.length).toFixed(4)}`)
}
