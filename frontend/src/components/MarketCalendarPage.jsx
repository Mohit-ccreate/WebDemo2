import { useState, useEffect } from 'react'
import { Clock, Calendar, AlertCircle, CheckCircle } from 'lucide-react'

// MCX Trading Hours (IST)
const MCX_HOURS = {
  weekdays: {
    morning: { open:'09:00', close:'11:30', label:'Morning session' },
    evening:  { open:'17:00', close:'23:30', label:'Evening/international session' },
    note: 'Extended to 23:55 for international market tracking commodities',
  },
  saturday: null,
  sunday: null,
}

// MCX Holidays 2026 (public holidays when MCX is closed)
const MCX_HOLIDAYS_2026 = [
  { date:'2026-01-26', name:'Republic Day',         type:'national' },
  { date:'2026-03-30', name:'Holi',                  type:'festival' },
  { date:'2026-04-02', name:'Ram Navami',             type:'festival' },
  { date:'2026-04-03', name:'Good Friday',            type:'national' },
  { date:'2026-04-14', name:'Dr. Ambedkar Jayanti',   type:'national' },
  { date:'2026-05-01', name:'Maharashtra Day',         type:'state'    },
  { date:'2026-06-10', name:'Bakri Eid (Id-Ul-Adha)', type:'festival' },
  { date:'2026-08-15', name:'Independence Day',        type:'national' },
  { date:'2026-08-27', name:'Ganesh Chaturthi',        type:'festival' },
  { date:'2026-10-02', name:'Mahatma Gandhi Jayanti',  type:'national' },
  { date:'2026-10-20', name:'Diwali (Laxmi Puja)',     type:'festival' },
  { date:'2026-10-21', name:'Diwali (Balipratipada)',  type:'festival' },
  { date:'2026-11-05', name:'Guru Nanak Jayanti',      type:'festival' },
  { date:'2026-12-25', name:'Christmas',               type:'national' },
]

// MCX Expiry dates 2026 (approximate — last/near-last trading day of month)
const MCX_EXPIRY_2026 = [
  { commodity:'Gold (GOLD)', expiries:['2026-04-30','2026-06-30','2026-08-31','2026-10-30','2026-12-31'] },
  { commodity:'Silver (SILVER)', expiries:['2026-05-29','2026-07-31','2026-09-30','2026-11-30'] },
  { commodity:'Crude Oil (CRUDEOIL)', expiries:['2026-04-17','2026-05-19','2026-06-19','2026-07-21','2026-08-19','2026-09-21','2026-10-21','2026-11-19','2026-12-21'] },
  { commodity:'Natural Gas (NATURALGAS)', expiries:['2026-04-24','2026-05-26','2026-06-25','2026-07-28','2026-08-25','2026-09-25','2026-10-28','2026-11-24','2026-12-29'] },
  { commodity:'Copper (COPPER)', expiries:['2026-04-29','2026-06-29','2026-08-31','2026-10-29','2026-12-30'] },
]

function getNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
}

function isMCXOpen(now) {
  const day = now.getDay()   // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false
  const h   = now.getHours(), m = now.getMinutes()
  const t   = h * 60 + m
  const morn_o = 9*60, morn_c = 11*60+30
  const eve_o  = 17*60, eve_c = 23*60+30
  return (t >= morn_o && t < morn_c) || (t >= eve_o && t < eve_c)
}

function minsUntilOpen(now) {
  const day = now.getDay()
  if (day === 0 || day === 6) {
    const daysUntilMon = day === 0 ? 1 : 2
    return daysUntilMon * 24 * 60
  }
  const h = now.getHours(), m = now.getMinutes()
  const t = h * 60 + m
  if (t < 9*60)         return 9*60 - t
  if (t >= 11*60+30 && t < 17*60) return 17*60 - t
  if (t >= 23*60+30)    return (24-23)*60 + 9*60
  return 0
}

function fmt12(timeStr) {
  const [h,m] = timeStr.split(':').map(Number)
  const ampm  = h >= 12 ? 'PM' : 'AM'
  return `${h%12||12}:${m.toString().padStart(2,'0')} ${ampm}`
}

const HOLIDAY_COLORS = { national:'#6366f1', festival:'#f59e0b', state:'#14b8a6' }

export default function MarketCalendarPage() {
  const [now,       setNow]       = useState(getNow())
  const [tab,       setTab]       = useState('clock')
  const [selComm,   setSelComm]   = useState(0)

  useEffect(() => {
    const id = setInterval(() => setNow(getNow()), 1000)
    return () => clearInterval(id)
  }, [])

  const isOpen      = isMCXOpen(now)
  const minsLeft    = minsUntilOpen(now)
  const today       = now.toISOString().slice(0,10)
  const todayHoliday= MCX_HOLIDAYS_2026.find(h=>h.date===today)
  const upcoming    = MCX_HOLIDAYS_2026.filter(h=>h.date>=today).slice(0,5)

  // Next expiry for each commodity
  const nextExpiries = MCX_EXPIRY_2026.map(c=>({
    ...c,
    next: c.expiries.find(d=>d>=today) || 'Past'
  }))

  return (
    <div>
      <div style={{marginBottom:'1.5rem'}}>
        <h1 style={{fontSize:22,fontWeight:700,color:'var(--text-primary)'}}>MCX Market Calendar</h1>
        <p style={{fontSize:13,color:'var(--text-muted)',marginTop:2}}>
          Trading hours · Holidays · Contract expiry dates · All times in IST
        </p>
      </div>

      {/* Live clock + status */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:'1.5rem'}}>
        <div className="card" style={{padding:'16px',textAlign:'center'}}>
          <div style={{fontSize:11,color:'var(--text-muted)',textTransform:'uppercase',marginBottom:8}}>IST Time</div>
          <div style={{fontSize:32,fontWeight:800,color:'var(--text-primary)',fontFamily:'monospace',letterSpacing:2}}>
            {now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
          </div>
          <div style={{fontSize:12,color:'var(--text-muted)',marginTop:4}}>
            {now.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'})}
          </div>
        </div>

        <div className="card" style={{padding:'16px',textAlign:'center',
          borderColor: todayHoliday?'rgba(239,68,68,0.4)': isOpen?'rgba(34,197,94,0.4)':'rgba(100,116,139,0.4)',
          background:  todayHoliday?'rgba(239,68,68,0.05)': isOpen?'rgba(34,197,94,0.05)':'rgba(15,17,23,0.5)'}}>
          <div style={{fontSize:11,color:'var(--text-muted)',textTransform:'uppercase',marginBottom:8}}>MCX Status</div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,marginBottom:4}}>
            {todayHoliday ? (
              <><AlertCircle size={20} color="#ef4444"/>
                <span style={{fontSize:20,fontWeight:700,color:'#ef4444'}}>Holiday</span></>
            ) : isOpen ? (
              <><CheckCircle size={20} color="#22c55e"/>
                <span style={{fontSize:20,fontWeight:700,color:'#22c55e'}}>OPEN</span></>
            ) : (
              <><Clock size={20} color="#64748b"/>
                <span style={{fontSize:20,fontWeight:700,color:'#64748b'}}>CLOSED</span></>
            )}
          </div>
          <div style={{fontSize:12,color:'var(--text-secondary)'}}>
            {todayHoliday ? todayHoliday.name
              : isOpen    ? 'MCX is currently trading'
              : `Opens in ${Math.floor(minsLeft/60)}h ${minsLeft%60}m`}
          </div>
        </div>

        <div className="card" style={{padding:'16px',textAlign:'center'}}>
          <div style={{fontSize:11,color:'var(--text-muted)',textTransform:'uppercase',marginBottom:8}}>Next Holiday</div>
          {upcoming[0] && (
            <>
              <div style={{fontSize:16,fontWeight:700,color:'var(--text-primary)',marginBottom:4}}>
                {upcoming[0].name}
              </div>
              <div style={{fontSize:12,color:'var(--text-secondary)',marginBottom:4}}>
                {new Date(upcoming[0].date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}
              </div>
              <div style={{fontSize:11,padding:'3px 8px',borderRadius:5,display:'inline-block',
                background:`${HOLIDAY_COLORS[upcoming[0].type]}20`,
                color:HOLIDAY_COLORS[upcoming[0].type]}}>
                {upcoming[0].type}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:6,marginBottom:'1.2rem'}}>
        {[['clock','Trading Hours'],['holidays','Holidays 2026'],['expiry','Expiry Dates']].map(([k,l])=>(
          <button key={k} className={'tab-btn '+(tab===k?'active':'')} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </div>

      {/* Trading Hours */}
      {tab==='clock' && (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div className="card">
            <div style={{fontSize:14,fontWeight:600,color:'var(--text-secondary)',marginBottom:'1rem'}}>
              MCX TRADING SESSIONS (IST)
            </div>
            {[
              {label:'Morning Session',  open:'9:00 AM', close:'11:30 AM', icon:'🌅'},
              {label:'Evening Session',  open:'5:00 PM', close:'11:30 PM', icon:'🌙',note:'Till 11:55 PM for some contracts'},
            ].map((s,i)=>(
              <div key={i} style={{padding:'14px',background:'var(--bg-primary)',borderRadius:10,marginBottom:10}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                  <span style={{fontSize:13,fontWeight:600,color:'var(--text-primary)'}}>{s.icon} {s.label}</span>
                </div>
                <div style={{display:'flex',gap:16}}>
                  <div><div style={{fontSize:10,color:'var(--text-muted)'}}>OPEN</div>
                    <div style={{fontSize:16,fontWeight:700,color:'#22c55e'}}>{s.open}</div></div>
                  <div style={{fontSize:20,color:'var(--text-hint)',alignSelf:'center'}}>→</div>
                  <div><div style={{fontSize:10,color:'var(--text-muted)'}}>CLOSE</div>
                    <div style={{fontSize:16,fontWeight:700,color:'#ef4444'}}>{s.close}</div></div>
                </div>
                {s.note&&<div style={{fontSize:11,color:'var(--text-hint)',marginTop:6}}>{s.note}</div>}
              </div>
            ))}
            <div style={{fontSize:12,color:'var(--text-muted)',marginTop:4}}>
              Closed: Saturday, Sunday &amp; public holidays
            </div>
          </div>

          <div className="card">
            <div style={{fontSize:14,fontWeight:600,color:'var(--text-secondary)',marginBottom:'1rem'}}>
              TODAY'S SESSION STATUS
            </div>
            {[
              {label:'Morning',open:'09:00',close:'11:30'},
              {label:'Evening',open:'17:00',close:'23:30'},
            ].map((s,i)=>{
              const h=now.getHours(),m=now.getMinutes(),t=h*60+m
              const so=parseInt(s.open)*60+parseInt(s.open.split(':')[1])
              const sc=parseInt(s.close)*60+parseInt(s.close.split(':')[1])
              const active = t>=so&&t<sc
              const past   = t>=sc
              const pct    = active ? Math.round((t-so)/(sc-so)*100) : past?100:0
              return (
                <div key={i} style={{padding:'14px',background:'var(--bg-primary)',borderRadius:10,marginBottom:10}}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                    <span style={{fontSize:13,fontWeight:600,color:'var(--text-primary)'}}>{s.label} session</span>
                    <span style={{fontSize:12,fontWeight:600,
                      color:active?'#22c55e':past?'var(--text-hint)':'var(--text-muted)'}}>
                      {active?'🟢 LIVE':past?'✅ Closed':'⏳ Upcoming'}
                    </span>
                  </div>
                  <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:6}}>
                    {fmt12(s.open)} — {fmt12(s.close)}
                  </div>
                  <div style={{height:6,background:'var(--border)',borderRadius:3,overflow:'hidden'}}>
                    <div style={{width:pct+'%',height:'100%',
                      background:active?'#22c55e':past?'var(--border-strong)':'var(--border)',
                      borderRadius:3,transition:'width 1s'}}/>
                  </div>
                  {active&&<div style={{fontSize:11,color:'#22c55e',marginTop:4}}>{pct}% of session elapsed</div>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Holidays */}
      {tab==='holidays' && (
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead>
              <tr style={{borderBottom:'1px solid var(--border)'}}>
                {['Date','Day','Holiday Name','Type','Status'].map(h=>(
                  <th key={h} style={{padding:'11px 14px',textAlign:'left',fontSize:11,
                    color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MCX_HOLIDAYS_2026.map((h,i)=>{
                const d    = new Date(h.date)
                const past = h.date < today
                const isToday = h.date === today
                return (
                  <tr key={i} style={{borderBottom:'1px solid var(--bg-hover)',
                    opacity:past?0.5:1,
                    background:isToday?'rgba(245,158,11,0.08)':'transparent'}}
                    onMouseEnter={e=>e.currentTarget.style.background=isToday?'rgba(245,158,11,0.12)':'var(--bg-hover)'}
                    onMouseLeave={e=>e.currentTarget.style.background=isToday?'rgba(245,158,11,0.08)':'transparent'}>
                    <td style={{padding:'11px 14px',fontSize:13,fontWeight:600,color:'var(--text-primary)'}}>
                      {d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}
                    </td>
                    <td style={{padding:'11px 14px',fontSize:12,color:'var(--text-secondary)'}}>
                      {d.toLocaleDateString('en-IN',{weekday:'long'})}
                    </td>
                    <td style={{padding:'11px 14px',fontSize:13,color:'var(--text-primary)'}}>
                      {isToday && <span style={{fontSize:11,marginRight:8,color:'#f59e0b'}}>TODAY</span>}
                      {h.name}
                    </td>
                    <td style={{padding:'11px 14px'}}>
                      <span style={{fontSize:11,padding:'3px 8px',borderRadius:5,
                        background:`${HOLIDAY_COLORS[h.type]}20`,
                        color:HOLIDAY_COLORS[h.type],fontWeight:500}}>
                        {h.type}
                      </span>
                    </td>
                    <td style={{padding:'11px 14px',fontSize:12}}>
                      {past ? <span style={{color:'var(--text-hint)'}}>✅ Past</span>
                        : isToday ? <span style={{color:'#f59e0b',fontWeight:600}}>📅 Today</span>
                        : <span style={{color:'var(--text-secondary)'}}>🔜 Upcoming</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Expiry dates */}
      {tab==='expiry' && (
        <div>
          <div style={{display:'flex',gap:6,marginBottom:'1rem',flexWrap:'wrap'}}>
            {MCX_EXPIRY_2026.map((c,i)=>(
              <button key={i} className={'tab-btn '+(selComm===i?'active':'')}
                onClick={()=>setSelComm(i)} style={{fontSize:12,padding:'5px 12px'}}>
                {c.commodity.split(' ')[0]}
              </button>
            ))}
          </div>
          <div className="card" style={{padding:0,overflow:'hidden'}}>
            <div style={{padding:'12px 16px',borderBottom:'1px solid var(--border)',
              fontSize:13,fontWeight:600,color:'var(--text-secondary)'}}>
              {MCX_EXPIRY_2026[selComm].commodity} — Contract Expiry Dates 2026
            </div>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr style={{borderBottom:'1px solid var(--border)'}}>
                  {['Expiry Date','Day','Days Away','Status'].map(h=>(
                    <th key={h} style={{padding:'10px 14px',textAlign:'left',fontSize:11,
                      color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MCX_EXPIRY_2026[selComm].expiries.map((exp,i)=>{
                  const d       = new Date(exp)
                  const diff    = Math.round((d-now)/(1000*60*60*24))
                  const past    = diff < 0
                  const soon    = diff >= 0 && diff <= 7
                  const isNext  = !past && MCX_EXPIRY_2026[selComm].expiries.filter(e=>e>=today)[0]===exp
                  return (
                    <tr key={i} style={{borderBottom:'1px solid var(--bg-hover)',
                      background:isNext?'rgba(99,102,241,0.08)':past?'transparent':'transparent',
                      opacity:past?0.45:1}}
                      onMouseEnter={e=>e.currentTarget.style.background=isNext?'rgba(99,102,241,0.12)':'var(--bg-hover)'}
                      onMouseLeave={e=>e.currentTarget.style.background=isNext?'rgba(99,102,241,0.08)':past?'transparent':'transparent'}>
                      <td style={{padding:'11px 14px',fontSize:13,fontWeight:600,color:'var(--text-primary)'}}>
                        {isNext&&<span style={{fontSize:10,color:'#6366f1',marginRight:8,fontWeight:600}}>NEXT</span>}
                        {d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}
                      </td>
                      <td style={{padding:'11px 14px',fontSize:12,color:'var(--text-secondary)'}}>
                        {d.toLocaleDateString('en-IN',{weekday:'long'})}
                      </td>
                      <td style={{padding:'11px 14px',fontSize:13,
                        color:soon?'#f59e0b':past?'var(--text-hint)':'var(--text-primary)',fontWeight:soon?700:400}}>
                        {past?`${Math.abs(diff)} days ago`:diff===0?'Today!':diff+' days'}
                      </td>
                      <td style={{padding:'11px 14px',fontSize:12}}>
                        {past ? <span style={{color:'var(--text-hint)'}}>Expired</span>
                          : soon ? <span style={{color:'#f59e0b',fontWeight:600}}>⚠️ Expiring soon!</span>
                          : isNext ? <span style={{color:'#6366f1',fontWeight:600}}>Next expiry</span>
                          : <span style={{color:'var(--text-secondary)'}}>Future contract</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}