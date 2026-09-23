import { useState, useEffect } from 'react'
import { fetchHistory } from '../api/client'
import { Plus, X } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts'

import { CORE_COMMODITIES, displayPrice } from '../constants/commodities'

const ALL_TICKERS = CORE_COMMODITIES.map(({ ticker, name }) => ({ ticker, name }))
const COLORS  = ['#6366f1','#22c55e','#f59e0b','#ef4444','#14b8a6','#ec4899']
const PERIODS = ['1mo','3mo','6mo','1y','2y']

function fmt(n) {
  if (n >= 1e5) return '₹'+(n/1e5).toFixed(1)+'L'
  return '₹'+(n||0).toLocaleString('en-IN',{maximumFractionDigits:0})
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background:'#1a1d27', border:'1px solid #2d3148', borderRadius:8, padding:'10px 14px', minWidth:160 }}>
      <div style={{ fontSize:11, color:'#64748b', marginBottom:6 }}>{label}</div>
      {payload.map((p,i) => (
        <div key={i} style={{ display:'flex', justifyContent:'space-between', gap:16,
          fontSize:12, color:p.color, marginBottom:3 }}>
          <span>{p.name}</span>
          <span style={{ fontWeight:600 }}>{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function ComparePage({ wsData }) {
  const [selected, setSelected] = useState(['GC=F','SI=F'])
  const [period,   setPeriod]   = useState('3mo')
  const [data,     setData]     = useState({})
  const [loading,  setLoading]  = useState(false)
  const [normalize, setNormalize] = useState(false)
  const [addTicker, setAddTicker] = useState('HG=F')

  // Fetch history for all selected tickers
  useEffect(() => {
    if (!selected.length) return
    setLoading(true)
    Promise.all(selected.map(t => fetchHistory(t, period).then(r => ({ ticker:t, records:r.data.records||[] }))))
      .then(results => {
        const map = {}
        results.forEach(r => { map[r.ticker] = r.records })
        setData(map)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [selected, period])

  // Merge into unified date-keyed dataset
  const allDates = [...new Set(Object.values(data).flatMap(r => r.map(d => d.date)))].sort()
  const step     = Math.max(1, Math.floor(allDates.length / 60))
  const chartData = allDates.filter((_,i) => i % step === 0).map(date => {
    const row = { date: date.slice(5) }
    selected.forEach(ticker => {
      const rec    = (data[ticker] || []).find(r => r.date === date)
      const val    = rec?.display_close_inr ?? null
      const name   = ALL_TICKERS.find(t=>t.ticker===ticker)?.name || ticker

      if (normalize && val) {
        // Normalise to % change from first data point
        const first = (data[ticker]||[])[0]?.display_close_inr || val
        row[name] = parseFloat(((val - first) / first * 100).toFixed(2))
      } else {
        row[name] = val
      }
    })
    return row
  })

  const removeTicker = (t) => setSelected(s => s.filter(x => x !== t))
  const addSelected  = () => {
    if (!selected.includes(addTicker) && selected.length < 6) {
      setSelected(s => [...s, addTicker])
    }
  }

  return (
    <div>
      <div style={{ marginBottom:'1.5rem' }}>
        <h1 style={{ fontSize:22, fontWeight:700, color:'#e2e8f0' }}>Compare Commodities</h1>
        <p style={{ fontSize:13, color:'#64748b', marginTop:2 }}>
          Side-by-side price history · Up to 6 commodities · Prices in ₹
        </p>
      </div>

      {/* Controls */}
      <div className="card" style={{ marginBottom:'1.5rem' }}>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-end' }}>
          <div>
            <label style={{ fontSize:11, color:'#64748b', display:'block', marginBottom:4 }}>ADD COMMODITY</label>
            <div style={{ display:'flex', gap:8 }}>
              <select value={addTicker} onChange={e=>setAddTicker(e.target.value)}>
                {ALL_TICKERS.filter(t=>!selected.includes(t.ticker)).map(t=>(
                  <option key={t.ticker} value={t.ticker}>{t.name}</option>
                ))}
              </select>
              <button onClick={addSelected} disabled={selected.length>=6}
                style={{ padding:'8px 14px', background:'#6366f1', color:'#fff', border:'none',
                  borderRadius:8, fontWeight:600, fontSize:13, cursor:'pointer',
                  opacity:selected.length>=6?0.5:1, display:'flex', alignItems:'center', gap:6 }}>
                <Plus size={13}/> Add
              </button>
            </div>
          </div>
          <div>
            <label style={{ fontSize:11, color:'#64748b', display:'block', marginBottom:4 }}>PERIOD</label>
            <div style={{ display:'flex', gap:4 }}>
              {PERIODS.map(p=>(
                <button key={p} className={'tab-btn '+(period===p?'active':'')}
                  style={{ padding:'6px 12px', fontSize:12 }} onClick={()=>setPeriod(p)}>{p}</button>
              ))}
            </div>
          </div>
          <div style={{ marginLeft:'auto' }}>
            <label style={{ fontSize:11, color:'#64748b', display:'block', marginBottom:4 }}>CHART MODE</label>
            <div style={{ display:'flex', gap:4 }}>
              <button className={'tab-btn '+(normalize?'':'active')} style={{ padding:'6px 12px', fontSize:12 }} onClick={()=>setNormalize(false)}>Absolute ₹</button>
              <button className={'tab-btn '+(normalize?'active':'')} style={{ padding:'6px 12px', fontSize:12 }} onClick={()=>setNormalize(true)}>% Change</button>
            </div>
          </div>
        </div>

        {/* Selected chips */}
        <div style={{ display:'flex', gap:8, marginTop:'1rem', flexWrap:'wrap' }}>
          {selected.map((t,i) => {
            const meta = ALL_TICKERS.find(x=>x.ticker===t)
            const live = wsData.prices[t]
            return (
              <div key={t} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 12px',
                background:'#0f1117', border:`1px solid ${COLORS[i%COLORS.length]}40`,
                borderRadius:8, fontSize:12 }}>
                <div style={{ width:10, height:10, borderRadius:2, background:COLORS[i%COLORS.length] }}/>
                <span style={{ color:'#e2e8f0', fontWeight:500 }}>{meta?.name || t}</span>
                {live && <span style={{ color:COLORS[i%COLORS.length], fontWeight:600 }}>
                  {fmt(displayPrice(live))}
                </span>}
                <button onClick={()=>removeTicker(t)}
                  style={{ background:'none', border:'none', color:'#64748b', cursor:'pointer',
                    padding:0, display:'flex', lineHeight:1 }}>
                  <X size={12}/>
                </button>
              </div>
            )
          })}
          {selected.length < 6 && (
            <div style={{ fontSize:11, color:'#475569', display:'flex', alignItems:'center' }}>
              {6-selected.length} more slots available
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="card">
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
          <div style={{ fontSize:14, fontWeight:600, color:'#94a3b8' }}>
            {normalize ? 'NORMALISED % CHANGE' : 'ABSOLUTE PRICE (₹)'} · {period.toUpperCase()}
          </div>
          {loading && <span style={{ fontSize:12, color:'#64748b' }}>Loading...</span>}
        </div>

        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={380}>
            <LineChart data={chartData} margin={{ top:4, right:8, left:0, bottom:0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2235"/>
              <XAxis dataKey="date" tick={{ fontSize:10, fill:'#475569' }} interval="preserveStartEnd"/>
              <YAxis tick={{ fontSize:10, fill:'#475569' }}
                tickFormatter={v => normalize ? v.toFixed(1)+'%' : fmt(v)} width={normalize?50:80}/>
              <Tooltip content={<CustomTooltip />}/>
              <Legend wrapperStyle={{ fontSize:12, color:'#94a3b8', paddingTop:12 }}/>
              {selected.map((t,i) => {
                const name = ALL_TICKERS.find(x=>x.ticker===t)?.name || t
                return (
                  <Line key={t} type="monotone" dataKey={name}
                    stroke={COLORS[i%COLORS.length]} strokeWidth={2}
                    dot={false} connectNulls/>
                )
              })}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ height:380, display:'flex', alignItems:'center',
            justifyContent:'center', color:'#475569' }}>
            {loading ? 'Loading chart data...' : 'Select commodities to compare'}
          </div>
        )}
      </div>

      {/* Stats comparison table */}
      {!loading && Object.keys(data).length > 0 && (
        <div className="card" style={{ marginTop:16, padding:0, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', borderBottom:'1px solid #2d3148',
            fontSize:12, fontWeight:600, color:'#94a3b8', textTransform:'uppercase' }}>
            Statistics Comparison
          </div>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ borderBottom:'1px solid #2d3148' }}>
                {['Commodity','Current','Period High','Period Low','Period Change'].map(h=>(
                  <th key={h} style={{ padding:'10px 16px', textAlign:'left', fontSize:11,
                    color:'#64748b', fontWeight:600, textTransform:'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {selected.map((t,i) => {
                const recs     = data[t] || []
                const prices   = recs.map(r=>r.display_close_inr).filter(Boolean)
                const high     = Math.max(...prices)
                const low      = Math.min(...prices)
                const first    = prices[0]
                const last     = prices[prices.length-1]
                const chg      = first ? ((last-first)/first*100) : 0
                const name     = ALL_TICKERS.find(x=>x.ticker===t)?.name || t
                const live     = wsData.prices[t]
                return (
                  <tr key={t} style={{ borderBottom:'1px solid #1e2235' }}>
                    <td style={{ padding:'10px 16px' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <div style={{ width:10, height:10, borderRadius:2, background:COLORS[i%COLORS.length] }}/>
                        <span style={{ fontSize:13, fontWeight:600, color:'#e2e8f0' }}>{name}</span>
                      </div>
                    </td>
                    <td style={{ padding:'10px 16px', fontSize:13, fontWeight:700, color:'#e2e8f0' }}>
                      {live ? fmt(live.display_price ?? live.price_inr) : fmt(last)}
                    </td>
                    <td style={{ padding:'10px 16px', fontSize:13, color:'#22c55e' }}>{fmt(high)}</td>
                    <td style={{ padding:'10px 16px', fontSize:13, color:'#ef4444' }}>{fmt(low)}</td>
                    <td style={{ padding:'10px 16px' }}>
                      <span className={chg>=0?'badge-up':'badge-down'}>
                        {chg>=0?'+':''}{chg.toFixed(2)}%
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}