import { useCallback, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { Brain, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react'
import toast from 'react-hot-toast'
import { fetchStockFusion } from '../api/client'

function fmt(n, digits = 2) {
  if (n == null || Number.isNaN(n)) return '—'
  if (Math.abs(n) >= 1000) return Number(n).toLocaleString('en-IN', { maximumFractionDigits: digits })
  return Number(n).toFixed(digits)
}

function sentimentColor(score) {
  if (score == null) return 'var(--text-muted)'
  if (score > 0.15) return '#22c55e'
  if (score < -0.15) return '#ef4444'
  return 'var(--text-secondary)'
}

function MetricCard({ title, value, sub, accent }) {
  return (
    <div
      className="card"
      style={{
        padding: '12px 14px',
        borderLeft: accent ? `3px solid ${accent}` : undefined,
      }}
    >
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {title}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export default function FusionModelPanel({ symbol, fusionBundle, predHistory, onFusionUpdate, compact }) {
  const [loading, setLoading] = useState(false)
  const [localBundle, setLocalBundle] = useState(null)

  const bundle = localBundle || fusionBundle
  const fusion = bundle?.fusion || bundle?.models?.sentiment_plus_price
  const history = bundle?.prediction_history || predHistory
  const articles = bundle?.sentiment?.articles || bundle?.models?.sentiment?.articles || []

  const runFusion = useCallback(async () => {
    const sym = symbol?.trim()?.toUpperCase()
    if (!sym) return
    setLoading(true)
    try {
      const r = await fetchStockFusion(sym)
      setLocalBundle(r.data)
      onFusionUpdate?.(r.data)
      if (r.data?.ok === false) toast.error(r.data.error || 'Fusion model failed')
      else toast.success('Fusion forecast updated')
    } catch (e) {
      const msg = e.response?.data?.detail || e.message || 'Fusion request failed'
      toast.error(typeof msg === 'string' ? msg : 'Fusion request failed')
    }
    setLoading(false)
  }, [symbol, onFusionUpdate])

  const latestHist = history?.predictions?.[0]
  const forecastClose = fusion?.predicted_next_close_est ?? latestHist?.predicted_close
  const baseClose = fusion?.last_close ?? latestHist?.base_close
  const asOf = fusion?.as_of_date ?? latestHist?.as_of_date
  const movePct =
    forecastClose != null && baseClose != null && baseClose !== 0
      ? ((forecastClose - baseClose) / baseClose) * 100
      : null

  const chartRows = (history?.predictions || [])
    .filter((p) => p.actual_close != null)
    .slice()
    .reverse()
    .map((p) => ({
      date: p.actual_date?.slice(5) || p.as_of_date?.slice(5),
      predicted: p.predicted_close,
      actual: p.actual_close,
    }))

  const hasFusion = fusion?.ok || latestHist != null

  return (
    <div className="card" style={{ marginBottom: '1rem', padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Brain size={18} color="#a855f7" />
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
              Fusion model
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Ridge · technicals + news sentiment → next session close
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={runFusion}
          disabled={loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 12px',
            background: 'rgba(168,85,247,0.12)',
            color: '#c4b5fd',
            border: '1px solid rgba(168,85,247,0.35)',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          {loading ? 'Running…' : 'Run fusion'}
        </button>
      </div>

      {!hasFusion && !loading && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
          Click <strong>Run fusion</strong> to train the sentiment + price model and save the next-session forecast.
        </div>
      )}

      {(fusion?.ok || latestHist) && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 10,
              marginBottom: 12,
            }}
          >
            <MetricCard
              title="Next close (forecast)"
              value={fmt(forecastClose)}
              sub={asOf ? `From session ${asOf}` : undefined}
              accent="#a855f7"
            />
            <MetricCard title="Last close" value={fmt(baseClose)} sub="Base for forecast" />
            <MetricCard
              title="Expected move"
              value={movePct != null ? `${movePct >= 0 ? '+' : ''}${movePct.toFixed(2)}%` : '—'}
              sub={
                movePct != null ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {movePct >= 0 ? <TrendingUp size={12} color="#22c55e" /> : <TrendingDown size={12} color="#ef4444" />}
                    vs last close
                  </span>
                ) : undefined
              }
              accent={movePct >= 0 ? '#22c55e' : movePct < 0 ? '#ef4444' : undefined}
            />
            {fusion?.ok && (
              <>
                <MetricCard
                  title="Holdout R²"
                  value={fusion.metrics?.r2 != null ? fusion.metrics.r2.toFixed(3) : '—'}
                  sub={`RMSE ${fusion.metrics?.rmse?.toFixed(5) ?? '—'} (log return)`}
                />
                <MetricCard
                  title="Sentiment coef"
                  value={fusion.coef_sentiment != null ? fusion.coef_sentiment.toFixed(4) : '—'}
                  sub="Ridge weight on daily sentiment"
                />
              </>
            )}
          </div>

          {history?.resolved_count > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              Forward accuracy · MAE {fmt(history.forward_metrics?.mae)} · MAPE{' '}
              {history.forward_metrics?.mape_pct != null
                ? `${Number(history.forward_metrics.mape_pct).toFixed(2)}%`
                : '—'}{' '}
              · resolved {history.resolved_count}/{history.count}
            </div>
          )}

          {!compact && chartRows.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                Predicted vs actual (resolved)
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartRows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={['auto', 'auto']} width={52} />
                  <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="predicted" name="Predicted" stroke="#a855f7" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="actual" name="Actual" stroke="#22c55e" dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {!compact && (history?.predictions?.length > 0) && (
            <div style={{ overflowX: 'auto', marginBottom: articles.length ? 12 : 0 }}>
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                    <th style={{ padding: '4px 8px' }}>As of</th>
                    <th style={{ padding: '4px 8px' }}>Predicted</th>
                    <th style={{ padding: '4px 8px' }}>Actual</th>
                    <th style={{ padding: '4px 8px' }}>Error %</th>
                  </tr>
                </thead>
                <tbody>
                  {history.predictions.slice(0, compact ? 5 : 15).map((p) => (
                    <tr key={`${p.as_of_date}-${p.id}`} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '4px 8px' }}>{p.as_of_date}</td>
                      <td style={{ padding: '4px 8px' }}>{fmt(p.predicted_close)}</td>
                      <td style={{ padding: '4px 8px' }}>{p.actual_close != null ? fmt(p.actual_close) : 'pending'}</td>
                      <td style={{ padding: '4px 8px' }}>
                        {p.error_pct != null ? `${Number(p.error_pct).toFixed(2)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!compact && articles.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                News sentiment (fusion input)
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', maxHeight: 160, overflowY: 'auto' }}>
                {articles.slice(0, 8).map((a, i) => (
                  <li
                    key={i}
                    style={{
                      fontSize: 11,
                      padding: '6px 0',
                      borderTop: i ? '1px solid var(--border)' : undefined,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <span style={{ color: sentimentColor(a.sentiment_score), fontWeight: 600, marginRight: 6 }}>
                      {a.sentiment_label || 'neutral'}
                    </span>
                    {a.title || '—'}
                    {a.published_day && (
                      <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{a.published_day}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {fusion && !fusion.ok && (
            <div style={{ fontSize: 12, color: '#ef4444' }}>{fusion.error || 'Fusion model failed'}</div>
          )}
        </>
      )}
    </div>
  )
}
