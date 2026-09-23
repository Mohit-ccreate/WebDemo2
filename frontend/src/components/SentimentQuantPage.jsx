import { useEffect, useState } from 'react'
import { Brain, Newspaper, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { fetchSentimentHealth, fetchStockNews, postSentimentAnalyze } from '../api/client'

function apiErr(e) {
  const d = e.response?.data?.detail
  if (d == null) return e.message || 'Request failed'
  if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join('; ')
  return typeof d === 'string' ? d : JSON.stringify(d)
}

function mergeFinbertScores(articles, results) {
  return articles.map((a, i) => {
    const s = results[i]
    if (!s) return a
    return {
      ...a,
      sentiment_label: s.label ?? a.sentiment_label,
      sentiment_score: s.score ?? a.sentiment_score,
      sentiment_backend: s.backend ?? a.sentiment_backend,
    }
  })
}

export default function SentimentQuantPage() {
  const [ticker, setTicker] = useState('AAPL')
  const [news, setNews] = useState([])
  const [customText, setCustomText] = useState('')
  const [customResults, setCustomResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [finbertReady, setFinbertReady] = useState(null)

  useEffect(() => {
    let cancelled = false
    let timer

    const check = () => {
      fetchSentimentHealth()
        .then((r) => {
          if (cancelled) return
          const fb = r.data?.finbert
          if (fb?.available) {
            setFinbertReady(true)
            return
          }
          if (fb?.loading) {
            setFinbertReady(null)
            timer = setTimeout(check, 3000)
            return
          }
          setFinbertReady(false)
        })
        .catch(() => {
          if (!cancelled) setFinbertReady(false)
        })
    }

    check()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  const scoreWithFinbert = async (texts) => {
    const r = await postSentimentAnalyze(texts.slice(0, 24), false)
    return r.data.results || []
  }

  const loadNews = async () => {
    const sym = ticker.trim().toUpperCase()
    if (!sym) return
    setLoading(true)
    setNews([])
    try {
      const r = await fetchStockNews(sym)
      const articles = (r.data.articles || []).filter((a) => a.title)
      if (!articles.length) {
        setNews([])
        setLoading(false)
        return
      }
      const titles = articles.map((a) => a.title)
      try {
        const results = await scoreWithFinbert(titles)
        setNews(mergeFinbertScores(articles, results))
        const backend = results[0]?.backend || ''
        if (backend.includes('finbert')) {
          toast.success('Headlines scored with FinBERT')
        } else if (backend.includes('keyword')) {
          toast('FinBERT unavailable — showing keyword fallback. Start API with backend\\.venv\\Scripts\\python.exe', { icon: '⚠️' })
        }
      } catch (e) {
        toast.error(`FinBERT scoring failed: ${apiErr(e)}`)
        setNews(articles)
      }
    } catch (e) {
      toast.error(apiErr(e))
      setNews([])
    }
    setLoading(false)
  }

  const runCustom = async () => {
    const lines = customText.split('\n').map((s) => s.trim()).filter(Boolean)
    if (!lines.length) {
      toast.error('Enter one or more lines of text')
      return
    }
    setLoading(true)
    try {
      const results = await scoreWithFinbert(lines)
      setCustomResults(results)
      const backend = results[0]?.backend || ''
      if (backend.includes('finbert')) toast.success('Analyzed with FinBERT')
      else if (backend.includes('keyword')) {
        toast('Keyword fallback used — install ML deps and restart API with venv Python', { icon: '⚠️' })
      }
    } catch (e) {
      toast.error(apiErr(e))
      setCustomResults([])
    }
    setLoading(false)
  }

  const statusColor =
    finbertReady === null ? 'var(--text-muted)' : finbertReady ? '#22c55e' : '#f59e0b'
  const statusText =
    finbertReady === null
      ? 'Loading FinBERT… (first run may take a minute; cached after that)'
      : finbertReady
        ? 'FinBERT ready (ProsusAI/finbert)'
        : 'FinBERT offline — keyword fallback only'

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Sentiment · FinBERT</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
          Headlines and custom text are scored via <code style={{ fontSize: 12 }}>POST /api/sentiment/analyze</code> (FinBERT when installed).
        </p>
        <p style={{ fontSize: 12, color: statusColor, marginTop: 6, fontWeight: 500 }}>{statusText}</p>
      </div>

      <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>TICKER</label>
          <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} style={{ width: '100%' }} />
        </div>
        <button type="button" onClick={loadNews} disabled={loading} className="tab-btn active" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Newspaper size={14} /> {loading ? 'Scoring…' : 'Load & score headlines'}
        </button>
      </div>

      {!loading && news.length === 0 && ticker && (
        <div className="card" style={{ marginBottom: '1rem', padding: '12px 14px', fontSize: 13, color: 'var(--text-muted)' }}>
          No headlines returned for this ticker. Use custom text below, or try another symbol.
        </div>
      )}

      {news.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: '1.25rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Headline', 'Score', 'Label', 'Backend'].map((h) => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {news.map((a, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--bg-hover)' }}>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: 'var(--text-primary)', maxWidth: 420 }}>
                    {a.link ? (
                      <a href={a.link} target="_blank" rel="noreferrer" style={{ color: 'var(--text-primary)' }}>{a.title}</a>
                    ) : (
                      a.title
                    )}
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 13 }}>{a.sentiment_score ?? '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12 }}>{a.sentiment_label}</td>
                  <td
                    style={{
                      padding: '10px 14px',
                      fontSize: 11,
                      color: String(a.sentiment_backend || '').includes('finbert') ? '#22c55e' : 'var(--text-hint)',
                      fontWeight: String(a.sentiment_backend || '').includes('finbert') ? 600 : 400,
                    }}
                  >
                    {a.sentiment_backend}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Brain size={16} color="#6366f1" />
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>Custom text batch</span>
        </div>
        <textarea
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          placeholder="Paste headlines (one per line)..."
          rows={5}
          style={{ width: '100%', marginBottom: 10, fontSize: 13, fontFamily: 'inherit' }}
        />
        <button type="button" onClick={runCustom} disabled={loading} className="tab-btn active" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Send size={14} /> {loading ? 'Analyzing…' : 'Analyze with FinBERT'}
        </button>
      </div>

      {customResults.length > 0 && (
        <div className="card" style={{ padding: '12px 14px' }}>
          {customResults.map((r, i) => (
            <div key={i} style={{ padding: '8px 0', borderBottom: i < customResults.length - 1 ? '1px solid var(--bg-hover)' : 'none' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.text}</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                <strong style={{ color: 'var(--text-primary)' }}>{r.label}</strong>
                <span style={{ marginLeft: 10, fontFamily: 'monospace' }}>{r.score}</span>
                <span
                  style={{
                    marginLeft: 10,
                    fontSize: 11,
                    color: String(r.backend || '').includes('finbert') ? '#22c55e' : 'var(--text-hint)',
                    fontWeight: String(r.backend || '').includes('finbert') ? 600 : 400,
                  }}
                >
                  {r.backend}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
