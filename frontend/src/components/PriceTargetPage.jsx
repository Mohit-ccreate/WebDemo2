import { useState } from 'react'
import { fetchPrediction, trainModel } from '../api/client'
import { Target, Calendar, TrendingUp, TrendingDown, Brain, Loader } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts'
import toast from 'react-hot-toast'

import { CORE_COMMODITIES } from '../constants/commodities'

const DISPLAY_UNITS = {
  'GC=F': 'per 10g', 'SI=F': 'per kg', 'PL=F': 'per 10g', 'HG=F': 'per kg',
  'CL=F': 'per bbl', 'BZ=F': 'per bbl',
}
const TICKERS = CORE_COMMODITIES.map(({ ticker, name }) => ({
  ticker, name, unit: DISPLAY_UNITS[ticker] || 'per unit',
}))

/** First forecast day where price crosses target (not “already past” on day 1). */
function findTargetHitDay(forecast, baseline, targetPrice) {
  const base = Number(baseline)
  const tgt = Number(targetPrice)
  if (!forecast?.length || !Number.isFinite(base) || !Number.isFinite(tgt)) return null

  const eps = Math.max(base * 0.002, 1)
  const goingUp = tgt > base + eps
  const goingDown = tgt < base - eps
  if (!goingUp && !goingDown) return null

  for (let i = 0; i < forecast.length; i++) {
    const price = Number(forecast[i].display_inr)
    if (!Number.isFinite(price)) continue
    const prev = i === 0 ? base : Number(forecast[i - 1].display_inr)

    if (goingUp && prev < tgt - eps && price >= tgt - eps) return forecast[i]
    if (goingDown && prev > tgt + eps && price <= tgt + eps) return forecast[i]
  }
  return null
}

function fmtInr(n) {
  if (!n) return '—'
  if (n>=1e7) return '₹'+(n/1e7).toFixed(2)+' Cr'
  if (n>=1e5) return '₹'+(n/1e5).toFixed(2)+' L'
  if (n>=1000) return '₹'+n.toLocaleString('en-IN',{maximumFractionDigits:0})
  return '₹'+n.toFixed(2)
}

const CustomTooltip = ({active,payload,label,targetPrice}) => {
  if(!active||!payload?.length) return null
  const p = payload[0].value
  const hit = targetPrice && Math.abs(p-targetPrice)/targetPrice < 0.01
  return (
    <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:8,padding:'10px 14px'}}>
      <div style={{fontSize:11,color:'var(--text-muted)'}}>{label}</div>
      <div style={{fontSize:14,fontWeight:700,color:hit?'#f59e0b':'var(--text-primary)'}}>{fmtInr(p)}</div>
      {hit && <div style={{fontSize:11,color:'#f59e0b',marginTop:2}}>🎯 Near target!</div>}
    </div>
  )
}

export default function PriceTargetPage({wsData}) {
  const [ticker,      setTicker]      = useState('GC=F')
  const [targetInput, setTargetInput] = useState('')
  const [days,        setDays]        = useState(30)
  const [result,      setResult]      = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [training,    setTraining]    = useState(false)

  const meta       = TICKERS.find(t=>t.ticker===ticker)
  const liveRaw    = wsData.prices[ticker]
  const liveInr    = liveRaw?.display_price ?? null
  const targetPrice= parseFloat(targetInput) || null

  const analyze = async () => {
    if (!targetPrice) { toast.error('Enter a target price in ₹'); return }
    if (!liveInr)     { toast.error('Live price not loaded yet'); return }
    setLoading(true); setResult(null)
    try {
      const r = await fetchPrediction(ticker, days)
      setResult(r.data)
    } catch(e) {
      toast.error(e.response?.data?.detail||'Prediction failed. Try Train Model first.')
    }
    setLoading(false)
  }

  // Forecast in dashboard display units (price_display_inr from API)
  let targetAnalysis = null
  if (result && targetPrice && liveInr != null) {
    const lastDisp = Number(result.last_price_display_inr ?? liveInr)

    const forecastDisplay = result.forecast.map((f) => ({
      ...f,
      display_inr: Number(f.price_display_inr ?? f.price_inr),
    }))

    const eps = Math.max(lastDisp * 0.002, 1)
    const upward = targetPrice > lastDisp + eps
    const downward = targetPrice < lastDisp - eps
    const atTargetZone = !upward && !downward

    const hitDay = atTargetZone ? null : findTargetHitDay(forecastDisplay, lastDisp, targetPrice)

    const finalPrice = Number(forecastDisplay[forecastDisplay.length - 1]?.display_inr)
    let reachable = false
    if (atTargetZone) {
      reachable = true
    } else if (upward) {
      reachable = hitDay != null || (!Number.isNaN(finalPrice) && finalPrice >= targetPrice - eps)
    } else if (downward) {
      reachable = hitDay != null || (!Number.isNaN(finalPrice) && finalPrice <= targetPrice + eps)
    }

    const direction = upward ? 'up' : downward ? 'down' : 'flat'
    const gap = Math.abs(targetPrice - lastDisp)
    const gapPct = lastDisp ? ((gap / lastDisp) * 100).toFixed(2) : '0'

    const hitDayIndex = hitDay ? forecastDisplay.indexOf(hitDay) + 1 : null

    targetAnalysis = {
      hitDay,
      hitDayIndex,
      reachable,
      direction,
      gap,
      gapPct,
      forecastDisplay,
      finalPrice,
      lastDisp,
      atTargetZone,
    }
  }

  return (
    <div>
      <div style={{marginBottom:'1.5rem'}}>
        <h1 style={{fontSize:22,fontWeight:700,color:'var(--text-primary)'}}>Price Target Calculator</h1>
        <p style={{fontSize:13,color:'var(--text-muted)',marginTop:2}}>
          Set a target price → LSTM predicts when (and if) it will be reached
        </p>
      </div>

      {/* Input form */}
      <div className="card" style={{marginBottom:'1.5rem'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr auto auto',gap:12,alignItems:'flex-end',flexWrap:'wrap'}}>
          <div>
            <label style={{fontSize:11,color:'var(--text-muted)',display:'block',marginBottom:6}}>COMMODITY</label>
            <select value={ticker} onChange={e=>{setTicker(e.target.value);setResult(null)}} style={{width:'100%'}}>
              {TICKERS.map(t=><option key={t.ticker} value={t.ticker}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{fontSize:11,color:'var(--text-muted)',display:'block',marginBottom:6}}>
              TARGET PRICE (₹ {meta?.unit})
            </label>
            <input type="number" placeholder={liveInr?`Current: ${fmtInr(liveInr)}`:'Enter target ₹'}
              value={targetInput} onChange={e=>setTargetInput(e.target.value)} style={{width:'100%'}}/>
          </div>
          <div>
            <label style={{fontSize:11,color:'var(--text-muted)',display:'block',marginBottom:6}}>FORECAST DAYS</label>
            <select value={days} onChange={e=>setDays(Number(e.target.value))} style={{width:'100%'}}>
              {[7,14,21,30].map(d=><option key={d} value={d}>{d} days</option>)}
            </select>
          </div>
          <button onClick={analyze} disabled={loading}
            style={{padding:'9px 18px',background:'#6366f1',color:'#fff',border:'none',
              borderRadius:8,fontWeight:600,fontSize:13,cursor:'pointer',
              opacity:loading?0.7:1,display:'flex',alignItems:'center',gap:8,whiteSpace:'nowrap'}}>
            {loading?<><Loader size={14}/>Analyzing...</>:<><Target size={14}/>Calculate</>}
          </button>
          <button onClick={async()=>{setTraining(true);try{await trainModel(ticker);toast.success('Training started!')}catch{toast.error('Failed')}setTraining(false)}}
            disabled={training}
            style={{padding:'9px 14px',background:'transparent',color:'var(--text-secondary)',
              border:'1px solid var(--border)',borderRadius:8,fontWeight:600,fontSize:13,
              cursor:'pointer',whiteSpace:'nowrap',opacity:training?0.7:1}}>
            {training?'Starting...':'⚙ Train'}
          </button>
        </div>

        {/* Live price strip */}
        {liveRaw && (
          <div style={{marginTop:'1rem',padding:'10px 14px',background:'var(--bg-primary)',
            borderRadius:8,display:'flex',gap:24,flexWrap:'wrap'}}>
            <div>
              <div style={{fontSize:11,color:'var(--text-muted)'}}>Current Price ({meta?.unit})</div>
              <div style={{fontSize:18,fontWeight:700,color:'var(--text-primary)'}}>{fmtInr(liveInr)}</div>
            </div>
            {targetPrice && liveInr && (
              <>
                <div>
                  <div style={{fontSize:11,color:'var(--text-muted)'}}>Gap to Target</div>
                  <div style={{fontSize:16,fontWeight:700,color:targetPrice>liveInr?'#22c55e':'#ef4444'}}>
                    {targetPrice>liveInr?'+':'-'}{fmtInr(Math.abs(targetPrice-liveInr))}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:11,color:'var(--text-muted)'}}>Gap %</div>
                  <div style={{fontSize:16,fontWeight:700,color:targetPrice>liveInr?'#22c55e':'#ef4444'}}>
                    {targetPrice>liveInr?'+':''}{((targetPrice-liveInr)/liveInr*100).toFixed(2)}%
                  </div>
                </div>
              </>
            )}
            <div>
              <div style={{fontSize:11,color:'var(--text-muted)'}}>USD/INR</div>
              <div style={{fontSize:14,fontWeight:600,color:'var(--text-secondary)'}}>₹{liveRaw.usd_inr}</div>
            </div>
          </div>
        )}
      </div>

      {/* Result */}
      {result && targetAnalysis && (
        <>
          {/* Verdict card */}
          <div className="card" style={{marginBottom:'1.5rem',
            borderColor: targetAnalysis.reachable?'rgba(34,197,94,0.4)':'rgba(239,68,68,0.4)',
            background:  targetAnalysis.reachable?'rgba(34,197,94,0.05)':'rgba(239,68,68,0.05)'}}>
            <div style={{display:'flex',gap:16,alignItems:'center',flexWrap:'wrap'}}>
              <div style={{fontSize:40}}>
                {targetAnalysis.reachable?'🎯':'❌'}
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:18,fontWeight:700,
                  color:targetAnalysis.reachable?'#22c55e':'#ef4444',marginBottom:6}}>
                  {targetAnalysis.reachable
                    ? targetAnalysis.atTargetZone
                      ? `Target is already near the model baseline (₹${fmtInr(targetAnalysis.lastDisp)}).`
                      : targetAnalysis.hitDay
                        ? `Target may be reached around day ${targetAnalysis.hitDayIndex} (${targetAnalysis.hitDay.date})`
                        : `Target may be reached by day ${days} (final forecast ₹${fmtInr(targetAnalysis.finalPrice)})`
                    : `Target NOT reachable within ${days} days`}
                </div>
                <div style={{fontSize:13,color:'var(--text-secondary)'}}>
                  {targetAnalysis.reachable
                      ? targetAnalysis.atTargetZone
                      ? 'Adjust the target or horizon — current level already matches the baseline.'
                      : `LSTM predicts ${meta?.name} may ${
                          targetAnalysis.direction === 'up'
                            ? 'rise toward'
                            : targetAnalysis.direction === 'down'
                              ? 'fall toward'
                              : 'stay near'
                        } ₹${fmtInr(targetPrice)} from baseline ₹${fmtInr(targetAnalysis.lastDisp)} (${targetAnalysis.gapPct}% gap).`
                    : `Forecast ends near ₹${fmtInr(targetAnalysis.finalPrice)} vs target ₹${fmtInr(targetPrice)}.`}
                </div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:11,color:'var(--text-muted)'}}>Model Confidence</div>
                <div style={{fontSize:28,fontWeight:800,
                  color:result.confidence>65?'#22c55e':result.confidence>45?'#f59e0b':'#ef4444'}}>
                  {result.confidence}%
                </div>
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="card">
            <div style={{fontSize:14,fontWeight:600,color:'var(--text-secondary)',marginBottom:'1rem'}}>
              {meta?.name} — {days}-DAY PRICE FORECAST vs TARGET
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={targetAnalysis.forecastDisplay} margin={{top:8,right:16,left:0,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
                <XAxis dataKey="date" tick={{fontSize:10,fill:'var(--text-muted)'}} tickFormatter={v=>v?.slice(5)}/>
                <YAxis tick={{fontSize:10,fill:'var(--text-muted)'}} tickFormatter={v=>fmtInr(v)} width={90}/>
                <Tooltip content={<CustomTooltip targetPrice={targetPrice}/>}/>
                {/* Target price line */}
                {targetPrice && (
                  <ReferenceLine y={targetPrice} stroke="#f59e0b" strokeDasharray="6 3" strokeWidth={2}
                    label={{value:`Target: ${fmtInr(targetPrice)}`,fill:'#f59e0b',fontSize:11,position:'insideTopRight'}}/>
                )}
                {/* Current price line */}
                {liveInr && (
                  <ReferenceLine y={liveInr} stroke="var(--border-strong)" strokeDasharray="4 4"
                    label={{value:'Live',fill:'var(--text-muted)',fontSize:10}}/>
                )}
                {result?.last_price_display_inr != null && Math.abs(result.last_price_display_inr - liveInr) > (liveInr * 0.02) && (
                  <ReferenceLine y={result.last_price_display_inr} stroke="#6366f1" strokeDasharray="3 3"
                    label={{value:'Model base',fill:'#6366f1',fontSize:10}}/>
                )}
                {/* Target zone highlight */}
                {targetPrice && liveInr && (
                  <ReferenceArea
                    y1={Math.min(targetPrice,liveInr)}
                    y2={Math.max(targetPrice,liveInr)}
                    fill={targetAnalysis.direction==='up'?'#22c55e':'#ef4444'}
                    fillOpacity={0.05}/>
                )}
                <Line type="monotone" dataKey="display_inr" name={meta?.name}
                  stroke="#6366f1" strokeWidth={2.5} dot={{fill:'#6366f1',r:3}}/>
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Day-by-day table */}
          <div className="card" style={{marginTop:16,padding:0,overflow:'hidden'}}>
            <div style={{padding:'12px 16px',borderBottom:'1px solid var(--border)',
              fontSize:12,fontWeight:600,color:'var(--text-muted)'}}>
              DAY-BY-DAY FORECAST
            </div>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr style={{borderBottom:'1px solid var(--border)'}}>
                  {['Day','Date','Predicted Price','vs Target','Change %','Status'].map(h=>(
                    <th key={h} style={{padding:'9px 14px',textAlign:'left',fontSize:11,
                      color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {targetAnalysis.forecastDisplay.map((f,i)=>{
                  const vsTarget = targetPrice ? f.display_inr - targetPrice : null
                  const hit      = targetAnalysis.hitDay && f.date === targetAnalysis.hitDay.date
                  const up       = f.change_pct >= 0
                  return (
                    <tr key={i} style={{borderBottom:'1px solid var(--bg-hover)',
                      background:hit?'rgba(245,158,11,0.08)':'transparent'}}
                      onMouseEnter={e=>e.currentTarget.style.background=hit?'rgba(245,158,11,0.12)':'var(--bg-hover)'}
                      onMouseLeave={e=>e.currentTarget.style.background=hit?'rgba(245,158,11,0.08)':'transparent'}>
                      <td style={{padding:'9px 14px',fontSize:12,color:'var(--text-muted)'}}>Day {i+1}</td>
                      <td style={{padding:'9px 14px',fontSize:12,color:'var(--text-primary)'}}>{f.date}</td>
                      <td style={{padding:'9px 14px',fontWeight:700,color:hit?'#f59e0b':'var(--text-primary)'}}>
                        {fmtInr(f.display_inr)}
                      </td>
                      <td style={{padding:'9px 14px',fontSize:12,
                        color:vsTarget>0?'#22c55e':vsTarget<0?'#ef4444':'#f59e0b'}}>
                        {vsTarget===null?'—':vsTarget>0?'+':''}{vsTarget?fmtInr(Math.abs(vsTarget)):''} {vsTarget>0?'above':'below'} target
                      </td>
                      <td style={{padding:'9px 14px'}}>
                        <span className={up?'badge-up':'badge-down'}>
                          {up?'▲':'▼'} {Math.abs(f.change_pct||0).toFixed(2)}%
                        </span>
                      </td>
                      <td style={{padding:'9px 14px',fontSize:12}}>
                        {hit ? <span style={{color:'#f59e0b',fontWeight:600}}>🎯 Target zone!</span>
                             : vsTarget>0 ? <span style={{color:'#22c55e'}}>Above target</span>
                             : <span style={{color:'#ef4444'}}>Below target</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!result && !loading && (
        <div className="card" style={{textAlign:'center',padding:'3rem',color:'var(--text-muted)'}}>
          <Target size={48} style={{margin:'0 auto 1rem',opacity:0.3}}/>
          <div style={{fontSize:15}}>Enter a target price and click Calculate</div>
          <div style={{fontSize:12,marginTop:6}}>
            Example: Gold target ₹1,60,000/10g → see if LSTM thinks it will get there in 30 days
          </div>
        </div>
      )}
    </div>
  )
}