import { useEffect, useState } from "react";
import { api } from "../api.js";

function Bars({ data, peak = -1, every = 1, label }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const slot = 480 / Math.max(data.length, 1);
  const bw = Math.min(slot - 6, 44);
  return (
    <svg viewBox="0 0 480 150" className="chart" role="img" aria-label={label}>
      <line x1="0" y1="124" x2="480" y2="124" stroke="var(--line)" />
      {data.map((d, i) => {
        const h = d.value ? Math.max(4, (d.value / max) * 96) : 0;
        const x = i * slot + (slot - bw) / 2;
        return (
          <g key={i}>
            {d.value > 0 && <>
              <rect x={x} y={124 - h} width={bw} height={h} rx="2" fill={i === peak ? "var(--amber)" : "var(--teal)"} />
              {data.length <= 24 && <text x={x + bw / 2} y={119 - h} textAnchor="middle" fontSize="10" fill="var(--ink)">{d.value}</text>}
            </>}
            {i % every === 0 && <text x={x + bw / 2} y="141" textAnchor="middle" fontSize="10" fill="var(--muted)">{d.label}</text>}
          </g>
        );
      })}
    </svg>
  );
}

const day = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString([], { day: "numeric", month: "short" });
const hourRange = (h) => `${String(h).padStart(2, "0")}:00 to ${String((h + 1) % 24).padStart(2, "0")}:00`;
const dur = (s) => (s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`);

export default function Analytics({ days, from, to, disabled, alertSeq }) {
  const [a, setA] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (disabled) return undefined;
    let alive = true;
    const load = () => api.analytics(days, from, to)
      .then((d) => { if (alive) { setA(d); setErr(""); } })
      .catch((e) => { if (alive) setErr(e.message); });
    load();
    const id = setInterval(load, 10000);
    return () => { alive = false; clearInterval(id); };
  }, [days, from, to, disabled, alertSeq]);

  if (!a) return <div className="card gallery-card"><h3>Analytics</h3><p className="muted">{err || "Loading..."}</p></div>;

  const peak = a.hourly.some((n) => n > 0) ? a.hourly.indexOf(Math.max(...a.hourly)) : -1;
  const dailyData = a.daily.map((d) => ({ label: day(d.date), value: d.visits }));
  const step = Math.max(1, Math.ceil(dailyData.length / 8));
  const weeklyData = a.weekly.map((w) => ({ label: day(w.week), value: w.visits }));
  const repeatPct = a.visits ? Math.round((a.repeat_visits / a.visits) * 100) : 0;

  return (
    <>
      <div className="grid2">
        <div className="card">
          <h3>Visits per day</h3>
          {a.visits === 0
            ? <p className="muted">No visits in this period.</p>
            : <Bars data={dailyData} every={step} label="Visits per day" />}
          {a.daily_capped && <p className="muted visits-note">Showing the last 31 days of the range.</p>}
        </div>
        <div className="card">
          <h3>Busiest hours</h3>
          {peak < 0
            ? <p className="muted">No visits in this period.</p>
            : <>
                <Bars data={a.hourly.map((n, h) => ({ label: String(h).padStart(2, "0"), value: n }))} peak={peak} every={3} label="Visits by hour of day" />
                <p className="visits-note">Busiest: <strong>{hourRange(peak)}</strong> ({a.hourly[peak]} {a.hourly[peak] === 1 ? "visit" : "visits"}). Hours use when each visit started.</p>
              </>}
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Weekly trend</h3>
          {a.weekly.every((w) => w.visits === 0)
            ? <p className="muted">No visits in the last 8 weeks.</p>
            : <Bars data={weeklyData} every={1} label="Visits per week, last 8 weeks" />}
          <p className="muted visits-note">Last 8 weeks, each bar starts on a Monday. It does not change with the date range.</p>
        </div>
        <div className="card">
          <h3>First-time and repeat visits</h3>
          {a.visits === 0
            ? <p className="muted">No visits in this period.</p>
            : <>
                <div className="astats">
                  <div><span>Visits</span><b>{a.visits}</b></div>
                  <div><span>People</span><b>{a.people}</b></div>
                  <div><span>Average stay</span><b>{dur(a.avg_seconds)}</b></div>
                </div>
                <div className="split" role="img" aria-label={`${a.first_time_visits} first-time visits, ${a.repeat_visits} repeat visits`}>
                  <i style={{ width: `${100 - repeatPct}%` }} />
                </div>
                <ul className="alegend">
                  <li><i className="k1" /> First-time visits <b>{a.first_time_visits}</b></li>
                  <li><i className="k2" /> Repeat visits <b>{a.repeat_visits}</b></li>
                  <li>New people <b>{a.new_people}</b></li>
                  <li>Returning people <b>{a.returning_people}</b></li>
                </ul>
                <p className="muted visits-note">"First-time" means the first visit in the saved history. If you clear the history, everyone starts again as new.</p>
              </>}
        </div>
      </div>
    </>
  );
}