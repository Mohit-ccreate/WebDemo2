import { useState, useEffect } from 'react'
import { RefreshCw, ExternalLink, CheckCircle, Info } from 'lucide-react'
import axios from 'axios'

const api = axios.create({ baseURL: '/api', timeout: 20000 })

function fmtInr(n) {
  if (!n && n!==0) return '—'
  if (n>=1e7) return '₹'+(n/1e7).toFixed(2)+' Cr'
  if (n>=1e5) return '₹'+(n/1e5).toFixed(2)+' L'
  if (n>=1e3) return '₹'+n.toLocaleString('en-IN',{maximumFractionDigits:0})
  return '₹'+n.toFixed(2)
}

export default function ScraperPage() {
  const [data,      setData]      = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [lastFetch, setLastFetch] = useState(null)
  const [error,     setError]     = useState(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const r = await api.get('/scraper/all')
      setData(r.data)
      setLastFetch(new Date())
    } catch(e) {
      setError('Failed to fetch scraper data. Is the backend running?')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const gold   = data?.indian_prices?.gold   || {}
  const silver = data?.indian_prices?.silver || {}
  const plat   = data?.indian_prices?.platinum || {}
  const mcx    = data?.mcx_estimates || {}
  const metals = data?.metals_intl   || {}
  const usdInr = data?.usd_inr       || '—'
  const quality= data?.data_quality  || 'unknown'

  return (
    <div>
      {/* Header */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem',flexWrap:'wrap',gap:12}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:700,color:'var(--text-primary)'}}>Live Price Scraper</h1>
          <p style={{fontSize:13,color:'var(--text-muted)',marginTop:2}}>
            Real-time prices from gold-api.com · Converted to Indian units using live USD/INR
          </p>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          {lastFetch && (
            <span style={{fontSize:12,color:'var(--text-muted)'}}>
              Updated: {lastFetch.toLocaleTimeString('en-IN')}
            </span>
          )}
          <button onClick={load} disabled={loading}
            style={{display:'flex',alignItems:'center',gap:8,padding:'8px 16px',
              background:'#6366f1',color:'#fff',border:'none',borderRadius:8,
              fontWeight:600,fontSize:13,cursor:'pointer',opacity:loading?0.7:1}}>
            <RefreshCw size={13} style={{animation:loading?'spin 1s linear infinite':'none'}}/>
            {loading?'Fetching...':'Refresh'}
          </button>
        </div>
      </div>

      {/* Status + source note */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:'1.5rem'}}>
        <div style={{background:'rgba(34,197,94,0.08)',border:'1px solid rgba(34,197,94,0.25)',
          borderRadius:10,padding:'12px 16px',display:'flex',gap:10,alignItems:'flex-start'}}>
          <CheckCircle size={14} style={{color:'#22c55e',flexShrink:0,marginTop:2}}/>
          <div style={{fontSize:12,color:'var(--text-secondary)',lineHeight:1.7}}>
            <strong style={{color:'#22c55e'}}>Data source:</strong> gold-api.com (live spot prices, no API key needed).
            Prices include ~9% import duty + GST for precious metals as per Indian customs.
            USD/INR: <strong style={{color:'var(--text-primary)'}}>₹{usdInr}</strong>
          </div>
        </div>
        <div style={{background:'rgba(99,102,241,0.08)',border:'1px solid rgba(99,102,241,0.2)',
          borderRadius:10,padding:'12px 16px',display:'flex',gap:10,alignItems:'flex-start'}}>
          <Info size={14} style={{color:'#6366f1',flexShrink:0,marginTop:2}}/>
          <div style={{fontSize:12,color:'var(--text-secondary)',lineHeight:1.7}}>
            <strong style={{color:'#818cf8'}}>Why not goodreturns/MCX?</strong> These sites use
            Cloudflare protection + JavaScript rendering which blocks standard scrapers.
            We use gold-api.com which is openly accessible and provides the same underlying spot prices.
          </div>
        </div>
      </div>

      {error && (
        <div style={{background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.3)',
          borderRadius:10,padding:'12px 16px',color:'#ef4444',marginBottom:'1rem',fontSize:13}}>
          {error}
        </div>
      )}

      {/* International spot prices */}
      {Object.keys(metals).length > 0 && (
        <div className="card" style={{marginBottom:'1.2rem',padding:0,overflow:'hidden'}}>
          <div style={{padding:'12px 16px',borderBottom:'1px solid var(--border)',
            fontSize:13,fontWeight:600,color:'var(--text-secondary)'}}>
            🌍 INTERNATIONAL SPOT PRICES — gold-api.com
          </div>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead>
              <tr style={{borderBottom:'1px solid var(--border)'}}>
                {['Metal','Spot Price (USD/oz)','Prev Close','Change %','Source'].map(h=>(
                  <th key={h} style={{padding:'10px 14px',textAlign:'left',fontSize:11,
                    color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(metals).map(([k,v],i)=>{
                const up = v.change_pct >= 0
                return (
                  <tr key={k} style={{borderBottom:'1px solid var(--bg-hover)'}}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--bg-hover)'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <td style={{padding:'10px 14px',fontWeight:600,fontSize:13,
                      color:'var(--text-primary)',textTransform:'capitalize'}}>{k}</td>
                    <td style={{padding:'10px 14px',fontWeight:700,fontSize:14,color:'var(--text-primary)'}}>
                      ${v.price_usd?.toLocaleString()}
                    </td>
                    <td style={{padding:'10px 14px',fontSize:12,color:'var(--text-secondary)'}}>
                      ${v.prev_usd?.toLocaleString()}
                    </td>
                    <td style={{padding:'10px 14px'}}>
                      <span className={up?'badge-up':'badge-down'}>
                        {up?'▲':'▼'} {Math.abs(v.change_pct||0).toFixed(2)}%
                      </span>
                    </td>
                    <td style={{padding:'10px 14px',fontSize:11,color:'var(--text-muted)'}}>{v.source}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Indian Gold prices */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:'1.2rem'}}>
        <div className="card">
          <div style={{fontSize:14,fontWeight:600,color:'var(--text-secondary)',marginBottom:'1rem'}}>
            🥇 GOLD — Indian Retail Prices
          </div>
          {[
            {k:'24k_per_10g',  label:'24 Karat per 10g (MCX standard)'},
            {k:'24k_per_gram', label:'24 Karat per 1g'},
            {k:'22k_per_10g',  label:'22 Karat per 10g (jewellery)'},
            {k:'22k_per_gram', label:'22 Karat per 1g'},
            {k:'18k_per_10g',  label:'18 Karat per 10g'},
            {k:'18k_per_gram', label:'18 Karat per 1g'},
          ].map(({k,label})=>(
            <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',
              borderBottom:'1px solid var(--bg-hover)'}}>
              <span style={{fontSize:12,color:'var(--text-secondary)'}}>{label}</span>
              <span style={{fontSize:13,fontWeight:700,
                color:gold[k]?'var(--text-primary)':'var(--text-muted)'}}>
                {gold[k] ? fmtInr(gold[k]) : loading?'Loading...':'—'}
              </span>
            </div>
          ))}
          {gold.source && (
            <div style={{fontSize:10,color:'var(--text-hint)',marginTop:8}}>{gold.source}</div>
          )}
        </div>

        <div className="card">
          <div style={{fontSize:14,fontWeight:600,color:'var(--text-secondary)',marginBottom:'1rem'}}>
            🪙 SILVER — Indian Retail Prices
          </div>
          {[
            {k:'per_kg',   label:'Silver per kg (MCX standard)'},
            {k:'per_100g', label:'Silver per 100g'},
            {k:'per_10g',  label:'Silver per 10g'},
            {k:'per_gram', label:'Silver per 1g'},
          ].map(({k,label})=>(
            <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',
              borderBottom:'1px solid var(--bg-hover)'}}>
              <span style={{fontSize:12,color:'var(--text-secondary)'}}>{label}</span>
              <span style={{fontSize:13,fontWeight:700,
                color:silver[k]?'var(--text-primary)':'var(--text-muted)'}}>
                {silver[k] ? fmtInr(silver[k]) : loading?'Loading...':'—'}
              </span>
            </div>
          ))}
          {plat['per_10g'] && (
            <>
              <div style={{fontSize:13,fontWeight:600,color:'var(--text-muted)',
                margin:'12px 0 6px',borderTop:'1px solid var(--border)',paddingTop:10}}>
                🔵 Platinum
              </div>
              <div style={{display:'flex',justifyContent:'space-between',padding:'4px 0'}}>
                <span style={{fontSize:12,color:'var(--text-secondary)'}}>per 10g</span>
                <span style={{fontSize:13,fontWeight:700,color:'var(--text-primary)'}}>
                  {fmtInr(plat['per_10g'])}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* MCX Estimates */}
      {Object.keys(mcx).length > 0 && (
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <div style={{padding:'12px 16px',borderBottom:'1px solid var(--border)',
            display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div style={{fontSize:13,fontWeight:600,color:'var(--text-secondary)'}}>
              📊 MCX ESTIMATED PRICES
            </div>
            <a href="https://www.mcxindia.com" target="_blank" rel="noopener noreferrer"
              style={{fontSize:11,color:'#6366f1',display:'flex',alignItems:'center',
                gap:4,textDecoration:'none'}}>
              Check live MCX <ExternalLink size={10}/>
            </a>
          </div>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead>
              <tr style={{borderBottom:'1px solid var(--border)'}}>
                {['MCX Symbol','Price (₹)','Unit','Change %'].map(h=>(
                  <th key={h} style={{padding:'10px 14px',textAlign:'left',fontSize:11,
                    color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(mcx).map(([sym,v],i)=>{
                const up = v.change_pct >= 0
                return (
                  <tr key={sym} style={{borderBottom:'1px solid var(--bg-hover)'}}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--bg-hover)'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <td style={{padding:'10px 14px'}}>
                      <span style={{fontSize:12,fontFamily:'monospace',color:'#6366f1',
                        background:'rgba(99,102,241,0.12)',padding:'3px 8px',borderRadius:5}}>
                        {sym}
                      </span>
                    </td>
                    <td style={{padding:'10px 14px',fontWeight:700,fontSize:14,color:'var(--text-primary)'}}>
                      {fmtInr(v.price)}
                    </td>
                    <td style={{padding:'10px 14px',fontSize:11,color:'var(--text-muted)'}}>{v.unit}</td>
                    <td style={{padding:'10px 14px'}}>
                      <span className={up?'badge-up':'badge-down'}>
                        {up?'▲':'▼'} {Math.abs(v.change_pct||0).toFixed(2)}%
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}