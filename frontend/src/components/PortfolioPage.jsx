import { useState, useEffect } from 'react'
import { PlusCircle, Trash2, TrendingUp, TrendingDown, PieChart } from 'lucide-react'
import { PieChart as RechartsPie, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import toast from 'react-hot-toast'

import { CORE_COMMODITIES, displayPrice } from '../constants/commodities'

const TICKERS = CORE_COMMODITIES.map(({ ticker, name }) => ({ ticker, name }))
const COLORS = ['#6366f1','#22c55e','#f59e0b','#ef4444','#14b8a6','#8b5cf6','#ec4899','#0ea5e9']
const STORAGE_KEY = 'commodityiq_portfolio'

function fmt(n) {
  if (!n && n !== 0) return '—'
  if (n >= 1e7) return '₹' + (n/1e7).toFixed(2) + ' Cr'
  if (n >= 1e5) return '₹' + (n/1e5).toFixed(2) + ' L'
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

export default function PortfolioPage({ wsData }) {
  const [holdings, setHoldings] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
  })
  const [form, setForm] = useState({ ticker:'GC=F', quantity:'', buy_price:'' })
  const [showForm, setShowForm] = useState(false)
  const [view, setView] = useState('table')   // table | chart

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(holdings))
  }, [holdings])

  const addHolding = () => {
    if (!form.quantity || !form.buy_price) { toast.error('Enter quantity and buy price'); return }
    const meta = TICKERS.find(t => t.ticker === form.ticker)
    setHoldings(h => [...h, {
      id:        Date.now(),
      ticker:    form.ticker,
      name:      meta?.name || form.ticker,
      quantity:  parseFloat(form.quantity),
      buy_price: parseFloat(form.buy_price),
      added_at:  new Date().toISOString(),
    }])
    setForm({ ticker:'GC=F', quantity:'', buy_price:'' })
    setShowForm(false)
    toast.success('Holding added!')
  }

  const removeHolding = (id) => {
    setHoldings(h => h.filter(x => x.id !== id))
    toast('Holding removed')
  }

  // Enrich with live prices
  const enriched = holdings.map(h => {
    const live       = wsData.prices[h.ticker]
    const curr_price = (live ? displayPrice(live) : null) || h.buy_price
    const curr_value = curr_price * h.quantity
    const cost_basis = h.buy_price * h.quantity
    const pnl        = curr_value - cost_basis
    const pnl_pct    = cost_basis ? (pnl / cost_basis * 100) : 0
    return { ...h, curr_price, curr_value, cost_basis, pnl, pnl_pct }
  })

  const totalValue     = enriched.reduce((s, h) => s + h.curr_value,  0)
  const totalCost      = enriched.reduce((s, h) => s + h.cost_basis,  0)
  const totalPnl       = totalValue - totalCost
  const totalPnlPct    = totalCost ? (totalPnl / totalCost * 100) : 0
  const isUp           = totalPnl >= 0

  const pieData = enriched.map(h => ({
    name:  h.name,
    value: parseFloat(h.curr_value.toFixed(2)),
  }))

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.5rem', flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:'#e2e8f0' }}>Portfolio Tracker</h1>
          <p style={{ fontSize:13, color:'#64748b', marginTop:2 }}>Track your commodity holdings in ₹ · P&L in real-time</p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className={'tab-btn ' + (view==='table'?'active':'')} onClick={()=>setView('table')}>Table</button>
          <button className={'tab-btn ' + (view==='chart'?'active':'')} onClick={()=>setView('chart')}>
            <span style={{display:'flex',alignItems:'center',gap:6}}><PieChart size={13}/>Allocation</span>
          </button>
          <button onClick={() => setShowForm(s=>!s)}
            style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 16px',
              background:'#6366f1', color:'#fff', border:'none', borderRadius:8,
              fontWeight:600, fontSize:13, cursor:'pointer' }}>
            <PlusCircle size={14}/> Add Holding
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:12, marginBottom:'1.5rem' }}>
        {[
          { label:'Portfolio Value',  value: fmt(totalValue),  sub:'current',            color: null },
          { label:'Total Invested',   value: fmt(totalCost),   sub:'cost basis',         color: null },
          { label:'Total P&L',        value: fmt(totalPnl),    sub: totalPnlPct.toFixed(2)+'%', color: isUp?'#22c55e':'#ef4444' },
          { label:'Holdings',         value: holdings.length,  sub:'commodities',        color: null },
        ].map((s,i) => (
          <div key={i} className="card" style={{ padding:'14px 16px' }}>
            <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:4 }}>{s.label}</div>
            <div style={{ fontSize:20, fontWeight:700, color: s.color||'#e2e8f0' }}>{s.value}</div>
            <div style={{ fontSize:11, color: s.color||'#475569', marginTop:2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Add holding form */}
      {showForm && (
        <div className="card" style={{ marginBottom:'1.5rem', borderColor:'#3d4268' }}>
          <div style={{ fontSize:14, fontWeight:600, color:'#e2e8f0', marginBottom:'1rem' }}>Add New Holding</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <div>
              <label style={{ fontSize:11, color:'#64748b', display:'block', marginBottom:4 }}>COMMODITY</label>
              <select value={form.ticker} onChange={e=>setForm(f=>({...f,ticker:e.target.value}))} style={{width:'100%'}}>
                {TICKERS.map(t=><option key={t.ticker} value={t.ticker}>{t.name} ({t.ticker})</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize:11, color:'#64748b', display:'block', marginBottom:4 }}>QUANTITY (units)</label>
              <input type="number" placeholder="e.g. 10" value={form.quantity}
                onChange={e=>setForm(f=>({...f,quantity:e.target.value}))} style={{width:'100%'}}/>
            </div>
            <div>
              <label style={{ fontSize:11, color:'#64748b', display:'block', marginBottom:4 }}>BUY PRICE (₹ per unit)</label>
              <input type="number" placeholder="e.g. 195000" value={form.buy_price}
                onChange={e=>setForm(f=>({...f,buy_price:e.target.value}))} style={{width:'100%'}}/>
            </div>
          </div>
          <div style={{ fontSize:11, color:'#475569', marginBottom:12 }}>
            💡 Tip: Live price for {TICKERS.find(t=>t.ticker===form.ticker)?.name} is{' '}
            <span style={{color:'#e2e8f0',fontWeight:600}}>
              {wsData.prices[form.ticker] ? fmt(displayPrice(wsData.prices[form.ticker])) : 'loading...'}
            {' '}
            {wsData.prices[form.ticker]?.display_unit ? `(${wsData.prices[form.ticker].display_unit})` : ''}
            </span>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={addHolding}
              style={{ padding:'8px 18px', background:'#6366f1', color:'#fff', border:'none',
                borderRadius:8, fontWeight:600, fontSize:13, cursor:'pointer' }}>Add</button>
            <button onClick={()=>setShowForm(false)}
              style={{ padding:'8px 18px', background:'transparent', color:'#94a3b8',
                border:'1px solid #2d3148', borderRadius:8, fontWeight:600, fontSize:13, cursor:'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      {holdings.length === 0 ? (
        <div className="card" style={{ textAlign:'center', padding:'3rem', color:'#475569' }}>
          <PieChart size={48} style={{ margin:'0 auto 1rem', opacity:0.3 }}/>
          <div style={{ fontSize:15 }}>No holdings yet</div>
          <div style={{ fontSize:12, marginTop:6 }}>Click "Add Holding" to start tracking your portfolio</div>
        </div>
      ) : view === 'chart' ? (
        /* Pie chart view */
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          <div className="card">
            <div style={{ fontSize:14, fontWeight:600, color:'#94a3b8', marginBottom:'1rem' }}>ALLOCATION BY VALUE</div>
            <ResponsiveContainer width="100%" height={300}>
              <RechartsPie>
                <Pie data={pieData} cx="50%" cy="50%" outerRadius={110} dataKey="value" label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                  {pieData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                </Pie>
                <Tooltip formatter={v=>fmt(v)}/>
              </RechartsPie>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <div style={{ fontSize:14, fontWeight:600, color:'#94a3b8', marginBottom:'1rem' }}>P&L BREAKDOWN</div>
            {enriched.map((h,i)=>(
              <div key={h.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 0', borderBottom:'1px solid #1e2235' }}>
                <div style={{ width:12, height:12, borderRadius:2, background:COLORS[i%COLORS.length], flexShrink:0 }}/>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:'#e2e8f0' }}>{h.name}</div>
                  <div style={{ fontSize:11, color:'#64748b' }}>{h.quantity} units</div>
                </div>
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontSize:13, fontWeight:600, color: h.pnl>=0?'#22c55e':'#ef4444' }}>
                    {h.pnl>=0?'+':''}{fmt(h.pnl)}
                  </div>
                  <div style={{ fontSize:11, color: h.pnl>=0?'#22c55e':'#ef4444' }}>
                    {h.pnl_pct>=0?'+':''}{h.pnl_pct.toFixed(2)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Table view */
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ borderBottom:'1px solid #2d3148' }}>
                {['Commodity','Qty','Buy Price','Curr Price','Cost Basis','Curr Value','P&L','P&L %',''].map(h=>(
                  <th key={h} style={{ padding:'12px 16px', textAlign:'left', fontSize:11,
                    color:'#64748b', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {enriched.map((h,i)=>{
                const up = h.pnl >= 0
                return (
                  <tr key={h.id} style={{ borderBottom:'1px solid #1e2235' }}
                    onMouseEnter={e=>e.currentTarget.style.background='#1e2235'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <td style={{ padding:'12px 16px' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <div style={{ width:10, height:10, borderRadius:2, background:COLORS[i%COLORS.length] }}/>
                        <div>
                          <div style={{ fontWeight:600, fontSize:13, color:'#e2e8f0' }}>{h.name}</div>
                          <div style={{ fontSize:11, color:'#64748b' }}>{h.ticker}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding:'12px 16px', fontSize:13, color:'#e2e8f0' }}>{h.quantity}</td>
                    <td style={{ padding:'12px 16px', fontSize:13, color:'#94a3b8' }}>{fmt(h.buy_price)}</td>
                    <td style={{ padding:'12px 16px', fontSize:13, fontWeight:600, color:'#e2e8f0' }}>{fmt(h.curr_price)}</td>
                    <td style={{ padding:'12px 16px', fontSize:13, color:'#94a3b8' }}>{fmt(h.cost_basis)}</td>
                    <td style={{ padding:'12px 16px', fontSize:13, fontWeight:700, color:'#e2e8f0' }}>{fmt(h.curr_value)}</td>
                    <td style={{ padding:'12px 16px' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:4, fontSize:13,
                        fontWeight:600, color: up?'#22c55e':'#ef4444' }}>
                        {up?<TrendingUp size={13}/>:<TrendingDown size={13}/>}
                        {up?'+':''}{fmt(h.pnl)}
                      </div>
                    </td>
                    <td style={{ padding:'12px 16px' }}>
                      <span className={up?'badge-up':'badge-down'}>
                        {up?'+':''}{h.pnl_pct.toFixed(2)}%
                      </span>
                    </td>
                    <td style={{ padding:'12px 16px' }}>
                      <button onClick={()=>removeHolding(h.id)}
                        style={{ background:'none', border:'1px solid rgba(239,68,68,0.3)',
                          borderRadius:6, color:'#ef4444', cursor:'pointer', padding:'4px 8px', display:'flex' }}>
                        <Trash2 size={13}/>
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop:'2px solid #2d3148', background:'#13151f' }}>
                <td colSpan={5} style={{ padding:'12px 16px', fontSize:12, color:'#64748b', fontWeight:600 }}>TOTAL</td>
                <td style={{ padding:'12px 16px', fontSize:14, fontWeight:700, color:'#e2e8f0' }}>{fmt(totalValue)}</td>
                <td style={{ padding:'12px 16px' }}>
                  <div style={{ fontSize:13, fontWeight:700, color: isUp?'#22c55e':'#ef4444',
                    display:'flex', alignItems:'center', gap:4 }}>
                    {isUp?<TrendingUp size={13}/>:<TrendingDown size={13}/>}
                    {isUp?'+':''}{fmt(totalPnl)}
                  </div>
                </td>
                <td style={{ padding:'12px 16px' }}>
                  <span className={isUp?'badge-up':'badge-down'}>
                    {isUp?'+':''}{totalPnlPct.toFixed(2)}%
                  </span>
                </td>
                <td/>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}