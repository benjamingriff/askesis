import React from 'react';
import { createRoot } from 'react-dom/client';
import { CalendarDays, Flag, Gauge, Mountain, Search, TimerReset, Zap } from 'lucide-react';
import { loadPlan } from './data/loadPlan';
import type { Session, Week } from './data/schema';
import './styles.css';

const data = loadPlan();

function typeIcon(type: string) {
  if (type.includes('hill')) return <Mountain />;
  if (type === 'test') return <Flag />;
  if (type === 'long') return <TimerReset />;
  if (type === 'steady') return <Gauge />;
  return <Zap />;
}

function IntervalStack({ session }: { session: Session }) {
  return <div className="intervals">{session.intervals.map((i, idx) => <div className={`interval ${i.type}`} key={i.id} style={{'--delay': `${idx*45}ms`} as React.CSSProperties}>
    <span className="bar"/><div><b>{i.type.replaceAll('_',' ')}</b><p>{i.value} {i.unit} · {i.intensity}{i.recovery_or_pace ? ` · ${i.recovery_or_pace}` : ''}</p></div>
  </div>)}</div>;
}

function SessionCard({ session }: { session: Session }) {
  return <article className={`session ${session.priority} ${session.type}`}>
    <div className="sessionTop"><div className="glyph">{typeIcon(session.type)}</div><div><small>{session.day} · {session.date}</small><h3>{session.title}</h3></div><b>{session.estimated_distance_km}km</b></div>
    <p className="summary">{session.summary}</p>
    <div className="tags">{session.tags.map(t => <span key={t}>{t}</span>)}</div>
    <IntervalStack session={session}/>
  </article>;
}

function WeekView({ week, active, onPick }: { week: Week, active: boolean, onPick:()=>void }) {
  return <section className={active ? 'week active' : 'week'} onClick={onPick}>
    <div className="weekHead"><span>Week {week.number}</span><b>{week.target_volume_km}km</b></div>
    <h2>{week.theme}</h2>
    <div className="miniDays">{week.sessionObjects.map(s => <i key={s.id} className={s.type} title={s.title}>{s.day[0]}</i>)}</div>
  </section>;
}

function App() {
  const [weekNo, setWeekNo] = React.useState(1);
  const [query, setQuery] = React.useState('');
  const activeWeek = data.weeks.find(w => w.number === weekNo) ?? data.weeks[0];
  const sessions = activeWeek.sessionObjects.filter(s => [s.title,s.summary,s.type,...s.tags].join(' ').toLowerCase().includes(query.toLowerCase()));
  const totalImported = data.sessions.reduce((a,s)=>a+s.estimated_distance_km,0);
  return <main>
    <div className="aurora"/>
    <header className="hero">
      <div className="kicker"><CalendarDays size={16}/> file-backed prototype · {data.sessions.length} sessions imported</div>
      <h1>{data.plan.title}<span> / Blocksmith</span></h1>
      <p>AI-editable YAML storage rendered as a mobile training cockpit. First cut seeded from the Cardiff plan: metadata, five phases, and Weeks 1–4 as standalone session files.</p>
      <div className="stats"><div><small>Primary</small><b>{data.plan.goals.primary.label}</b><em>{data.plan.goals.primary.pace_per_km}/km</em></div><div><small>Race</small><b>{data.plan.race.date}</b><em>{data.plan.race.distance}</em></div><div><small>VDOT</small><b>{data.plan.vdot.current}</b><em>baseline {data.plan.vdot.baseline}</em></div><div><small>Imported load</small><b>{totalImported.toFixed(1)}km</b><em>first vertical slice</em></div></div>
    </header>

    <section className="phases">{data.phases.map(p => <div className="phase" key={p.id} style={{'--accent': p.accent ?? '#fff'} as React.CSSProperties}><span>0{p.number}</span><b>{p.title}</b><small>Weeks {p.weeks[0]}–{p.weeks.at(-1)}</small></div>)}</section>

    <div className="toolbar"><div><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Filter this week: hills, easy, deload, test…" /></div></div>

    <section className="layout">
      <aside className="rail">{data.weeks.map(w => <WeekView key={w.id} week={w} active={w.number===weekNo} onPick={()=>setWeekNo(w.number)}/>)}</aside>
      <section className="briefing"><div className="briefHead"><div><small>{activeWeek.date_range.start} → {activeWeek.date_range.end}</small><h2>Week {activeWeek.number} briefing</h2></div><b>{activeWeek.target_volume_km}km target</b></div><div className="cards">{sessions.map(s => <SessionCard key={s.id} session={s}/>)}</div></section>
      <aside className="notes"><h3>Guardrails</h3>{data.plan.guardrails.map(g=><p key={g}>{g}</p>)}<h3>Zones</h3>{Object.entries(data.plan.zones).map(([k,z])=><div className="zone" key={k}><b>{k}</b><span>{z.pace_per_km}/km</span><small>{z.feel}</small></div>)}</aside>
    </section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
