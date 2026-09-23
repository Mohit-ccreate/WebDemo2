import { useState, useEffect, useCallback } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, ComposedChart, Area,
} from 'recharts'
import { Activity, RefreshCw, Cpu } from 'lucide-react'
import toast from 'react-hot-toast'
import { fetchStockIndicators, fetchStockQuote, fetchStockPipeline, fetchFusionPredictionHistory } from '../api/client'
import FusionModelPanel from './FusionModelPanel'

/** API may send RSI/MACD keys; cards expect rsi/macd (series already uses lowercase). */
function normalizeLatest(snap) {
  if (!snap) return null
  const g = (...keys) => keys.reduce((v, k) => (v != null ? v : snap[k]), null)
  return {
    close: g('close', 'Close'),
    volume: g('volume', 'Volume'),
    rsi: g('rsi', 'RSI'),
    macd: g('macd', 'MACD'),
    macd_signal: g('macd_signal', 'MACD_signal'),
    bb_upper: g('bb_upper', 'BB_upper'),
    bb_mid: g('bb_mid', 'BB_mid'),
    bb_lower: g('bb_lower', 'BB_lower'),
    sma_20: g('sma_20', 'SMA_20'),
    sma_50: g('sma_50', 'SMA_50'),
    support: g('support'),
    resistance: g('resistance'),
  }
}

function fmt(n) {
  if (n == null || Number.isNaN(n)) return '—'
  if (Math.abs(n) >= 1e7) return (n / 1e7).toFixed(2) + ' Cr'
  if (Math.abs(n) >= 1e5) return (n / 1e5).toFixed(2) + ' L'
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
  return Number(n).toFixed(4)
}

function Card({ title, value, sub }) {
  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export default function StocksIndicatorsPage() {
  const [symbol, setSymbol] = useState('AAPL')
  const [quote, setQuote] = useState(null)
  const [latest, setLatest] = useState(null)
  const [series, setSeries] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [pipeline, setPipeline] = useState(null)
  const [pipeLoading, setPipeLoading] = useState(false)
  const [predHistory, setPredHistory] = useState(null)
  const [fusionBundle, setFusionBundle] = useState(null)

  const load = useCallback(async () => {
    const sym = symbol.trim().toUpperCase()
    if (!sym) return
    setLoading(true)
    setLoadError(null)
    try {
      const [q, ind] = await Promise.all([
        fetchStockQuote(sym),
        fetchStockIndicators(sym, '1y'),
      ])
      setQuote(q.data)
      setLatest(normalizeLatest(ind.data.latest) || {})
      setSeries(ind.data.series || [])
    } catch (e) {
      const msg = e.response?.data?.detail || 'Failed to load stock data'
      setLoadError(typeof msg === 'string' ? msg : JSON.stringify(msg))
      toast.error(msg)
      setQuote(null)
      setLatest(null)
      setSeries([])
    }
    setLoading(false)
  }, [symbol])

  const loadPipeline = useCallback(async () => {
    const sym = symbol.trim().toUpperCase()
    if (!sym) return
    setPipeLoading(true)
    setPipeline(null)
    try {
      const r = await fetchStockPipeline(sym)
      setPipeline(r.data)
      setPredHistory(r.data?.prediction_history || null)
      setFusionBundle({
        fusion: r.data?.models?.sentiment_plus_price,
        sentiment: r.data?.models?.sentiment,
        prediction_history: r.data?.prediction_history,
        ok: r.data?.models?.sentiment_plus_price?.ok,
      })
      if (r.data?.ok === false) {
        toast.error(r.data.error || 'Pipeline could not complete — see details below')
      }
    } catch (e) {
      const msg = e.response?.data?.detail || e.message || 'Pipeline request failed'
      toast.error(typeof msg === 'string' ? msg : 'Pipeline request failed')
      setPipeline(null)
    }
    setPipeLoading(false)
  }, [symbol])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const sym = symbol.trim().toUpperCase()
    if (!sym) return
    fetchFusionPredictionHistory(sym)
      .then((r) => setPredHistory(r.data))
      .catch(() => setPredHistory(null))
  }, [symbol])

  useEffect(() => {
    const id = setInterval(() => {
      load()
    }, 60000)
    return () => clearInterval(id)
  }, [load])

  const chartData = series.map((r) => ({
    ...r,
    dateShort: r.date?.slice(5) || r.date,
  }))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Stocks · Indicators</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            Real-time quote (yfinance) · RSI, Volume, MA, MACD, Bollinger Bands, Support / Resistance
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={load} disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: 'transparent',
              color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Refresh
          </button>
          <button type="button" onClick={loadPipeline} disabled={pipeLoading}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: 'rgba(99,102,241,0.12)',
              color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.35)', borderRadius: 8, cursor: 'pointer' }}>
            <Cpu size={14} style={{ animation: pipeLoading ? 'spin 1s linear infinite' : 'none' }} />
            {pipeLoading ? 'Running…' : 'ML pipeline (~30s)'}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>SYMBOL</label>
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            onBlur={load}
            style={{ width: '100%', textTransform: 'uppercase' }} placeholder="e.g. AAPL" />
        </div>
        <button type="button" onClick={load} className="tab-btn active" style={{ padding: '9px 18px' }}>Load</button>
      </div>

      <FusionModelPanel
        symbol={symbol}
        fusionBundle={fusionBundle}
        predHistory={predHistory}
        onFusionUpdate={(data) => {
          setFusionBundle(data)
          setPredHistory(data?.prediction_history || null)
        }}
      />

      {quote && (
        <div className="card" style={{ marginBottom: '1rem', padding: '12px 16px', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Last close</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(quote.last_close ?? quote.last_price)}</div>
          </div>
          {quote.asof && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>As of</div>
              <div style={{ fontSize: 14 }}>{quote.asof}</div>
            </div>
          )}
        </div>
      )}

      {latest && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 10,
          marginBottom: '1.25rem',
        }}>
          <Card title="RSI (14)" value={fmt(latest.rsi)} sub={'>70 overbought · <30 oversold'} />
          <Card title="Volume" value={fmt(latest.volume)} sub="Latest session" />
          <Card title="Moving averages" value={`SMA20 ${fmt(latest.sma_20)}`} sub={`SMA50 ${fmt(latest.sma_50)}`} />
          <Card title="MACD" value={fmt(latest.macd)} sub={`Signal ${fmt(latest.macd_signal)}`} />
          <Card title="Bollinger" value={`Mid ${fmt(latest.bb_mid)}`} sub={`↑${fmt(latest.bb_upper)} · ↓${fmt(latest.bb_lower)}`} />
          <Card title="Support / Resistance" value={`S ${fmt(latest.support)}`} sub={`R ${fmt(latest.resistance)}`} />
        </div>
      )}

      {chartData.length > 0 && (
        <div className="card" style={{ padding: '14px 16px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Activity size={16} color="#6366f1" />
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>Price &amp; bands</span>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="dateShort" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis yAxisId="L" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={['auto', 'auto']} width={56} />
              <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="L" type="monotone" dataKey="close" name="Close" stroke="#e2e8f0" dot={false} strokeWidth={1.5} />
              <Area yAxisId="L" type="monotone" dataKey="bb_upper" name="BB upper" stroke="#64748b" fill="#33415522" strokeWidth={1} />
              <Area yAxisId="L" type="monotone" dataKey="bb_lower" name="BB lower" stroke="#64748b" fill="#33415522" strokeWidth={1} />
              <Line yAxisId="L" type="monotone" dataKey="bb_mid" name="BB mid" stroke="#94a3b8" dot={false} strokeWidth={1} />
              <Line yAxisId="L" type="monotone" dataKey="sma_20" name="SMA20" stroke="#22c55e" dot={false} strokeWidth={1.2} />
              <Line yAxisId="L" type="monotone" dataKey="sma_50" name="SMA50" stroke="#f59e0b" dot={false} strokeWidth={1.2} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {chartData.length > 0 && (
        <div className="card" style={{ marginTop: '1rem', padding: '14px 16px 8px' }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', marginBottom: 10 }}>RSI &amp; MACD</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="dateShort" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis yAxisId="r" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={[0, 100]} width={36} />
              <YAxis yAxisId="m" orientation="right" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={46} />
              <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="r" type="monotone" dataKey="rsi" name="RSI" stroke="#a855f7" dot={false} strokeWidth={1.5} />
              <Line yAxisId="m" type="monotone" dataKey="macd" name="MACD" stroke="#6366f1" dot={false} strokeWidth={1.2} />
              <Line yAxisId="m" type="monotone" dataKey="macd_signal" name="Signal" stroke="#ec4899" dot={false} strokeWidth={1} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {!loading && loadError && (
        <div className="card" style={{ padding: '1rem 1.25rem', color: '#ef4444', fontSize: 13 }}>
          {loadError}
        </div>
      )}

      {!loading && !latest && !loadError && (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Enter a symbol and click Load.</div>
      )}

      {pipeline && (
        <div className="card" style={{ marginTop: '1rem', padding: '12px 14px' }}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14, color: 'var(--text-primary)' }}>ML pipeline output</div>
          {pipeline.ok === false && pipeline.error && (
            <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>{pipeline.error}</div>
          )}
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            Preprocessing: {pipeline.preprocessing?.rows_in} → {pipeline.preprocessing?.rows_out} rows ·
            Features: {pipeline.feature_engineering?.rows} rows, {pipeline.feature_engineering?.columns?.length} cols
          </div>
          {pipeline.models?.price_prediction?.ok ? (
            <div style={{ fontSize: 13, marginBottom: 6 }}>
              <strong>Price model</strong> RMSE {pipeline.models.price_prediction.metrics?.rmse?.toFixed(5)} ·
              R² {pipeline.models.price_prediction.metrics?.r2?.toFixed(3)} ·
              as of {pipeline.models.price_prediction.as_of_date} →
              next close est {pipeline.models.price_prediction.predicted_next_close_est}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 6 }}>
              Price model: {pipeline.models?.price_prediction?.error || 'failed'}
            </div>
          )}
          {pipeline.models?.sentiment_plus_price?.ok ? (
            <div style={{ fontSize: 13, marginBottom: 6, color: 'var(--text-muted)' }}>
              Fusion model updated — see panel above.
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 6 }}>
              Fusion model: {pipeline.models?.sentiment_plus_price?.error || 'failed'}
            </div>
          )}
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)' }}>Raw JSON</summary>
            <pre style={{ fontSize: 10, overflow: 'auto', maxHeight: 240, marginTop: 8, color: 'var(--text-secondary)' }}>
              {JSON.stringify(pipeline, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  )
}

