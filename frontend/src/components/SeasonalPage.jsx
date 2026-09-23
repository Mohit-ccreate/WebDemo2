import { useState, useEffect } from 'react'
import { fetchHistory } from '../api/client'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'

import { CORE_COMMODITIES } from '../constants/commodities'

const TICKERS = CORE_COMMODITIES.map(({ ticker, name }) => ({ ticker, name }))
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function calcSeasonality(records) {
  // Group daily returns by month, average them
  const monthly = Array(12).fill(null).map(() => [])
  for (let i = 1; i < records.length; i++) {
    const prev  = records[i-1].display_close_inr ?? records[i-1].close_inr
    const curr  = records[i].display_close_inr ?? records[i].close_inr
    if (!prev || !curr) continue
    const ret   = (curr - prev) / prev * 100
    const month = new Date(records[i].date).getMonth()
    monthly[month].push(ret)
  }
  return monthly.map((returns, m) => ({
    month:    MONTHS[m],
    avg_ret:  returns.length ? parseFloat((returns.reduce((s,r)=>s+r,0)/returns.length).toFixed(3)) : 0,
    positive: returns.filter(r=>r>0).length,
    negative: returns.filter(r=>r<0).length,
    count:    returns.length,
    win_rate: returns.length ? Math.round(returns.filter(r=>r>0).length/returns.length*100) : 0,
  }))
}

const CustomTooltip = ({active,payload,label}) => {
  if (!active||!payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:8,padding:'10px 14px'}}>
      <div style={{fontWeight:600,color:'var(--text-primary)',marginBottom:6}}>{label}</div>
      <div style={{fontSize:12,color:d.avg_ret>=0?'#22c55e':'#ef4444'}}>Avg return: {d.avg_ret>=0?'+':''}{d.avg_ret?.toFixed(2)}%</div>
      <div style={{fontSize:12,color:'var(--text-secondary)'}}>Win rate: {d.win_rate}%</div>
      <div style={{fontSize:11,color:'var(--text-muted)'}}>{d.positive} up / {d.negative} down days</div>
    </div>
  )
}

export default function SeasonalPage() {
  const [ticker,   setTicker]   = useState('GC=F')
  const [data,     setData]     = useState([])
  const [loading,  setLoading]  = useState(false)
  const [period,   setPeriod]   = useState('5y')

  useEffect(() => {
    setLoading(true)
    fetchHistory(ticker, period)
      .then(r => {
        const seasonal = calcSeasonality(r.data.records || [])
        setData(seasonal)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [ticker, period])

  const name    = TICKERS.find(t=>t.ticker===ticker)?.name || ticker
  const bestM   = data.length ? [...data].sort((a,b)=>b.avg_ret-a.avg_ret)[0] : null
  const worstM  = data.length ? [...data].sort((a,b)=>a.avg_ret-b.avg_ret)[0] : null
  const bullish = data.filter(d=>d.avg_ret>0).length
  const bearish = data.filter(d=>d.avg_ret<0).length

  return (
    <div>
      <div style={{marginBottom:'1.5rem'}}>
        <h1 style={{fontSize:22,fontWeight:700,color:'var(--text-primary)'}}>Seasonal Analysis</h1>
        <p style={{fontSize:13,color:'var(--text-muted)',marginTop:2}}>
          Historical monthly performance · Which months are best &amp; worst for each commodity
        </p>
      </div>

      {/* Controls */}
      <div className="card" style={{marginBottom:'1.5rem',display:'flex',gap:16,flexWrap:'wrap',alignItems:'flex-end'}}>
        <div style={{flex:1,minWidth:180}}>
          <label style={{fontSize:11,color:'var(--text-muted)',display:'block',marginBottom:6}}>COMMODITY</label>
          <select value={ticker} onChange={e=>setTicker(e.target.value)} style={{width:'100%'}}>
            {TICKERS.map(t=><option key={t.ticker} value={t.ticker}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label style={{fontSize:11,color:'var(--text-muted)',display:'block',marginBottom:6}}>HISTORY</label>
          <div style={{display:'flex',gap:4}}>
            {['2y','5y'].map(p=>(
              <button key={p} className={'tab-btn '+(period===p?'active':'')}
                style={{padding:'6px 14px',fontSize:12}} onClick={()=>setPeriod(p)}>{p}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      {data.length > 0 && (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12,marginBottom:'1.5rem'}}>
          {[
            {label:'Best Month',    value:bestM?.month,   sub:`+${bestM?.avg_ret?.toFixed(2)}% avg`,  color:'#22c55e'},
            {label:'Worst Month',   value:worstM?.month,  sub:`${worstM?.avg_ret?.toFixed(2)}% avg`,  color:'#ef4444'},
            {label:'Bullish Months',value:bullish,         sub:'historically positive',                color:'#22c55e'},
            {label:'Bearish Months',value:bearish,         sub:'historically negative',                color:'#ef4444'},
            {label:'Best Win Rate', value:bestM?.win_rate+'%', sub:`in ${bestM?.month}`,              color:'#6366f1'},
          ].map((s,i)=>(
            <div key={i} className="card" style={{padding:'14px 16px'}}>
              <div style={{fontSize:11,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:4}}>{s.label}</div>
              <div style={{fontSize:20,fontWeight:700,color:s.color}}>{s.value}</div>
              <div style={{fontSize:11,color:s.color,marginTop:2}}>{s.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Bar chart */}
      <div className="card" style={{marginBottom:'1.5rem'}}>
        <div style={{fontSize:14,fontWeight:600,color:'var(--text-secondary)',marginBottom:'1rem'}}>
          {name} — AVERAGE MONTHLY RETURN ({period} history)
        </div>
        {loading ? (
          <div style={{height:280,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-muted)'}}>
            Calculating seasonality...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data} margin={{top:4,right:8,left:0,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
              <XAxis dataKey="month" tick={{fontSize:11,fill:'var(--text-muted)'}}/>
              <YAxis tick={{fontSize:11,fill:'var(--text-muted)'}} tickFormatter={v=>v.toFixed(1)+'%'}/>
              <Tooltip content={<CustomTooltip/>}/>
              <ReferenceLine y={0} stroke="var(--border-strong)" strokeWidth={1.5}/>
              <Bar dataKey="avg_ret" radius={[4,4,0,0]}>
                {data.map((d,i)=>(
                  <Cell key={i} fill={d.avg_ret>=0?'#22c55e':'#ef4444'} fillOpacity={0.85}/>
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Win rate table */}
      {data.length > 0 && (
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <div style={{padding:'12px 16px',borderBottom:'1px solid var(--border)',fontSize:12,fontWeight:600,color:'var(--text-muted)'}}>
            MONTHLY BREAKDOWN — {name}
          </div>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead>
              <tr style={{borderBottom:'1px solid var(--border)'}}>
                {['Month','Avg Return','Win Rate','Up Days','Down Days','Verdict'].map(h=>(
                  <th key={h} style={{padding:'10px 14px',textAlign:'left',fontSize:11,color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d,i)=>{
                const good = d.avg_ret > 0.3
                const bad  = d.avg_ret < -0.3
                const neutral = !good && !bad
                return (
                  <tr key={i} style={{borderBottom:'1px solid var(--bg-hover)'}}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--bg-hover)'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <td style={{padding:'10px 14px',fontWeight:600,color:'var(--text-primary)'}}>{d.month}</td>
                    <td style={{padding:'10px 14px'}}>
                      <span style={{color:d.avg_ret>=0?'#22c55e':'#ef4444',fontWeight:600}}>
                        {d.avg_ret>=0?'+':''}{d.avg_ret?.toFixed(2)}%
                      </span>
                    </td>
                    <td style={{padding:'10px 14px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{width:60,height:6,background:'var(--border)',borderRadius:3,overflow:'hidden'}}>
                          <div style={{width:d.win_rate+'%',height:'100%',background:d.win_rate>50?'#22c55e':'#ef4444',borderRadius:3}}/>
                        </div>
                        <span style={{fontSize:12,color:'var(--text-secondary)'}}>{d.win_rate}%</span>
                      </div>
                    </td>
                    <td style={{padding:'10px 14px',fontSize:12,color:'#22c55e'}}>{d.positive}</td>
                    <td style={{padding:'10px 14px',fontSize:12,color:'#ef4444'}}>{d.negative}</td>
                    <td style={{padding:'10px 14px'}}>
                      {good    && <span className="badge-up">📈 Bullish</span>}
                      {bad     && <span className="badge-down">📉 Bearish</span>}
                      {neutral && <span style={{fontSize:11,color:'var(--text-muted)'}}>— Neutral</span>}
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