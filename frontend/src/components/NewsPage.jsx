import { useState, useEffect } from 'react'
import { RefreshCw, ExternalLink } from 'lucide-react'
import { postSentimentAnalyze } from '../api/client'

const FEEDS = [
  { label:'All Commodities',  q:'commodity+market+prices' },
  { label:'Gold & Metals',    q:'gold+silver+metal+prices' },
  { label:'Oil & Energy',     q:'crude+oil+energy+prices' },
  { label:'Agriculture',      q:'wheat+corn+agricultural+commodity' },
  { label:'India Markets',    q:'MCX+commodity+India+NCDEX' },
]

const SOURCE_FEEDS = [
  { label: 'Google News', kind: 'google' },
  { label: 'LiveMint Markets', kind: 'rss', url: 'https://www.livemint.com/rss/markets' },
  { label: 'LiveMint Companies', kind: 'rss', url: 'https://www.livemint.com/rss/companies' },
  { label: 'Investing.com', kind: 'rss', url: 'https://www.investing.com/rss/news_25.rss' },
]

// Uses RSS2JSON for Google News and direct RSS feeds for additional sources
const RSS_API = 'https://api.rss2json.com/v1/api.json?rss_url='
const GNEWS   = 'https://news.google.com/rss/search?q='

function timeAgo(dateStr) {
  const parsed = new Date(dateStr).getTime()
  if (!Number.isFinite(parsed) || parsed <= 0) return ''
  const diff = Date.now() - parsed
  const m = Math.floor(diff / 60000)
  if (m < 60)  return m + 'm ago'
  const h = Math.floor(m / 60)
  if (h < 24)  return h + 'h ago'
  return Math.floor(h/24) + 'd ago'
}

function stripHtml(html) {
  return html?.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").trim() || ''
}

function normalizeDate(value) {
  const parsed = new Date(value || 0).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function getLatestArticle(items) {
  return [...(items || [])]
    .sort((a, b) => normalizeDate(b.pubDate) - normalizeDate(a.pubDate))
    .slice(0, 1)
}

function parseRssItems(xmlText, sourceLabel) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml')
  return [...doc.querySelectorAll('item')].map((item) => {
    const mediaUrl = item.querySelector('enclosure')?.getAttribute('url')
      || item.querySelector('media\\:content')?.getAttribute('url')
      || item.querySelector('thumbnail')?.getAttribute('url')
      || ''

    return {
      title: item.querySelector('title')?.textContent?.trim() || '',
      link: item.querySelector('link')?.textContent?.trim() || '',
      pubDate: item.querySelector('pubDate')?.textContent?.trim() || '',
      author: item.querySelector('author')?.textContent?.trim() || sourceLabel,
      source: sourceLabel,
      description: item.querySelector('description')?.textContent?.trim() || '',
      thumbnail: mediaUrl,
    }
  }).filter((item) => item.title && item.link)
}

function normalizeArticles(items, sourceLabel) {
  return (items || [])
    .map((item) => ({
      title: item.title || item.headline || '',
      link: item.link || item.url || '',
      pubDate: item.pubDate || item.published || '',
      author: item.author || item.publisher || sourceLabel,
      source: item.source || sourceLabel,
      description: item.description || item.summary || '',
      thumbnail: item.thumbnail || item.enclosure?.url || '',
    }))
    .filter((item) => item.title && item.link)
}

function dedupeAndSort(items) {
  const seen = new Set()
  return [...items]
    .sort((a, b) => normalizeDate(b.pubDate) - normalizeDate(a.pubDate))
    .filter((item) => {
      const key = (item.link || item.title || '').toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

async function fetchGoogleNews(query) {
  const url = RSS_API + encodeURIComponent(GNEWS + query + '&hl=en-IN&gl=IN&ceid=IN:en')
  const response = await fetch(url)
  const data = await response.json()
  if (data.status !== 'ok') {
    throw new Error('Google News feed unavailable')
  }
  return normalizeArticles(data.items || [], 'Google News')
}

async function fetchRssFeed(url, sourceLabel) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`${sourceLabel} feed unavailable`)
  }
  const text = await response.text()
  return parseRssItems(text, sourceLabel)
}

async function loadSourceArticles(feedIdx) {
  const query = FEEDS[feedIdx].q
  const results = await Promise.allSettled([
    fetchGoogleNews(query),
    ...SOURCE_FEEDS.filter((feed) => feed.kind === 'rss').map((feed) => fetchRssFeed(feed.url, feed.label)),
  ])

  const articles = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
  return dedupeAndSort(articles)
}

export default function NewsPage() {
  const [articles, setArticles] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [feed,     setFeed]     = useState(0)
  const [error,    setError]    = useState(null)
  const [sentimentLoading, setSentimentLoading] = useState(false)

  const loadNews = async (feedIdx) => {
    setLoading(true)
    setError(null)
    try {
      const items = await loadSourceArticles(feedIdx)
      setArticles(items)
      // Kick off sentiment scoring (FinBERT when available) for headlines
      scoreArticlesSentiment(items)
    } catch (e) {
      setError('Could not load news. Check your internet connection.')
      setArticles([])
    }
    setLoading(false)
  }

  const scoreArticlesSentiment = async (items) => {
    if (!items || !items.length) return
    // Only send up to 32 texts (backend limit)
    const texts = items.slice(0, 32).map((it) => (it.title || it.description || '').slice(0, 1000))
    if (!texts.length) return
    setSentimentLoading(true)
    try {
      const resp = await postSentimentAnalyze(texts, false)
      if (resp && resp.data && Array.isArray(resp.data.results)) {
        const scored = resp.data.results
        // Map results back to articles by index
        const annotated = items.map((a, i) => ({ ...a, sentiment: scored[i] || null }))
        setArticles(annotated)
      }
    } catch (e) {
      // silently ignore sentiment failures
      console.warn('Sentiment annotate failed', e)
    }
    setSentimentLoading(false)
  }

  useEffect(() => { loadNews(feed) }, [feed])

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.5rem', flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:'#e2e8f0' }}>Commodity News</h1>
          <p style={{ fontSize:13, color:'#64748b', marginTop:2 }}>Live news via Google News, LiveMint and Investing.com</p>
        </div>
        <button onClick={() => loadNews(feed)} disabled={loading}
          style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 14px',
            background:'transparent', color:'#94a3b8', border:'1px solid #2d3148',
            borderRadius:8, fontWeight:600, fontSize:13, cursor:'pointer' }}>
          <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }}/> Refresh
        </button>
      </div>

      {/* Feed tabs */}
      <div style={{ display:'flex', gap:6, marginBottom:'1.5rem', flexWrap:'wrap' }}>
        {FEEDS.map((f,i) => (
          <button key={i} className={'tab-btn ' + (feed===i?'active':'')} onClick={()=>setFeed(i)}>
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)',
          borderRadius:10, padding:'1rem', color:'#ef4444', marginBottom:'1rem', fontSize:13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))', gap:12 }}>
          {[...Array(6)].map((_,i) => (
            <div key={i} className="card" style={{ padding:'1.25rem' }}>
              <div style={{ height:14, background:'#2d3148', borderRadius:4, marginBottom:10, width:'60%' }}/>
              <div style={{ height:12, background:'#1e2235', borderRadius:4, marginBottom:6 }}/>
              <div style={{ height:12, background:'#1e2235', borderRadius:4, marginBottom:6, width:'80%' }}/>
              <div style={{ height:10, background:'#1e2235', borderRadius:4, width:'40%', marginTop:12 }}/>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))', gap:12 }}>
          {articles.map((a, i) => (
            <a key={i} href={a.link} target="_blank" rel="noopener noreferrer"
              style={{ textDecoration:'none' }}>
              <div className="card" style={{ height:'100%', cursor:'pointer', transition:'border-color 0.15s' }}
                onMouseEnter={e=>e.currentTarget.style.borderColor='#3d4268'}
                onMouseLeave={e=>e.currentTarget.style.borderColor='#2d3148'}>
                {a.thumbnail && (
                  <img src={a.thumbnail} alt="" style={{ width:'100%', height:140,
                    objectFit:'cover', borderRadius:8, marginBottom:12 }}
                    onError={e => e.target.style.display='none'} />
                )}
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                  <span style={{ fontSize:11, color:'#6366f1', fontWeight:600, background:'rgba(99,102,241,0.15)',
                    padding:'2px 8px', borderRadius:5 }}>
                    {a.source || a.author || 'News'}
                  </span>
                  {a.sentiment && (
                    <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:6,
                      background: a.sentiment.score > 0.15 ? 'rgba(34,197,94,0.12)' : a.sentiment.score < -0.15 ? 'rgba(239,68,68,0.08)' : 'rgba(148,163,184,0.06)',
                      color: a.sentiment.score > 0.15 ? '#16a34a' : a.sentiment.score < -0.15 ? '#ef4444' : '#94a3b8' }}
                      title={a.sentiment.backend || 'sentiment'}>
                      {a.sentiment.label}{' '}
                      <span style={{ fontWeight:600, marginLeft:6 }}>{(a.sentiment.score * 100).toFixed(1)}%</span>
                    </span>
                  )}
                  {timeAgo(a.pubDate) && <span style={{ fontSize:11, color:'#475569' }}>{timeAgo(a.pubDate)}</span>}
                </div>
                <div style={{ fontSize:14, fontWeight:600, color:'#e2e8f0', marginBottom:8, lineHeight:1.5 }}>
                  {a.title}
                </div>
                <div style={{ fontSize:12, color:'#64748b', lineHeight:1.6,
                  display:'-webkit-box', WebkitLineClamp:3, WebkitBoxOrient:'vertical', overflow:'hidden' }}>
                  {stripHtml(a.description)}
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:4, marginTop:12,
                  fontSize:11, color:'#6366f1' }}>
                  Read more <ExternalLink size={10}/>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}

      {!loading && articles.length === 0 && !error && (
        <div style={{ textAlign:'center', padding:'3rem', color:'#475569' }}>
          <div style={{ fontSize:32, marginBottom:'1rem' }}>📰</div>
          <div>No articles found for this topic.</div>
        </div>
      )}

      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  )
}