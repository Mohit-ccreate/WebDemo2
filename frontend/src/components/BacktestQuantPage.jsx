import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { History } from 'lucide-react'
import toast from 'react-hot-toast'
import { postStockBacktest } from '../api/client'

function apiErr(e) {
  const d = e.response?.data?.detail
  if (d == null) return e.message || 'Request failed'
  if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join('; ')
  return typeof d === 'string' ? d : JSON.stringify(d)
}

export default function BacktestQuantPage() {
  const [symbol, setSymbol] = useState('AAPL')
  const [strategy, setStrategy] = useState('buy_hold')
  const [period, setPeriod] = useState('2y')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  const run = async () => {
    const sym = symbol.trim().toUpperCase()
    if (!sym) return
    setLoading(true)
    try {
      const r = await postStockBacktest(sym, { strategy, period })
      setResult(r.data)
    } catch (e) {
      toast.error(apiErr(e))
      setResult(null)
    }
    setLoading(false)
  }

  const curve = result?.equity_curve || []

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Backtesting</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
          Historical simulation on daily bars · buy &amp; hold vs RSI mean-reversion (simplified).
        </p>
      </div>

      <div className="card" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}>
        <div style={{ minWidth: 120 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>SYMBOL</label>
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
        </div>
        <div style={{ minWidth: 160 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>STRATEGY</label>
          <select value={strategy} onChange={(e) => setStrategy(e.target.value)} style={{ width: '100%' }}>
            <option value="buy_hold">Buy &amp; hold</option>
            <option value="rsi_mean_reversion">RSI mean reversion</option>
          </select>
        </div>
        <div style={{ minWidth: 100 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>PERIOD</label>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: '100%' }}>
            {['1y', '2y', '5y', 'max'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <button type="button" onClick={run} disabled={loading} className="tab-btn active" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <History size={14} /> Run backtest
        </button>
      </div>

      {result?.metrics && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: '1rem' }}>
          {[
            ['Total return %', result.metrics.total_return_pct],
            ['Max drawdown %', result.metrics.max_drawdown_pct],
            ['Sharpe (approx)', result.metrics.sharpe_approx],
            ['Sortino (approx)', result.metrics.sortino_approx],
            ['Win rate %', result.metrics.win_rate_pct],
          ].map(([k, v]) => (
            <div key={k} className="card" style={{ padding: '12px 14px' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{k}</div>
              <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {!loading && result && (!result.metrics || curve.length === 0) && (
        <div className="card" style={{ padding: '1.25rem', color: 'var(--text-muted)', fontSize: 13 }}>
          Backtest returned no equity curve. Check the symbol and try period 1y or 2y.
        </div>
      )}

      {!loading && !result && (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
          Enter a symbol and click Run backtest.
        </div>
      )}

      {curve.length > 0 && (
        <div className="card" style={{ padding: '14px 16px 8px' }}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>Equity curve ({result?.strategy})</div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={curve} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickFormatter={(v) => (v || '').slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={['auto', 'auto']} width={52} />
              <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }} />
              <Line type="monotone" dataKey="equity" name="Equity" stroke="#6366f1" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
