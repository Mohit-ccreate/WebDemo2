import { useState, useEffect } from 'react'
import { fetchAllPrices, fetchAllTodayPredictions } from '../api/client'
import { Search, TrendingUp, TrendingDown } from 'lucide-react'
import PriceChart from './PriceChart'
import toast from 'react-hot-toast'

import { TICKER_ICONS, displayPrice, displayUnit } from '../constants/commodities'

const CATS = ['All', 'metals', 'energy']

function fmtInr(n) {
  if (!n && n !== 0) return '—'
  if (n >= 1e7) return '₹' + (n/1e7).toFixed(2) + ' Cr'
  if (n >= 1e5) return '₹' + (n/1e5).toFixed(2) + ' L'
  if (n >= 1000) return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
  return '₹' + n.toFixed(2)
}

const getDisplayPrice = displayPrice
const getDisplayUnit = displayUnit

export default function Dashboard({ wsData }) {
  const [rest,     setRest]     = useState([])
  const [loading,  setLoading]  = useState(true)
  const [cat,      setCat]      = useState('All')
  const [search,   setSearch]   = useState('')
  const [sortBy,   setSortBy]   = useState('name')
  const [selected, setSelected] = useState(null)
  const [todayPreds, setTodayPreds] = useState({})
  const [todayLoading, setTodayLoading] = useState(false)

  const loadForecasts = () => {
    setTodayLoading(true)
    return fetchAllTodayPredictions(true)
      .then((r) => {
        const map = {}
        for (const p of r.data?.predictions || []) {
          if (p.ticker) map[p.ticker] = p
        }
        setTodayPreds(map)
      })
      .catch(() => setTodayPreds({}))
      .finally(() => setTodayLoading(false))
  }

  useEffect(() => {
    fetchAllPrices()
      .then(r => { setRest(r.data.data || []); setLoading(false); return loadForecasts() })
      .catch(() => { toast.error('Failed to load prices'); setLoading(false) })
  }, [])

  const merged = rest.map(c => wsData.prices[c.ticker] || c)
  const live   = merged.length ? merged : Object.values(wsData.prices)

  // Only count commodities with real non-zero change
  const withChange = live.filter(c => c.change_pct != null && c.change_pct !== 0)
  const gainers    = withChange.filter(c => c.change_pct > 0)
  const losers     = withChange.filter(c => c.change_pct < 0)
  const topG       = gainers.length ? [...gainers].sort((a,b) => b.change_pct - a.change_pct)[0] : null
  const topL       = losers.length  ? [...losers].sort((a,b) => a.change_pct - b.change_pct)[0]  : null
  const flat       = live.length - gainers.length - losers.length

  const filtered = live
    .filter(c => cat === 'All' || c.category === cat)
    .filter(c => c.name?.toLowerCase().includes(search.toLowerCase()) ||
                 c.symbol?.toLowerCase().includes(search.toLowerCase()))
    .sort((a,b) =>
      sortBy === 'change' ? b.change_pct - a.change_pct :
      sortBy === 'price'  ? getDisplayPrice(b) - getDisplayPrice(a) :
      (a.name||'').localeCompare(b.name||''))

  return (
    <div>
      {/* Header */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem',flexWrap:'wrap',gap:12}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:700,color:'var(--text-primary)'}}>Market Dashboard</h1>
          <p style={{fontSize:13,color:'var(--text-muted)',marginTop:2}}>
            Live prices · Today&apos;s ML forecast per commodity
            {todayLoading ? ' (loading forecasts…)' : Object.keys(todayPreds).length ? '' : ''}
          </p>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
          <button
            type="button"
            onClick={loadForecasts}
            disabled={todayLoading}
            style={{
              padding:'6px 12px', fontSize:12, borderRadius:8, cursor:'pointer',
              background:'rgba(99,102,241,0.15)', color:'#a5b4fc',
              border:'1px solid rgba(99,102,241,0.35)',
            }}
          >
            {todayLoading ? 'Updating forecasts…' : 'Refresh forecasts'}
          </button>
          <span className="live-dot"/>
          <span style={{fontSize:12,color:'#22c55e',fontWeight:500}}>
            {wsData.connected ? 'Live' : 'Offline'}
          </span>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(155px,1fr))',gap:12,marginBottom:'1.5rem'}}>

        <div className="card" style={{padding:'14px 16px'}}>
          <div style={{fontSize:11,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:4}}>Total</div>
          <div style={{fontSize:20,fontWeight:700,color:'var(--text-primary)'}}>{live.length}</div>
          <div style={{fontSize:11,color:'var(--text-hint)'}}>commodities tracked</div>
        </div>

        <div className="card" style={{padding:'14px 16px'}}>
          <div style={{fontSize:11,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:4}}>Gainers</div>
          <div style={{fontSize:20,fontWeight:700,color:'#22c55e'}}>{gainers.length}</div>
          <div style={{fontSize:11,color:'#22c55e'}}>▲ up today</div>
        </div>

        <div className="card" style={{padding:'14px 16px'}}>
          <div style={{fontSize:11,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:4}}>Losers</div>
          <div style={{fontSize:20,fontWeight:700,color:'#ef4444'}}>{losers.length}</div>
          <div style={{fontSize:11,color:'#ef4444'}}>▼ down today</div>
        </div>

        <div className="card" style={{padding:'14px 16px'}}>
          <div style={{fontSize:11,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:4}}>Unchanged</div>
          <div style={{fontSize:20,fontWeight:700,color:'var(--text-secondary)'}}>{flat}</div>
          <div style={{fontSize:11,color:'var(--text-hint)'}}>no change</div>
        </div>

        <div className="card" style={{padding:'14px 16px'}}>
          <div style={{fontSize:11,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:4}}>Top Gainer</div>
          {topG ? (
            <>
              <div style={{fontSize:16,fontWeight:700,color:'#22c55e',display:'flex',alignItems:'center',gap:4}}>
                <TrendingUp size={14}/>{topG.name}
              </div>
              <div style={{fontSize:12,color:'#22c55e',marginTop:2}}>+{topG.change_pct?.toFixed(2)}%</div>
            </>
          ) : (
            <div style={{fontSize:14,color:'var(--text-hint)'}}>Waiting for data...</div>
          )}
        </div>

        <div className="card" style={{padding:'14px 16px'}}>
          <div style={{fontSize:11,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:4}}>Top Loser</div>
          {topL ? (
            <>
              <div style={{fontSize:16,fontWeight:700,color:'#ef4444',display:'flex',alignItems:'center',gap:4}}>
                <TrendingDown size={14}/>{topL.name}
              </div>
              <div style={{fontSize:12,color:'#ef4444',marginTop:2}}>{topL.change_pct?.toFixed(2)}%</div>
            </>
          ) : (
            <div style={{fontSize:14,color:'var(--text-hint)'}}>Waiting for data...</div>
          )}
        </div>

        <div className="card" style={{padding:'14px 16px'}}>
          <div style={{fontSize:11,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:4}}>USD/INR</div>
          <div style={{fontSize:20,fontWeight:700,color:'var(--text-primary)'}}>
            ₹{wsData.prices['GC=F']?.usd_inr || '—'}
          </div>
          <div style={{fontSize:11,color:'var(--text-hint)'}}>live rate</div>
        </div>

      </div>

      {/* Price chart */}
      {selected && (
        <div style={{marginBottom:'1.5rem'}}>
          <PriceChart
            ticker={selected.ticker}
            name={selected.name}
            liveQuote={wsData.prices[selected.ticker]}
            onClose={() => setSelected(null)}
          />
        </div>
      )}

      {/* Filters */}
      <div style={{display:'flex',gap:8,marginBottom:'1rem',flexWrap:'wrap',alignItems:'center'}}>
        {CATS.map(c => (
          <button key={c} className={'tab-btn '+(cat===c?'active':'')} onClick={() => setCat(c)}>
            {c.charAt(0).toUpperCase()+c.slice(1)}
          </button>
        ))}
        <div style={{marginLeft:'auto',display:'flex',gap:8}}>
          <div style={{position:'relative'}}>
            <Search size={14} style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'var(--text-muted)'}}/>
            <input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} style={{paddingLeft:30,width:180}}/>
          </div>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="name">Sort: Name</option>
            <option value="change">Sort: Change %</option>
            <option value="price">Sort: Price</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{padding:0,overflow:'hidden'}}>
        {loading ? (
          <div style={{padding:'2rem',textAlign:'center',color:'var(--text-muted)'}}>Loading prices...</div>
        ) : filtered.length === 0 ? (
          <div style={{padding:'2rem',textAlign:'center',color:'var(--text-muted)'}}>No commodities match your search.</div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead>
              <tr style={{borderBottom:'1px solid var(--border)'}}>
                {['Commodity','Category','Price','Today forecast','Unit','Change %','Also / Intl ref.'].map(h => (
                  <th key={h} style={{padding:'11px 14px',textAlign:'left',fontSize:11,
                    color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.04em'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => {
                const up    = c.change_pct > 0
                const zero  = !c.change_pct || c.change_pct === 0
                const dispP = getDisplayPrice(c)
                const dispU = getDisplayUnit(c)
                const tp = todayPreds[c.ticker]
                const fchg = tp?.change_pct
                const fup = fchg != null && fchg >= 0
                return (
                  <tr key={c.ticker||i} onClick={() => setSelected(c)}
                    style={{borderBottom:'1px solid var(--bg-hover)',cursor:'pointer'}}
                    onMouseEnter={e => e.currentTarget.style.background='var(--bg-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background='transparent'}>

                    <td style={{padding:'11px 14px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:10}}>
                        <span style={{fontSize:20}}>{TICKER_ICONS[c.ticker]||'📦'}</span>
                        <div>
                          <div style={{fontWeight:600,fontSize:13,color:'var(--text-primary)'}}>{c.name}</div>
                          <div style={{fontSize:11,color:'var(--text-muted)'}}>{c.ticker}</div>
                        </div>
                      </div>
                    </td>

                    <td style={{padding:'11px 14px'}}>
                      <span style={{fontSize:11,color:'var(--text-secondary)',background:'var(--bg-hover)',
                        padding:'3px 8px',borderRadius:6,textTransform:'capitalize'}}>{c.category}</span>
                    </td>

                    <td style={{padding:'11px 14px'}}>
                      <div style={{fontWeight:700,fontSize:14,color:'var(--text-primary)'}}>{fmtInr(dispP)}</div>
                    </td>

                    <td style={{padding:'11px 14px'}}>
                      {tp?.ok ? (
                        <>
                          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
                            {fmtInr(tp.predicted_price_display)}
                          </div>
                          <div style={{
                            fontSize: 11,
                            marginTop: 2,
                            color: fup ? '#22c55e' : '#ef4444',
                          }}>
                            {fup ? '▲' : '▼'} {Math.abs(fchg ?? 0).toFixed(2)}% est.
                          </div>
                        </>
                      ) : todayLoading ? (
                        <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>…</span>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>—</span>
                      )}
                    </td>

                    <td style={{padding:'11px 14px',fontSize:11,color:'var(--text-muted)'}}>
                      {dispU}
                    </td>

                    <td style={{padding:'11px 14px'}}>
                      {zero ? (
                        <span style={{fontSize:11,color:'var(--text-hint)'}}>loading...</span>
                      ) : (
                        <span className={up?'badge-up':'badge-down'}>
                          {up?'▲':'▼'} {Math.abs(c.change_pct||0).toFixed(2)}%
                        </span>
                      )}
                    </td>

                    <td style={{padding:'11px 14px',fontSize:11,color:'var(--text-hint)',maxWidth:170}}>
                      {c.also || ''}
                    </td>

                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}