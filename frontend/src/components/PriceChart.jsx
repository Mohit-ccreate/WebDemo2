import { useState, useEffect } from 'react'
import { fetchHistory } from '../api/client'
import { X } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { displayPrice } from '../constants/commodities'

const PERIODS = ['1mo','3mo','6mo','1y','2y']
function fmt(n) {
  if (n >= 1e5) return '₹' + (n/1e5).toFixed(1) + 'L'
  return '₹' + (n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{ background:'#1a1d27', border:'1px solid #2d3148', borderRadius:8, padding:'10px 14px' }}>
      <div style={{ fontSize:11, color:'#64748b' }}>{d.date}</div>
      <div style={{ fontSize:14, fontWeight:700, color:'#e2e8f0' }}>{fmt(d.display_close_inr)}</div>
    </div>
  )
}

export default function PriceChart({ ticker, name, onClose, liveQuote }) {
  const [data,    setData]    = useState([])
  const [period,  setPeriod]  = useState('3mo')
  const [unit,    setUnit]    = useState('')
  const [liveNow, setLiveNow] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchHistory(ticker, period)
      .then(r => {
        const raw = r.data.records || []
        const records = raw.map((d) => ({
          ...d,
          // Never fall back to close_inr — that is contract-unit INR (e.g. ₹/lb), not dashboard units
          display_close_inr: d.display_close_inr,
        })).filter((d) => d.display_close_inr != null && !Number.isNaN(d.display_close_inr))
        setUnit(r.data.display_unit || '')
        setLiveNow(r.data.live_display_price ?? displayPrice(liveQuote) ?? null)
        setData(records)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [ticker, period])

  const prices  = data.map(d => d.display_close_inr).filter((v) => v != null && !Number.isNaN(v))
  const first   = prices[0], last = prices[prices.length - 1]
  const change  = first ? ((last - first) / first * 100).toFixed(2) : 0
  const isUp    = change >= 0
  const step    = Math.max(1, Math.floor(data.length / 60))
  const display = data.filter((_, i) => i % step === 0)

  return (
    <div className="card">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
        <div>
          <div style={{ fontSize:16, fontWeight:700, color:'#e2e8f0' }}>{name} — Price History</div>
          <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>
            {unit ? <span style={{ marginRight: 8 }}>{unit} ·</span> : null}
            Same units as dashboard
            {liveNow != null && (
              <span style={{ marginLeft: 8, color: '#94a3b8' }}>
                · Live now <strong style={{ color: '#e2e8f0' }}>{fmt(liveNow)}</strong>
              </span>
            )}
            <span style={{ marginLeft: 8 }}>
              · {period} change:{' '}
              <span style={{ color: isUp ? '#22c55e' : '#ef4444', fontWeight:600 }}>
                {isUp ? '+' : ''}{change}%
              </span>
            </span>
          </div>
        </div>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          {PERIODS.map(p => (
            <button key={p} className={'tab-btn ' + (period === p ? 'active' : '')}
              style={{ padding:'4px 10px', fontSize:12 }} onClick={() => setPeriod(p)}>{p}</button>
          ))}
          {onClose && (
            <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer',
              color:'#64748b', padding:4, display:'flex' }}><X size={18} /></button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ height:260, display:'flex', alignItems:'center',
          justifyContent:'center', color:'#64748b' }}>Loading chart...</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={display} margin={{ top:4, right:4, left:0, bottom:0 }}>
            <defs>
              <linearGradient id={'g' + ticker} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={isUp ? '#22c55e' : '#ef4444'} stopOpacity={0.25} />
                <stop offset="95%" stopColor={isUp ? '#22c55e' : '#ef4444'} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2235" />
            <XAxis dataKey="date" tick={{ fontSize:10, fill:'#475569' }}
              tickFormatter={v => v?.slice(5)} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize:10, fill:'#475569' }} tickFormatter={v => fmt(v)} width={72} />
            <Tooltip content={<CustomTooltip />} />
            {liveNow != null && (
              <ReferenceLine y={liveNow} stroke="#6366f1" strokeDasharray="4 4"
                label={{ value: 'Live', fill: '#818cf8', fontSize: 10, position: 'insideTopRight' }} />
            )}
            <Area type="monotone" dataKey="display_close_inr"
              stroke={isUp ? '#22c55e' : '#ef4444'} strokeWidth={2}
              fill={'url(#g' + ticker + ')'} dot={false}
              connectNulls={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}