import { useState, useEffect } from 'react'
import { fetchAlerts, createAlert, deleteAlert, disableAlert, fetchNotifications } from '../api/client'
import { Bell, Trash2, PauseCircle, Plus } from 'lucide-react'
import toast from 'react-hot-toast'

import { CORE_COMMODITIES } from '../constants/commodities'

const TICKERS = CORE_COMMODITIES.map((c) => c.ticker)

const ALERT_TYPES = [
  { value:'PRICE_ABOVE',  label:'Price Above ₹' },
  { value:'PRICE_BELOW',  label:'Price Below ₹' },
  { value:'CHANGE_PCT',   label:'Change % exceeds' },
]

const STATUS_COLOR = {
  active:    { bg:'rgba(99,102,241,0.15)', color:'#818cf8' },
  triggered: { bg:'rgba(34,197,94,0.15)',  color:'#22c55e' },
  disabled:  { bg:'rgba(100,116,139,0.15)',color:'#64748b' },
}

export default function AlertsPage({ wsData }) {
  const [alerts, setAlerts]         = useState([])
  const [notifications, setNotifs]  = useState([])
  const [form, setForm]             = useState({ ticker:'GC=F', alert_type:'PRICE_ABOVE', threshold:'', label:'' })
  const [loading, setLoading]       = useState(false)
  const [showForm, setShowForm]     = useState(false)

  const load = async () => {
    const [a, n] = await Promise.all([fetchAlerts(), fetchNotifications()])
    setAlerts(a.data.alerts || [])
    setNotifs(n.data.notifications || [])
  }

  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    if (!form.threshold) { toast.error('Enter a threshold value'); return }
    setLoading(true)
    try {
      await createAlert({ ...form, threshold: parseFloat(form.threshold) })
      toast.success('Alert created!')
      setForm({ ticker:'GC=F', alert_type:'PRICE_ABOVE', threshold:'', label:'' })
      setShowForm(false)
      await load()
    } catch(e) {
      toast.error(e.response?.data?.detail || 'Failed to create alert')
    }
    setLoading(false)
  }

  const handleDelete = async (id) => {
    try {
      await deleteAlert(id)
      toast.success('Alert deleted')
      await load()
    } catch { toast.error('Delete failed') }
  }

  const handleDisable = async (id) => {
    try {
      await disableAlert(id)
      toast('Alert disabled')
      await load()
    } catch { toast.error('Disable failed') }
  }

  const activeCount    = alerts.filter(a=>a.status==='active').length
  const triggeredCount = alerts.filter(a=>a.status==='triggered').length

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.5rem' }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:'#e2e8f0' }}>Price Alerts</h1>
          <p style={{ fontSize:13, color:'#64748b', marginTop:2 }}>All thresholds in Indian Rupees (₹)</p>
        </div>
        <button onClick={() => setShowForm(s=>!s)}
          style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 18px',
            background:'#6366f1', color:'#fff', border:'none', borderRadius:8,
            fontWeight:600, fontSize:13, cursor:'pointer' }}>
          <Plus size={14}/> New Alert
        </button>
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:'1.5rem' }}>
        {[
          { label:'Total Alerts',    value: alerts.length },
          { label:'Active',          value: activeCount,    color:'#818cf8' },
          { label:'Triggered Today', value: triggeredCount, color:'#22c55e' },
        ].map((s,i) => (
          <div key={i} className="card" style={{ padding:'14px 16px' }}>
            <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.04em' }}>{s.label}</div>
            <div style={{ fontSize:24, fontWeight:700, color: s.color||'#e2e8f0', marginTop:4 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Create form */}
      {showForm && (
        <div className="card" style={{ marginBottom:'1.5rem', borderColor:'#3d4268' }}>
          <div style={{ fontSize:14, fontWeight:600, color:'#e2e8f0', marginBottom:'1rem' }}>
            Create New Alert
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <div>
              <label style={{ fontSize:11, color:'#64748b', display:'block', marginBottom:4 }}>TICKER</label>
              <select value={form.ticker} onChange={e=>setForm(f=>({...f,ticker:e.target.value}))} style={{ width:'100%' }}>
                {TICKERS.map(t=><option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize:11, color:'#64748b', display:'block', marginBottom:4 }}>ALERT TYPE</label>
              <select value={form.alert_type} onChange={e=>setForm(f=>({...f,alert_type:e.target.value}))} style={{ width:'100%' }}>
                {ALERT_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize:11, color:'#64748b', display:'block', marginBottom:4 }}>
                THRESHOLD {form.alert_type==='CHANGE_PCT'?'(%)':'(₹)'}
              </label>
              <input type="number" placeholder={form.alert_type==='CHANGE_PCT'?'e.g. 2.5':'e.g. 195000'}
                value={form.threshold} onChange={e=>setForm(f=>({...f,threshold:e.target.value}))}
                style={{ width:'100%' }} />
            </div>
            <div>
              <label style={{ fontSize:11, color:'#64748b', display:'block', marginBottom:4 }}>LABEL (optional)</label>
              <input placeholder="My alert name" value={form.label}
                onChange={e=>setForm(f=>({...f,label:e.target.value}))} style={{ width:'100%' }} />
            </div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={handleCreate} disabled={loading}
              style={{ padding:'8px 18px', background:'#6366f1', color:'#fff', border:'none',
                borderRadius:8, fontWeight:600, fontSize:13, cursor:'pointer', opacity:loading?0.7:1 }}>
              {loading ? 'Creating...' : 'Create Alert'}
            </button>
            <button onClick={() => setShowForm(false)}
              style={{ padding:'8px 18px', background:'transparent', color:'#94a3b8',
                border:'1px solid #2d3148', borderRadius:8, fontWeight:600, fontSize:13, cursor:'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 380px', gap:16 }}>
        {/* Alerts list */}
        <div className="card" style={{ padding:0 }}>
          <div style={{ padding:'14px 16px', borderBottom:'1px solid #2d3148', fontSize:13, fontWeight:600, color:'#94a3b8' }}>
            ALL ALERTS ({alerts.length})
          </div>
          {alerts.length === 0 && (
            <div style={{ padding:'2rem', textAlign:'center', color:'#475569' }}>
              <Bell size={32} style={{ margin:'0 auto 8px', opacity:0.3 }} />
              <div>No alerts yet. Create your first alert above.</div>
            </div>
          )}
          {alerts.map(a => {
            const sc = STATUS_COLOR[a.status] || STATUS_COLOR.active
            return (
              <div key={a.id} style={{ display:'flex', alignItems:'center', gap:12,
                padding:'12px 16px', borderBottom:'1px solid #1e2235' }}>
                <div style={{ flex:1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                    <span style={{ fontSize:13, fontWeight:600, color:'#e2e8f0' }}>{a.label}</span>
                    <span style={{ fontSize:11, padding:'2px 7px', borderRadius:5,
                      background: sc.bg, color: sc.color, fontWeight:500 }}>
                      {a.status}
                    </span>
                  </div>
                  <div style={{ fontSize:11, color:'#64748b' }}>
                    {a.ticker} · {a.alert_type} · Threshold: {
                      a.alert_type==='CHANGE_PCT'
                        ? `${a.threshold}%`
                        : `₹${Number(a.threshold).toLocaleString('en-IN')}`
                    }
                  </div>
                  {a.triggered_at && (
                    <div style={{ fontSize:11, color:'#22c55e', marginTop:2 }}>
                      Triggered at {new Date(a.triggered_at).toLocaleString()}
                    </div>
                  )}
                </div>
                <div style={{ display:'flex', gap:6 }}>
                  {a.status === 'active' && (
                    <button onClick={() => handleDisable(a.id)}
                      style={{ background:'none', border:'1px solid #2d3148', borderRadius:6,
                        color:'#64748b', cursor:'pointer', padding:'5px 8px', display:'flex' }}>
                      <PauseCircle size={14} />
                    </button>
                  )}
                  <button onClick={() => handleDelete(a.id)}
                    style={{ background:'none', border:'1px solid rgba(239,68,68,0.3)', borderRadius:6,
                      color:'#ef4444', cursor:'pointer', padding:'5px 8px', display:'flex' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Notifications feed */}
        <div className="card" style={{ padding:0 }}>
          <div style={{ padding:'14px 16px', borderBottom:'1px solid #2d3148', fontSize:13, fontWeight:600, color:'#94a3b8' }}>
            NOTIFICATIONS ({notifications.length})
          </div>
          {notifications.length === 0 && (
            <div style={{ padding:'2rem', textAlign:'center', color:'#475569', fontSize:13 }}>
              No notifications yet. Alerts will appear here when triggered.
            </div>
          )}
          {[...notifications].reverse().map((n,i) => (
            <div key={i} style={{ padding:'12px 16px', borderBottom:'1px solid #1e2235' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                <span style={{ fontSize:16 }}>
                  {n.alert_type==='PRICE_ABOVE'?'📈':n.alert_type==='PRICE_BELOW'?'📉':'⚡'}
                </span>
                <span style={{ fontSize:12, fontWeight:600, color:'#e2e8f0' }}>{n.commodity_name||n.ticker}</span>
              </div>
              <div style={{ fontSize:12, color:'#94a3b8', marginBottom:4 }}>{n.message}</div>
              <div style={{ fontSize:11, color:'#475569' }}>
                {n.triggered_at ? new Date(n.triggered_at).toLocaleString() : ''}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
