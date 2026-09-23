import { useState } from 'react'
import { Download, FileSpreadsheet, FileText, CheckCircle, Loader } from 'lucide-react'
import axios from 'axios'
import toast from 'react-hot-toast'

const api = axios.create({ baseURL: '/api', timeout: 30000 })

const STORAGE_KEY = 'commodityiq_portfolio'

function fmtInr(n) {
  if (!n && n!==0) return '—'
  if (n>=1e5) return '₹'+(n/1e5).toFixed(2)+' L'
  if (n>=1000) return '₹'+n.toLocaleString('en-IN',{maximumFractionDigits:0})
  return '₹'+n.toFixed(2)
}

async function isValidXlsxBlob(blob) {
  if (!blob || blob.size < 4) return false
  if (blob.type && blob.type.includes('json')) return false
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer())
  // XLSX is a ZIP archive — starts with "PK"
  return head[0] === 0x50 && head[1] === 0x4b
}

async function downloadBlob(data, filename, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type })
  if (type.includes('spreadsheet') && !(await isValidXlsxBlob(blob))) {
    try {
      const text = await blob.text()
      const err = JSON.parse(text)
      throw new Error(err.detail || err.error || 'Invalid Excel file from server')
    } catch (e) {
      if (e instanceof Error && e.message !== 'Invalid Excel file from server') throw e
      throw new Error('Server did not return a valid Excel file. Install backend dep: pip install openpyxl')
    }
  }
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  window.URL.revokeObjectURL(url)
}

async function exportErr(e) {
  const d = e.response?.data
  if (d instanceof Blob) {
    try {
      const j = JSON.parse(await d.text())
      return j.detail || j.error || 'Export failed'
    } catch {
      return e.message || 'Export failed'
    }
  }
  const detail = e.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map((x) => x.msg || JSON.stringify(x)).join('; ')
  return e.message || 'Export failed'
}

export default function ExportPage({ wsData }) {
  const [downloading, setDownloading] = useState({})

  // Load portfolio from localStorage
  const holdings = (() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
  })()

  const enriched = holdings.map(h => {
    const live       = wsData.prices[h.ticker]
    const curr_price = live?.display_price || live?.price_inr || h.buy_price
    const curr_value = curr_price * h.quantity
    const cost_basis = h.buy_price * h.quantity
    const pnl        = curr_value - cost_basis
    const pnl_pct    = cost_basis ? (pnl / cost_basis * 100) : 0
    return { ...h, curr_price, curr_value, cost_basis, pnl, pnl_pct }
  })

  const totalValue   = enriched.reduce((s,h)=>s+h.curr_value,0)
  const totalCost    = enriched.reduce((s,h)=>s+h.cost_basis,0)
  const totalPnl     = totalValue - totalCost
  const totalPnlPct  = totalCost ? (totalPnl/totalCost*100) : 0

  const setDL = (key, val) => setDownloading(d=>({...d,[key]:val}))

  const downloadPricesExcel = async () => {
    setDL('prices_xlsx', true)
    try {
      const r = await api.get('/export/prices/excel', { responseType:'blob' })
      await downloadBlob(r.data, `commodity_prices_${new Date().toISOString().slice(0,10)}.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      toast.success('Prices exported as Excel!')
    } catch (e) { toast.error(await exportErr(e)) }
    setDL('prices_xlsx', false)
  }

  const downloadPricesCSV = async () => {
    setDL('prices_csv', true)
    try {
      const r = await api.get('/export/prices/csv', { responseType:'blob' })
      downloadBlob(r.data, `commodity_prices_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv')
      toast.success('Prices exported as CSV!')
    } catch { toast.error('Export failed') }
    setDL('prices_csv', false)
  }

  const downloadPortfolioExcel = async () => {
    if (!enriched.length) { toast.error('No holdings in portfolio'); return }
    setDL('portfolio_xlsx', true)
    try {
      const r = await api.post('/export/portfolio/excel', {
        holdings:      enriched,
        total_value:   totalValue,
        total_cost:    totalCost,
        total_pnl:     totalPnl,
        total_pnl_pct: totalPnlPct,
      }, { responseType:'blob' })
      await downloadBlob(r.data, `portfolio_${new Date().toISOString().slice(0,10)}.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      toast.success('Portfolio exported as Excel!')
    } catch (e) { toast.error(await exportErr(e)) }
    setDL('portfolio_xlsx', false)
  }

  const downloadPortfolioCSV = async () => {
    if (!enriched.length) { toast.error('No holdings in portfolio'); return }
    setDL('portfolio_csv', true)
    try {
      const r = await api.post('/export/portfolio/csv', {
        holdings:      enriched,
        total_value:   totalValue,
        total_cost:    totalCost,
        total_pnl:     totalPnl,
        total_pnl_pct: totalPnlPct,
      }, { responseType:'blob' })
      downloadBlob(r.data, `portfolio_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv')
      toast.success('Portfolio exported as CSV!')
    } catch { toast.error('Export failed') }
    setDL('portfolio_csv', false)
  }

  const Btn = ({id, label, icon:Icon, color, onClick, disabled}) => (
    <button onClick={onClick} disabled={downloading[id]||disabled}
      style={{display:'flex',alignItems:'center',gap:10,padding:'12px 20px',
        background:downloading[id]?'var(--bg-hover)':color||'#6366f1',
        color:'#fff',border:'none',borderRadius:10,fontWeight:600,
        fontSize:13,cursor:'pointer',opacity:(downloading[id]||disabled)?0.6:1,
        transition:'all 0.15s',width:'100%',justifyContent:'center'}}>
      {downloading[id]
        ? <Loader size={16} style={{animation:'spin 1s linear infinite'}}/>
        : <Icon size={16}/>}
      {downloading[id] ? 'Preparing...' : label}
    </button>
  )

  return (
    <div>
      <div style={{marginBottom:'1.5rem'}}>
        <h1 style={{fontSize:22,fontWeight:700,color:'var(--text-primary)'}}>Export Data</h1>
        <p style={{fontSize:13,color:'var(--text-muted)',marginTop:2}}>
          Download commodity prices and portfolio data as Excel (.xlsx) or CSV
        </p>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>

        {/* Prices export */}
        <div className="card">
          <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:'1.2rem'}}>
            <div style={{width:42,height:42,borderRadius:10,background:'rgba(99,102,241,0.15)',
              display:'flex',alignItems:'center',justifyContent:'center',fontSize:20}}>📊</div>
            <div>
              <div style={{fontSize:15,fontWeight:700,color:'var(--text-primary)'}}>Live Commodity Prices</div>
              <div style={{fontSize:12,color:'var(--text-muted)'}}>
                {Object.keys(wsData.prices).length} commodities · All Indian units
              </div>
            </div>
          </div>

          <div style={{background:'var(--bg-primary)',borderRadius:8,padding:'10px 14px',
            marginBottom:'1.2rem',fontSize:12,color:'var(--text-secondary)',lineHeight:1.8}}>
            <div>✅ Name, Ticker, Category</div>
            <div>✅ Price in ₹ (Indian unit — per gram, per kg, per quintal)</div>
            <div>✅ International price in USD</div>
            <div>✅ Change % (today)</div>
            <div>✅ USD/INR rate + source + timestamp</div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Btn id="prices_xlsx" label="Download Excel" icon={FileSpreadsheet}
              color="#22c55e" onClick={downloadPricesExcel}/>
            <Btn id="prices_csv"  label="Download CSV"   icon={FileText}
              color="#6366f1" onClick={downloadPricesCSV}/>
          </div>
        </div>

        {/* Portfolio export */}
        <div className="card">
          <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:'1.2rem'}}>
            <div style={{width:42,height:42,borderRadius:10,background:'rgba(34,197,94,0.15)',
              display:'flex',alignItems:'center',justifyContent:'center',fontSize:20}}>💼</div>
            <div>
              <div style={{fontSize:15,fontWeight:700,color:'var(--text-primary)'}}>Portfolio Report</div>
              <div style={{fontSize:12,color:'var(--text-muted)'}}>
                {holdings.length} holdings · Live P&amp;L
              </div>
            </div>
          </div>

          {holdings.length === 0 ? (
            <div style={{background:'rgba(245,158,11,0.08)',border:'1px solid rgba(245,158,11,0.2)',
              borderRadius:8,padding:'12px',marginBottom:'1.2rem',fontSize:12,color:'#f59e0b'}}>
              ⚠️ No portfolio holdings yet. Go to the Portfolio page to add commodities first.
            </div>
          ) : (
            <>
              {/* Portfolio summary */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:'1.2rem'}}>
                {[
                  {label:'Holdings',    value:holdings.length},
                  {label:'Total Value', value:fmtInr(totalValue)},
                  {label:'Total Cost',  value:fmtInr(totalCost)},
                  {label:'Total P&L',   value:fmtInr(totalPnl), color:totalPnl>=0?'#22c55e':'#ef4444'},
                ].map((s,i)=>(
                  <div key={i} style={{background:'var(--bg-primary)',borderRadius:8,padding:'8px 12px'}}>
                    <div style={{fontSize:10,color:'var(--text-muted)',textTransform:'uppercase'}}>{s.label}</div>
                    <div style={{fontSize:14,fontWeight:700,color:s.color||'var(--text-primary)'}}>{s.value}</div>
                  </div>
                ))}
              </div>

              <div style={{background:'var(--bg-primary)',borderRadius:8,padding:'10px 14px',
                marginBottom:'1.2rem',fontSize:12,color:'var(--text-secondary)',lineHeight:1.8}}>
                <div>✅ All holdings with quantity + buy price</div>
                <div>✅ Current price (live) + current value</div>
                <div>✅ P&amp;L in ₹ and percentage</div>
                <div>✅ Summary row with totals</div>
                <div>✅ Color-coded (green = profit, red = loss)</div>
              </div>
            </>
          )}

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Btn id="portfolio_xlsx" label="Download Excel" icon={FileSpreadsheet}
              color="#22c55e" onClick={downloadPortfolioExcel} disabled={!holdings.length}/>
            <Btn id="portfolio_csv"  label="Download CSV"   icon={FileText}
              color="#6366f1" onClick={downloadPortfolioCSV}  disabled={!holdings.length}/>
          </div>
        </div>
      </div>

      {/* Preview table */}
      {Object.keys(wsData.prices).length > 0 && (
        <div className="card" style={{marginTop:16,padding:0,overflow:'hidden'}}>
          <div style={{padding:'12px 16px',borderBottom:'1px solid var(--border)',
            display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div style={{fontSize:13,fontWeight:600,color:'var(--text-secondary)'}}>
              EXPORT PREVIEW (first 8 rows)
            </div>
            <span style={{fontSize:11,color:'var(--text-muted)'}}>
              Full file has {Object.keys(wsData.prices).length} rows
            </span>
          </div>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead>
              <tr style={{borderBottom:'1px solid var(--border)'}}>
                {['Name','Ticker','Category','Price (Indian unit)','Change %'].map(h=>(
                  <th key={h} style={{padding:'9px 14px',textAlign:'left',fontSize:11,
                    color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.values(wsData.prices).slice(0,8).map((p,i)=>{
                const up = p.change_pct > 0
                const zero = !p.change_pct || p.change_pct===0
                return (
                  <tr key={i} style={{borderBottom:'1px solid var(--bg-hover)'}}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--bg-hover)'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <td style={{padding:'9px 14px',fontWeight:600,fontSize:13,color:'var(--text-primary)'}}>{p.name}</td>
                    <td style={{padding:'9px 14px',fontSize:12,color:'var(--text-muted)',fontFamily:'monospace'}}>{p.ticker}</td>
                    <td style={{padding:'9px 14px'}}>
                      <span style={{fontSize:11,background:'var(--bg-hover)',color:'var(--text-secondary)',
                        padding:'2px 7px',borderRadius:5,textTransform:'capitalize'}}>{p.category}</span>
                    </td>
                    <td style={{padding:'9px 14px',fontWeight:700,fontSize:13,color:'var(--text-primary)'}}>
                      {fmtInr(p.display_price||p.price_inr)}
                      <span style={{fontSize:10,color:'var(--text-muted)',marginLeft:4}}>{p.display_unit||p.unit}</span>
                    </td>
                    <td style={{padding:'9px 14px'}}>
                      {zero
                        ? <span style={{fontSize:11,color:'var(--text-hint)'}}>—</span>
                        : <span className={up?'badge-up':'badge-down'}>
                            {up?'▲':'▼'} {Math.abs(p.change_pct||0).toFixed(2)}%
                          </span>}
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