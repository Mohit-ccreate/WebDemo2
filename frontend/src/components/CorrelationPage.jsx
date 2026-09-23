import { useState, useEffect } from 'react'
import { fetchHistory } from '../api/client'
import { Info } from 'lucide-react'

import { CORE_COMMODITIES } from '../constants/commodities'

const TICKERS = CORE_COMMODITIES.map(({ ticker, name }) => ({ ticker, name }))

function pearsonCorr(x, y) {
  const n   = Math.min(x.length, y.length)
  if (n < 5) return null
  const ax  = x.slice(-n), ay = y.slice(-n)
  const mx  = ax.reduce((s,v)=>s+v,0)/n
  const my  = ay.reduce((s,v)=>s+v,0)/n
  let num=0, dx2=0, dy2=0
  for (let i=0;i<n;i++){
    const dx=ax[i]-mx, dy=ay[i]-my
    num+=dx*dy; dx2+=dx*dx; dy2+=dy*dy
  }
  const denom = Math.sqrt(dx2*dy2)
  return denom ? parseFloat((num/denom).toFixed(3)) : null
}

function corrColor(v) {
  if (v === null) return { bg:'var(--bg-hover)', text:'var(--text-hint)', label:'—' }
  const a   = Math.abs(v)
  const pos = v > 0
  if (a >= 0.8) return { bg: pos?'#14532d':'#450a0a', text: pos?'#86efac':'#fca5a5', label: pos?'Strong +':'Strong −' }
  if (a >= 0.5) return { bg: pos?'#166534':'#7f1d1d', text: pos?'#4ade80':'#f87171', label: pos?'Moderate +':'Moderate −' }
  if (a >= 0.2) return { bg: pos?'#1a2e22':'#2d1a1a', text: pos?'#86efac':'#fca5a5', label: pos?'Weak +':'Weak −' }
  return { bg:'var(--bg-surface)', text:'var(--text-secondary)', label:'Uncorrelated' }
}

export default function CorrelationPage() {
  const [returns,   setReturns]  = useState({})
  const [matrix,    setMatrix]   = useState([])
  const [loading,   setLoading]  = useState(true)
  const [period,    setPeriod]   = useState('1y')
  const [hovered,   setHovered]  = useState(null)

  useEffect(() => {
    setLoading(true)
    Promise.all(TICKERS.map(t =>
      fetchHistory(t.ticker, period)
        .then(r => ({
          ticker: t.ticker,
          name:   t.name,
          returns: (r.data.records||[]).map((rec,i,arr) => {
            if (i===0) return null
            const prev = arr[i-1].display_close_inr ?? arr[i-1].close_inr
            const curr = rec.display_close_inr ?? rec.close_inr
            return prev ? (curr - prev)/prev*100 : null
          }).filter(v=>v!==null)
        }))
        .catch(()=>({ ticker:t.ticker, name:t.name, returns:[] }))
    )).then(results => {
      const map = {}
      results.forEach(r => { map[r.ticker] = r })
      setReturns(map)

      // Build correlation matrix
      const mat = TICKERS.map(a =>
        TICKERS.map(b => {
          if (a.ticker===b.ticker) return 1.0
          return pearsonCorr(map[a.ticker]?.returns||[], map[b.ticker]?.returns||[])
        })
      )
      setMatrix(mat)
      setLoading(false)
    })
  }, [period])

  return (
    <div>
      <div style={{marginBottom:'1.5rem'}}>
        <h1 style={{fontSize:22,fontWeight:700,color:'var(--text-primary)'}}>Correlation Matrix</h1>
        <p style={{fontSize:13,color:'var(--text-muted)',marginTop:2}}>
          How commodities move together · Based on daily returns · Green = move together, Red = move opposite
        </p>
      </div>

      {/* Controls + legend */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.2rem',flexWrap:'wrap',gap:12}}>
        <div style={{display:'flex',gap:4}}>
          {['6mo','1y','2y'].map(p=>(
            <button key={p} className={'tab-btn '+(period===p?'active':'')}
              style={{padding:'6px 14px',fontSize:12}} onClick={()=>setPeriod(p)}>{p}</button>
          ))}
        </div>
        <div style={{display:'flex',gap:10,flexWrap:'wrap',fontSize:11,color:'var(--text-muted)'}}>
          {[['Strong +',' #14532d','#86efac'],['Weak +','#1a2e22','#86efac'],['Uncorr.','var(--bg-surface)','var(--text-secondary)'],['Weak −','#2d1a1a','#fca5a5'],['Strong −','#450a0a','#fca5a5']].map(([l,bg,tc])=>(
            <span key={l} style={{display:'flex',alignItems:'center',gap:4}}>
              <span style={{width:14,height:14,borderRadius:2,background:bg,display:'inline-block',border:'1px solid rgba(255,255,255,0.1)'}}/>
              {l}
            </span>
          ))}
        </div>
      </div>

      {/* Info box */}
      <div style={{background:'rgba(99,102,241,0.08)',border:'1px solid rgba(99,102,241,0.2)',
        borderRadius:10,padding:'10px 14px',marginBottom:'1.5rem',display:'flex',gap:10,alignItems:'flex-start'}}>
        <Info size={14} style={{color:'#6366f1',flexShrink:0,marginTop:2}}/>
        <div style={{fontSize:12,color:'var(--text-secondary)',lineHeight:1.7}}>
          <strong style={{color:'#818cf8'}}>How to read:</strong> Correlation of +1 = move in perfect sync.
          -1 = move in opposite directions. 0 = no relationship.
          Strong positive pairs (Gold+Silver) make poor diversification.
          Negative pairs help balance a portfolio.
        </div>
      </div>

      {loading ? (
        <div className="card" style={{padding:'3rem',textAlign:'center',color:'var(--text-muted)'}}>
          Calculating correlations from {period} of daily returns...
        </div>
      ) : (
        <>
          {/* Matrix */}
          <div className="card" style={{padding:0,overflow:'auto'}}>
            <table style={{borderCollapse:'collapse',width:'100%',minWidth:640}}>
              <thead>
                <tr>
                  <th style={{padding:'10px 12px',fontSize:11,color:'var(--text-muted)',textAlign:'left',
                    borderBottom:'1px solid var(--border)',background:'var(--bg-subtle)'}}>
                    Commodity
                  </th>
                  {TICKERS.map(t=>(
                    <th key={t.ticker} style={{padding:'10px 8px',fontSize:10,color:'var(--text-muted)',
                      textAlign:'center',borderBottom:'1px solid var(--border)',
                      background:'var(--bg-subtle)',minWidth:72,fontWeight:600}}>
                      {t.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TICKERS.map((row,ri)=>(
                  <tr key={row.ticker} style={{borderBottom:'1px solid var(--bg-hover)'}}>
                    <td style={{padding:'8px 12px',fontSize:12,fontWeight:600,
                      color:'var(--text-primary)',background:'var(--bg-subtle)',
                      whiteSpace:'nowrap'}}>
                      {row.name}
                    </td>
                    {TICKERS.map((col,ci)=>{
                      const v   = matrix[ri]?.[ci]
                      const clr = corrColor(v)
                      const self= ri===ci
                      return (
                        <td key={col.ticker}
                          onMouseEnter={()=>setHovered({row:row.name,col:col.name,v,clr})}
                          onMouseLeave={()=>setHovered(null)}
                          style={{
                            padding:'8px 4px',
                            textAlign:'center',
                            background: self?'var(--border)':clr.bg,
                            cursor:'default',
                            transition:'opacity 0.1s',
                          }}>
                          <div style={{fontSize:11,fontWeight:self?700:600,color:self?'var(--text-primary)':clr.text}}>
                            {v===null?'—':self?'1.00':v?.toFixed(2)}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Hover tooltip */}
          {hovered && hovered.row!==hovered.col && (
            <div style={{position:'fixed',bottom:24,right:24,zIndex:1000,
              background:'var(--bg-surface)',border:'1px solid var(--border)',
              borderRadius:12,padding:'14px 18px',minWidth:220,
              boxShadow:'0 8px 32px rgba(0,0,0,0.4)'}}>
              <div style={{fontSize:13,fontWeight:600,color:'var(--text-primary)',marginBottom:6}}>
                {hovered.row} ↔ {hovered.col}
              </div>
              <div style={{fontSize:22,fontWeight:800,color:hovered.clr.text,marginBottom:4}}>
                {hovered.v?.toFixed(3)}
              </div>
              <div style={{fontSize:12,color:hovered.clr.text}}>{hovered.clr.label}</div>
              <div style={{fontSize:11,color:'var(--text-muted)',marginTop:6}}>
                {Math.abs(hovered.v)>0.7
                  ? 'Strong relationship — these move together'
                  : Math.abs(hovered.v)>0.4
                  ? 'Moderate relationship'
                  : 'Weak or no meaningful relationship'}
              </div>
            </div>
          )}

          {/* Top correlated pairs */}
          <div className="card" style={{marginTop:16,padding:0,overflow:'hidden'}}>
            <div style={{padding:'12px 16px',borderBottom:'1px solid var(--border)',
              fontSize:12,fontWeight:600,color:'var(--text-muted)'}}>
              STRONGEST CORRELATIONS
            </div>
            <div style={{padding:'0 0 8px'}}>
              {TICKERS.flatMap((a,ai)=>
                TICKERS.slice(ai+1).map((b,bi)=>({
                  a:a.name, b:b.name,
                  v:matrix[ai]?.[ai+1+bi]
                }))
              )
              .filter(p=>p.v!==null)
              .sort((x,y)=>Math.abs(y.v)-Math.abs(x.v))
              .slice(0,8)
              .map((p,i)=>{
                const clr=corrColor(p.v)
                return (
                  <div key={i} style={{display:'flex',alignItems:'center',gap:12,
                    padding:'10px 16px',borderBottom:'1px solid var(--bg-hover)'}}>
                    <div style={{flex:1,fontSize:13,color:'var(--text-primary)'}}>
                      {p.a} ↔ {p.b}
                    </div>
                    <div style={{width:120,height:6,background:'var(--border)',borderRadius:3,overflow:'hidden'}}>
                      <div style={{width:Math.abs(p.v)*100+'%',height:'100%',
                        background:p.v>0?'#22c55e':'#ef4444',borderRadius:3}}/>
                    </div>
                    <div style={{fontSize:13,fontWeight:700,color:clr.text,minWidth:48,textAlign:'right'}}>
                      {p.v?.toFixed(2)}
                    </div>
                    <div style={{fontSize:11,color:clr.text,minWidth:90}}>{clr.label}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}