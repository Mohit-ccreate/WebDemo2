import { useState } from 'react'
import { TICKER_ICONS, displayPrice } from '../constants/commodities'

function getColor(chg) {
  if (chg >= 3)   return { bg:'#14532d', border:'#22c55e', text:'#86efac' }
  if (chg >= 1.5) return { bg:'#166534', border:'#16a34a', text:'#4ade80' }
  if (chg >= 0.5) return { bg:'#15803d', border:'#15803d', text:'#bbf7d0' }
  if (chg >= 0)   return { bg:'#1a2e22', border:'#166534', text:'#86efac' }
  if (chg >= -0.5)return { bg:'#2d1a1a', border:'#7f1d1d', text:'#fca5a5' }
  if (chg >= -1.5)return { bg:'#7f1d1d', border:'#b91c1c', text:'#fca5a5' }
  if (chg >= -3)  return { bg:'#991b1b', border:'#dc2626', text:'#fecaca' }
  return             { bg:'#450a0a', border:'#ef4444', text:'#fca5a5' }
}

function fmt(n) {
  if (!n) return '—'
  if (n >= 1e7) return '₹'+(n/1e7).toFixed(2)+'Cr'
  if (n >= 1e5) return '₹'+(n/1e5).toFixed(1)+'L'
  return '₹'+n.toLocaleString('en-IN',{maximumFractionDigits:0})
}

export default function HeatmapPage({ wsData }) {
  const [filter, setFilter] = useState('All')
  const [sortBy, setSortBy] = useState('change')
  const [tooltip, setTooltip] = useState(null)

  const CATS = ['All', 'metals', 'energy']

  const prices = Object.values(wsData.prices)
  const filtered = prices
    .filter(c => filter === 'All' || c.category === filter)
    .sort((a,b) => {
      if (sortBy === 'change') return b.change_pct - a.change_pct
      if (sortBy === 'price')  return displayPrice(b) - displayPrice(a)
      return (a.name||'').localeCompare(b.name||'')
    })

  const maxAbs = Math.max(...filtered.map(c => Math.abs(c.change_pct||0)), 0.01)

  // Market summary
  const gainers = prices.filter(c => c.change_pct > 0).length
  const losers  = prices.filter(c => c.change_pct < 0).length
  const flat    = prices.length - gainers - losers
  const avgChg  = prices.length ? (prices.reduce((s,c) => s+(c.change_pct||0),0)/prices.length).toFixed(2) : 0

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem',flexWrap:'wrap',gap:12}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:700,color:'var(--text-primary)'}}>Market Heatmap</h1>
          <p style={{fontSize:13,color:'var(--text-muted)',marginTop:2}}>
            Visual overview of all commodity price movements · Green = up · Red = down
          </p>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)}>
            <option value="change">Sort: Change %</option>
            <option value="price">Sort: Price</option>
            <option value="name">Sort: Name</option>
          </select>
        </div>
      </div>

      {/* Market summary bar */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10,marginBottom:'1.5rem'}}>
        {[
          {label:'Gainers',   value:gainers, color:'#22c55e'},
          {label:'Losers',    value:losers,  color:'#ef4444'},
          {label:'Unchanged', value:flat,    color:'#64748b'},
          {label:'Avg Change',value:(avgChg>0?'+':'')+avgChg+'%', color:avgChg>=0?'#22c55e':'#ef4444'},
        ].map((s,i)=>(
          <div key={i} className="card" style={{padding:'12px 14px'}}>
            <div style={{fontSize:11,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:4}}>{s.label}</div>
            <div style={{fontSize:22,fontWeight:700,color:s.color}}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Category tabs */}
      <div style={{display:'flex',gap:6,marginBottom:'1.2rem',flexWrap:'wrap'}}>
        {CATS.map(c=>(
          <button key={c} className={'tab-btn '+(filter===c?'active':'')} onClick={()=>setFilter(c)}>
            {c.charAt(0).toUpperCase()+c.slice(1)}
          </button>
        ))}
      </div>

      {/* Colour legend */}
      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:'1.2rem',flexWrap:'wrap'}}>
        <span style={{fontSize:11,color:'var(--text-muted)'}}>Change:</span>
        {[['< -3%','#450a0a'],['−3 to −1.5%','#991b1b'],['−1.5 to 0%','#2d1a1a'],
          ['0 to +1.5%','#1a2e22'],['1.5 to +3%','#166534'],['> +3%','#14532d']].map(([l,bg])=>(
          <span key={l} style={{display:'flex',alignItems:'center',gap:4,fontSize:11,color:'#94a3b8'}}>
            <span style={{width:12,height:12,borderRadius:2,background:bg,display:'inline-block'}}/>
            {l}
          </span>
        ))}
      </div>

      {/* Heatmap grid — size proportional to |change| */}
      {filtered.length === 0 ? (
        <div className="card" style={{textAlign:'center',padding:'3rem',color:'var(--text-muted)'}}>
          Waiting for live price data...
        </div>
      ) : (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:8}}>
          {filtered.map(c => {
            const chg = c.change_pct || 0
            const clr = getColor(chg)
            const up  = chg >= 0
            const rel = Math.min(1, Math.abs(chg) / (maxAbs || 1))
            const h   = Math.round(100 + rel * 80)      // 100px to 180px height
            return (
              <div key={c.ticker}
                onMouseEnter={() => setTooltip(c)}
                onMouseLeave={() => setTooltip(null)}
                style={{
                  background: clr.bg,
                  border: `1px solid ${clr.border}`,
                  borderRadius: 10,
                  padding: '12px 10px',
                  height: h,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  cursor: 'default',
                  transition: 'transform 0.1s, box-shadow 0.1s',
                  position: 'relative',
                }}
                onMouseOver={e => { e.currentTarget.style.transform='scale(1.03)'; e.currentTarget.style.zIndex=10 }}
                onMouseOut={e  => { e.currentTarget.style.transform='scale(1)';    e.currentTarget.style.zIndex=1  }}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <span style={{fontSize:18}}>{TICKER_ICONS[c.ticker]||'📦'}</span>
                  <span style={{fontSize:10,color:clr.text,opacity:0.7}}>{c.symbol}</span>
                </div>
                <div>
                  <div style={{fontSize:12,fontWeight:700,color:clr.text,marginBottom:2}}>{c.name}</div>
                  <div style={{fontSize:11,color:clr.text,opacity:0.8,marginBottom:4}}>{fmt(displayPrice(c))}</div>
                  <div style={{fontSize:16,fontWeight:800,color:clr.text}}>
                    {up?'▲':'▼'} {Math.abs(chg).toFixed(2)}%
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position:'fixed', bottom:24, right:24, zIndex:1000,
          background:'#1a1d27', border:'1px solid #2d3148',
          borderRadius:12, padding:'14px 18px', minWidth:220,
          boxShadow:'0 8px 32px rgba(0,0,0,0.5)'
        }}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
            <span style={{fontSize:24}}>{TICKER_ICONS[tooltip.ticker]||'📦'}</span>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:'#e2e8f0'}}>{tooltip.name}</div>
              <div style={{fontSize:11,color:'#64748b'}}>{tooltip.ticker} · {tooltip.unit}</div>
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            {[
              {l:'Price (₹)',  v:fmt(displayPrice(tooltip)) + (tooltip.display_unit ? ' ' + tooltip.display_unit : '')},
              {l:'Price (USD)',v:'$'+(tooltip.price_usd||0).toFixed(2)},
              {l:'Change',     v:(tooltip.change_pct>=0?'+':'')+tooltip.change_pct?.toFixed(2)+'%'},
              {l:'USD/INR',    v:'₹'+tooltip.usd_inr},
            ].map(({l,v})=>(
              <div key={l}>
                <div style={{fontSize:10,color:'#64748b',textTransform:'uppercase'}}>{l}</div>
                <div style={{fontSize:13,fontWeight:600,color:'#e2e8f0'}}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}