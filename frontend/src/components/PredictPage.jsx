import { useState, useEffect } from 'react'
import { fetchPrediction, fetchTodayPrediction, trainModel, fetchModelReady } from '../api/client'
import { Brain, Loader, TrendingUp, TrendingDown } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import toast from 'react-hot-toast'

import { CORE_COMMODITIES } from '../constants/commodities'

const TICKERS = CORE_COMMODITIES.map(({ ticker, name }) => ({ ticker, name }))

function fmt(n) {
  if (n >= 1e5) return '₹' + (n/1e5).toFixed(2) + 'L'
  return '₹' + (n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const px = d.chart_price ?? d.price_display_inr
  const ch = d.chart_chg ?? d.change_pct_display ?? d.change_pct
  return (
    <div style={{ background:'#1a1d27', border:'1px solid #2d3148', borderRadius:8, padding:'10px 14px' }}>
      <div style={{ fontSize:11, color:'#64748b' }}>{d.date}</div>
      <div style={{ fontSize:14, fontWeight:700, color:'#e2e8f0' }}>{fmt(px)}</div>
      <div style={{ fontSize:12, color: ch >= 0 ? '#22c55e' : '#ef4444' }}>
        {ch >= 0 ? '+' : ''}{Number(ch).toFixed(2)}%
      </div>
    </div>
  )
}

export default function PredictPage({ wsData }) {
  const [ticker,   setTicker]   = useState('GC=F')
  const [days,     setDays]     = useState(7)
  const [todayPred, setTodayPred] = useState(null)
  const [result,   setResult]   = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [training, setTraining] = useState(false)
  const [modelReady, setModelReady] = useState(false)

  const refreshModelReady = async (tickerSymbol) => {
    const r = await fetchModelReady(tickerSymbol)
    const ready = !!r.data.model_ready
    setModelReady(ready)
    return ready
  }

  useEffect(() => {
    refreshModelReady(ticker)
      .catch(() => setModelReady(false))
    setTodayPred(null)
    fetchTodayPrediction(ticker)
      .then((r) => setTodayPred(r.data))
      .catch(() => setTodayPred(null))
  }, [ticker])

  const handlePredict = async () => {
    setLoading(true); setResult(null)
    try {
      const r = await fetchPrediction(ticker, days)
      setResult(r.data)
      if (r.data?.today_prediction) {
        const tp = r.data.today_prediction
        setTodayPred({
          ok: true,
          ticker,
          predicted_price_display: tp.price_display_inr,
          change_pct: tp.change_pct_display ?? tp.change_pct,
          prediction_date: tp.date || r.data.prediction_date,
          model: r.data.model_type,
        })
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Prediction failed. Train the model once, then Predict is instant.')
    }
    setLoading(false)
  }

  const handleTrain = async () => {
    setTraining(true)
    try {
      await trainModel(ticker)
      toast.success('Training started (~2–5 min). Uses display units (₹/10g, ₹/kg…) — retrain once after price fixes.')
      let ready = false
      for (let attempt = 0; attempt < 30 && !ready; attempt += 1) {
        ready = await refreshModelReady(ticker)
        if (!ready) {
          await new Promise((resolve) => setTimeout(resolve, 10000))
        }
      }
      if (ready) {
        toast.success('Model saved and ready to predict.')
      }
    }
    catch { toast.error('Training failed to start') }
    setTraining(false)
  }

  const lp   = wsData.prices[ticker]
  const livePrice = lp ? (lp.display_price != null ? lp.display_price : lp.price_inr) : null
  const liveUnit  = lp ? (lp.display_unit || lp.unit || '') : ''
  const conf = result?.confidence || 0
  const cc   = conf > 65 ? '#22c55e' : conf > 45 ? '#f59e0b' : '#ef4444'
  const lastFc = result?.forecast?.[result.forecast.length - 1]
  const oc = lastFc != null ? (lastFc.change_pct_display ?? lastFc.change_pct) : null

  const baseRef = result?.last_price_display_inr ?? result?.last_price_inr
  const chartForecast = (() => {
    if (!result?.forecast?.length || baseRef == null) return []

    const series = [{
      date: 'Now',
      price_display_inr: baseRef,
      chart_price: baseRef,
      chart_chg: 0,
      isBase: true,
    }]

    let prevPrice = baseRef
    for (const f of result.forecast) {
      const currentPrice = f.price_display_inr
      const change = prevPrice ? ((currentPrice - prevPrice) / prevPrice) * 100 : 0
      series.push({
        ...f,
        chart_price: currentPrice,
        chart_chg: Number.isFinite(change) ? change : 0,
        estimate_chg: Number.isFinite(change) ? change : 0,
      })
      prevPrice = currentPrice
    }

    return series
  })()

  return (
    <div>
      <div style={{ marginBottom:'1.5rem' }}>
        <h1 style={{ fontSize:22, fontWeight:700, color:'#e2e8f0' }}>Commodity Price Predictions</h1>
        <p style={{ fontSize:13, color:'#64748b', marginTop:2 }}>
          Today&apos;s close forecast (auto) · Multi-day LSTM after one-time train
          {modelReady ? (
            <span style={{ color:'#22c55e', marginLeft:8 }}>✓ model saved for {ticker}</span>
          ) : (
            <span style={{ color:'#f59e0b', marginLeft:8 }}>— click Train Model once (new v3 format)</span>
          )}
        </p>
      </div>

      {todayPred?.ok && (
        <div className="card" style={{
          marginBottom:'1.5rem', padding:'14px 18px',
          borderLeft:'4px solid #6366f1',
          display:'flex', flexWrap:'wrap', gap:20, alignItems:'center',
        }}>
          <div>
            <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase' }}>Today&apos;s predicted close</div>
            <div style={{ fontSize:26, fontWeight:800, color:'#e2e8f0', marginTop:4 }}>
              {fmt(todayPred.predicted_price_display)}
              <span style={{ fontSize:13, color:'#64748b', marginLeft:8, fontWeight:500 }}>
                {todayPred.display_unit || liveUnit}
              </span>
            </div>
            <div style={{ fontSize:12, color:'#64748b', marginTop:4 }}>
              {TICKERS.find(t => t.ticker === ticker)?.name} · {todayPred.prediction_date}
              {todayPred.model && <span> · {todayPred.model}</span>}
            </div>
          </div>
          <div>
            <div style={{ fontSize:11, color:'#64748b' }}>vs last close</div>
            <div style={{
              fontSize:18, fontWeight:700,
              color: (todayPred.change_pct ?? 0) >= 0 ? '#22c55e' : '#ef4444',
            }}>
              {(todayPred.change_pct ?? 0) >= 0 ? '+' : ''}{Number(todayPred.change_pct ?? 0).toFixed(2)}%
            </div>
          </div>
          {livePrice != null && (
            <div>
              <div style={{ fontSize:11, color:'#64748b' }}>Live now</div>
              <div style={{ fontSize:16, fontWeight:600, color:'#94a3b8' }}>{fmt(livePrice)}</div>
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom:'1.5rem' }}>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-end' }}>
          <div style={{ flex:1, minWidth:160 }}>
            <label style={{ fontSize:11, color:'#64748b', display:'block', marginBottom:6 }}>COMMODITY</label>
            <select value={ticker} onChange={e => setTicker(e.target.value)} style={{ width:'100%' }}>
              {TICKERS.map(t => <option key={t.ticker} value={t.ticker}>{t.name} ({t.ticker})</option>)}
            </select>
          </div>
          <div style={{ minWidth:130 }}>
            <label style={{ fontSize:11, color:'#64748b', display:'block', marginBottom:6 }}>FORECAST DAYS</label>
            <select value={days} onChange={e => setDays(Number(e.target.value))} style={{ width:'100%' }}>
              {[1,3,5,7,10,14,21,30].map(d => (
                <option key={d} value={d}>{d === 1 ? '1 day (today)' : `${d} days`}</option>
              ))}
            </select>
          </div>
          <button onClick={handlePredict} disabled={loading}
            style={{ padding:'9px 20px', background:'#6366f1', color:'#fff', border:'none',
              borderRadius:8, fontWeight:600, fontSize:13, cursor:'pointer',
              opacity: loading ? 0.7 : 1, display:'flex', alignItems:'center', gap:8 }}>
            {loading ? <><Loader size={14} /> Predicting...</> : <><Brain size={14} /> Predict</>}
          </button>
          <button onClick={handleTrain} disabled={training}
            style={{ padding:'9px 20px', background:'transparent', color:'#94a3b8',
              border:'1px solid #2d3148', borderRadius:8, fontWeight:600, fontSize:13,
              cursor:'pointer', opacity: training ? 0.7 : 1 }}>
            {training ? 'Starting...' : '⚙ Train Model'}
          </button>
        </div>

        {lp && (
          <div style={{ marginTop:'1rem', padding:'10px 14px', background:'#0f1117',
            borderRadius:8, display:'flex', gap:24, flexWrap:'wrap' }}>
            <div>
              <div style={{ fontSize:11, color:'#64748b' }}>Live Price</div>
              <div style={{ fontSize:18, fontWeight:700, color:'#e2e8f0' }}>
                {fmt(livePrice)}
                <span style={{ fontSize:12, color:'#64748b', marginLeft:6 }}>{liveUnit}</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize:11, color:'#64748b' }}>24h Change</div>
              <div style={{ fontSize:14, fontWeight:600, color: lp.change_pct >= 0 ? '#22c55e' : '#ef4444' }}>
                {lp.change_pct >= 0 ? '+' : ''}{lp.change_pct?.toFixed(2)}%
              </div>
            </div>
            <div>
              <div style={{ fontSize:11, color:'#64748b' }}>USD/INR</div>
              <div style={{ fontSize:14, fontWeight:600, color:'#94a3b8' }}>₹{lp.usd_inr}</div>
            </div>
          </div>
        )}
      </div>

      {result && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 300px', gap:16 }}>
          <div className="card">
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'1rem' }}>
              <div>
                <div style={{ fontSize:15, fontWeight:700, color:'#e2e8f0' }}>
                  {TICKERS.find(t => t.ticker === ticker)?.name} — {days}-Day Forecast
                </div>
                <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>
                  Base: {fmt(result.last_price_display_inr ?? result.last_price_inr)}
                  {result.display_unit ? <span style={{ marginLeft: 6 }}>({result.display_unit})</span> : null}
                </div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:11, color:'#64748b' }}>Overall direction</div>
                <div style={{ fontSize:14, fontWeight:700, color: oc >= 0 ? '#22c55e' : '#ef4444',
                  display:'flex', alignItems:'center', gap:4, justifyContent:'flex-end' }}>
                  {oc >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {oc >= 0 ? '+' : ''}{oc?.toFixed(2)}%
                </div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartForecast} margin={{ top:4, right:8, left:0, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2235" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize:10, fill:'#475569' }}
                  tickFormatter={v => (v === 'Now' ? 'Now' : v?.slice(5))}
                />
                <YAxis tick={{ fontSize:10, fill:'#475569' }} tickFormatter={v => fmt(v)} width={80} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={baseRef} stroke="#475569" strokeDasharray="4 4"
                  label={{ value:'Now', fill:'#64748b', fontSize:10 }} />
                <Line type="monotone" dataKey="chart_price" stroke="#6366f1"
                  strokeWidth={2.5} dot={{ fill:'#6366f1', r:4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div className="card">
              <div style={{ fontSize:13, fontWeight:600, color:'#94a3b8', marginBottom:12 }}>CONFIDENCE</div>
              <div style={{ fontSize:36, fontWeight:800, color:cc, textAlign:'center', marginBottom:8 }}>{conf}%</div>
              <div className="prediction-bar" style={{ height:8 }}>
                <div style={{ width: conf + '%', background:cc, height:'100%', borderRadius:4 }} />
              </div>
              <div style={{ fontSize:11, color:'#475569', marginTop:8, textAlign:'center' }}>
                {conf > 65 ? 'High confidence' : conf > 45 ? 'Moderate — use caution' : 'Low — high volatility'}
              </div>
            </div>
            <div className="card" style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:600, color:'#94a3b8', marginBottom:12 }}>DAY-BY-DAY</div>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead>
                  <tr>{['Date','Price','Chg'].map(h => (
                    <th key={h} style={{ fontSize:10, color:'#475569', textAlign:'left',
                      padding:'4px 0', borderBottom:'1px solid #2d3148', textTransform:'uppercase' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {chartForecast.map((f, i) => {
                    const px = f.price_display_inr
                    const ch = f.change_pct_display ?? f.chart_chg ?? f.change_pct
                    const up = ch >= 0
                    return (
                      <tr key={i} style={{ borderBottom:'1px solid #1e2235' }}>
                        <td style={{ fontSize:11, color:'#94a3b8', padding:'7px 0' }}>{f.date?.slice(5)}</td>
                        <td style={{ fontSize:12, fontWeight:600, color:'#e2e8f0', padding:'7px 4px' }}>{fmt(px)}</td>
                        <td style={{ fontSize:11, color: up ? '#22c55e' : '#ef4444', padding:'7px 0' }}>
                          {up ? '+' : ''}{Number(ch).toFixed(1)}%
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {!result && !loading && (
        <div style={{ textAlign:'center', padding:'3rem', color:'#475569' }}>
          <Brain size={48} style={{ margin:'0 auto 1rem', opacity:0.3 }} />
          <div style={{ fontSize:15 }}>Select a commodity and click Predict</div>
          <div style={{ fontSize:12, marginTop:6 }}>Train each commodity once; then Predict reuses the saved model</div>
        </div>
      )}
    </div>
  )
}