import { useEffect, useState } from "react";
import { api, ago, formatTime, snapshotUrl } from "../api.js";
import { useToast } from "../Toast.jsx";
import Analytics from "./Analytics.jsx";
import CameraFilter from "../CameraFilter.jsx";

function Hourly({ data }) {
  const max = Math.max(1, ...data);
  const bw = 480 / 24;
  return (
    <svg viewBox="0 0 480 150" className="chart" role="img" aria-label="Alerts per hour today">
      <line x1="0" y1="124" x2="480" y2="124" stroke="var(--line)" />
      {data.map((n, i) => {
        const h = n ? Math.max(4, (n / max) * 96) : 0;
        return (
          <g key={i}>
            {n > 0 && <>
              <rect x={i * bw + 4} y={124 - h} width={bw - 8} height={h} rx="2" fill="var(--teal)" />
              <text x={i * bw + bw / 2} y={119 - h} textAnchor="middle" fontSize="10" fill="var(--ink)">{n}</text>
            </>}
            {i % 3 === 0 && (
              <text x={i * bw + bw / 2} y="141" textAnchor="middle" fontSize="10" fill="var(--muted)">
                {String(i).padStart(2, "0")}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Face({ file, name, size = 36 }) {
  const style = { width: size, height: size };
  return file
    ? <img className="face" style={style} src={snapshotUrl(file)} alt={`Face of ${name}`} loading="lazy" />
    : <span className="face blank" style={{ ...style, fontSize: size / 2.2 }} aria-hidden="true">{(name || "?")[0]}</span>;
}

function duration(sec) {
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} min ${sec % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function PersonLink({ name, onOpen }) {
  return onOpen
    ? <button className="linkbtn" onClick={() => onOpen(name)} title={`Open ${name}'s profile`}>{name}</button>
    : <>{name}</>;
}

const RANGES = [[1, "Today"], [7, "7 days"], [30, "30 days"], [0, "All time"], [-1, "Custom"]];

const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const stored = (key, fallback) => {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
};

function Delta({ now, prev, label }) {
  if (prev == null || prev === 0 || now == null) return null;
  const diff = now - prev;
  if (diff === 0) return <small className="delta">Same as {label}</small>;
  return <small className="delta">{diff > 0 ? "▲" : "▼"} {Math.abs(diff)} {diff > 0 ? "more" : "fewer"} than {label}</small>;
}

export default function Dashboard({ alertSeq, onOpenPerson }) {
  const [d, setD] = useState(null);
  const [days, setDays] = useState(() => {
    try {
      const v = parseInt(localStorage.getItem("fw-days"), 10);
      return [-1, 0, 1, 7, 30].includes(v) ? v : 7;
    } catch { return 7; }
  });
  const pickRange = (v) => {
    setDays(v);
    try { localStorage.setItem("fw-days", String(v)); } catch { /* storage blocked */ }
  };
  const [from, setFrom] = useState(() => stored("fw-from", iso(new Date(Date.now() - 6 * 86400000))));
  const [to, setTo] = useState(() => stored("fw-to", iso(new Date())));
  const pickDate = (which, v) => {
    (which === "from" ? setFrom : setTo)(v);
    try { localStorage.setItem(which === "from" ? "fw-from" : "fw-to", v); } catch { /* storage blocked */ }
  };
  const custom = days === -1;
  const badRange = custom && (!from || !to || from > to);
  const [selected, setSelected] = useState(null);
  const [camera, setCamera] = useState("");
  const [hq, setHq] = useState("");
  const [hpage, setHpage] = useState(0);
  const [err, setErr] = useState("");
  const toast = useToast();
  const [health, setHealth] = useState(null);
  useEffect(() => {
    const go = () => api.health().then(setHealth).catch((e) => setHealth({ error: e.message }));
    go();
    const id = setInterval(go, 5000);
    return () => clearInterval(id);
  }, []);

  const load = () => {
    if (badRange) return Promise.resolve();
    return api.dashboard(custom ? 0 : days, custom ? from : "", custom ? to : "", camera).then(setD).catch((e) => setErr(e.message));
  };
  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [days, alertSeq, from, to, camera]);

  const clear = async () => {
    if (!window.confirm("Delete the alert history? Snapshot pictures are kept.")) return;
    await api.clearAlerts();
    toast("History cleared");
    setSelected(null);
    load();
  };

  if (!d) return <p className="muted">{err || "Loading..."}</p>;
  const sel = d.history.find((r) => r.id === selected);
  const hneedle = hq.trim().toLowerCase();
  const hfiltered = d.history.filter((r) => !hneedle || r.name.toLowerCase().includes(hneedle) || (r.source || "").toLowerCase().includes(hneedle) || formatTime(r.time).toLowerCase().includes(hneedle));
  const HPAGE = 10;
  const hpages = Math.max(1, Math.ceil(hfiltered.length / HPAGE));
  const hcur = Math.min(hpage, hpages - 1);
  const hrows = hfiltered.slice(hcur * HPAGE, hcur * HPAGE + HPAGE);
  const present = d.visits.filter((v) => v.active);
  const rangeLabel = RANGES.find(([v]) => v === days)[1];
  const prevLabel = days === 1 ? "yesterday" : `the previous ${d.span_days} days`;
  const showRange = days > 1 || custom;
  const totalAll = d.by_person.reduce((n, p) => n + p.total, 0);
  const top = [...d.by_person].sort((a, b) => b.total - a.total).slice(0, 5);

  return (
    <section>
      <header className="head">
        <div>
          <h2>Dashboard</h2>
          <p className="muted">Overview of monitoring activity and recognition statistics.</p>
        </div>
        <div className="row">
          <div className="seg" role="group" aria-label="Date range">
            {RANGES.map(([v, l]) => (
              <button key={v} className={days === v ? "on" : ""} aria-pressed={days === v} onClick={() => pickRange(v)}>{l}</button>
            ))}
          </div>
          <CameraFilter value={camera} onChange={setCamera} />
          {custom && (
            <>
              <input type="date" aria-label="From date" value={from} max={iso(new Date())} onChange={(e) => pickDate("from", e.target.value)} />
              <input type="date" aria-label="To date" value={to} max={iso(new Date())} onChange={(e) => pickDate("to", e.target.value)} />
            </>
          )}
          <a className="btn" href="/api/alerts/export" download>Export CSV</a>
          <button className="btn danger-o admin-only" onClick={clear}>Clear history</button>
        </div>
      </header>

      {badRange && <p className="note error" role="alert">Choose a start date that is not after the end date.</p>}

      <div className="stats">
        <div className="card stat"><span>Alerts · {rangeLabel}</span><b>{d.range_alerts}</b><Delta now={d.range_alerts} prev={d.prev_alerts} label={prevLabel} /></div>
        <div className="card stat"><span>Visits · {rangeLabel}</span><b>{d.range_visits}</b><Delta now={d.range_visits} prev={d.prev_visits} label={prevLabel} /></div>
        <div className="card stat"><span>Currently present</span><b>{present.length}</b></div>
        <div className="card stat"><span>People tracked</span><b>{d.people}</b></div>
        <div className="card stat">
          <span>Last alert</span>
          <b className="small">{d.last ? `${formatTime(d.last.time, false)} ${d.last.name}` : "none yet"}</b>
        </div>
      </div>

      <Analytics days={custom ? 0 : days} from={custom ? from : ""} to={custom ? to : ""} disabled={badRange} alertSeq={alertSeq} camera={camera} />

      {d.by_camera && d.by_camera.length > 0 && (
        <div className="card gallery-card">
          <h3>Visits by camera · {rangeLabel}</h3>
          <div className="scroll">
            <table>
              <thead><tr><th>Camera</th><th>Visits</th><th>People</th><th>Alerts</th></tr></thead>
              <tbody>
                {d.by_camera.map((c) => (
                  <tr key={c.name}><td>{c.name}{c.location && <span className="muted"> ({c.location})</span>}</td><td>{c.visits}</td><td>{c.people}</td><td>{c.alerts}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted visits-note">Counts all cameras, even when a camera is chosen above. A person seen by two cameras counts once for each.</p>
        </div>
      )}

      <div className="grid2">
        <div className="card">
          <h3>Currently present</h3>
          {present.length === 0
            ? <p className="muted">Nobody is in view right now.</p>
            : <ul className="present">{present.map((v, i) => (
                <li key={i}>
                  <Face file={v.face} name={v.name} size={48} />
                  <div><strong><PersonLink name={v.name} onOpen={onOpenPerson} /></strong><span className="muted">since {formatTime(v.start, false)}</span></div>
                </li>
              ))}</ul>}
        </div>
        <div className="card">
          <h3>Top people</h3>
          {totalAll === 0
            ? <p className="muted">Alert counts per person appear here.</p>
            : <ul className="bars">{top.map((p) => {
                const pct = Math.round((p.total / totalAll) * 100);
                return (
                  <li key={p.name}>
                    <span>{p.name}</span>
                    <div className="bar"><i style={{ width: `${pct}%` }} /></div>
                    <b>{pct}%</b>
                  </li>
                );
              })}</ul>}
        </div>
      </div>

      <div className="card gallery-card">
        <h3>System health</h3>
        {!health ? <p className="muted">Loading...</p> : health.error ? (
          <p className="note error">Health check failed: {health.error}. Restart the backend with the new main.py and extras.py.</p>
        ) : (
          <>
            <ul className="bars">
              {[["CPU", health.cpu], ["Memory", health.ram], ["Disk", health.disk]].map(([l, v]) => v == null ? null : (
                <li key={l}>
                  <span>{l}</span>
                  <div className="bar"><i className={v > 85 ? "hot" : ""} style={{ width: `${v}%` }} /></div>
                  <b>{v}%</b>
                </li>
              ))}
            </ul>
            {health.cpu == null && <p className="muted visits-note">To see CPU and memory, run: pip install psutil</p>}
            <p className="muted visits-note">
              {health.running ? `Watching at ${Number(health.fps).toFixed(0)} FPS` : "Not watching"} {health.app_mb != null ? `· FaceWatch uses ${health.app_mb} MB of memory ` : ""}· pictures use {health.pictures_mb} MB · {health.disk_free_gb} GB free on this drive
            </p>
          </>
        )}
      </div>

      <div className="card gallery-card">
        <h3>Latest sightings</h3>
        {d.history.length === 0
          ? <p className="muted">When a person is seen, their face photo appears here.</p>
          : <ul className="gallery">
              {d.history.slice(0, 12).map((r) => (
                <li key={r.id}>
                  <button className={`tile ${r.id === selected ? "sel" : ""}`} onClick={() => setSelected(r.id)}
                          aria-label={`${r.name}, ${formatTime(r.time)}`}>
                    <Face file={r.face} name={r.name} size={120} />
                    <strong>{r.name}</strong>
                    <span title={formatTime(r.time)}>{ago(r.time)}  ·  {r.score}</span>
                  </button>
                </li>
              ))}
            </ul>}
      </div>

      <div className="card gallery-card">
        <h3>Visits</h3>
        <p className="muted visits-note">
          One row per visit. Time present is from the first to the last alert, so it can be a few seconds short.
        </p>
        <div className="scroll">
          <table>
            <thead><tr><th></th><th>Person</th><th>Arrived</th><th>Last seen</th><th>Time present</th><th>Alerts</th></tr></thead>
            <tbody>
              {d.visits.length === 0 && <tr><td colSpan="6" className="muted">No visits yet.</td></tr>}
              {d.visits.map((v, i) => (
                <tr key={i}>
                  <td><Face file={v.face} name={v.name} size={32} /></td>
                  <td><PersonLink name={v.name} onOpen={onOpenPerson} /> {v.active && <span className="tag-now">now</span>}</td>
                  <td>{formatTime(v.start)}</td>
                  <td>{formatTime(v.end, false)}</td>
                  <td>{duration(v.seconds)}</td>
                  <td>{v.alerts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Alerts per hour today</h3>
          {d.hourly.some((n) => n > 0)
            ? <Hourly data={d.hourly} />
            : <p className="muted">No alerts yet today. Bars appear here when a saved person is seen.</p>}
        </div>
        <div className="card">
          <h3>By person</h3>
          <table>
            <thead><tr><th>Person</th><th>Today</th>{showRange && <th>{rangeLabel}</th>}<th>Total</th><th>Last seen</th></tr></thead>
            <tbody>
              {d.by_person.length === 0 && <tr><td colSpan="5" className="muted">No people yet.</td></tr>}
              {d.by_person.map((p) => (
                <tr key={p.name}><td className="who"><Face file={p.face} name={p.name} size={28} /><PersonLink name={p.name} onOpen={onOpenPerson} /></td><td>{p.today}</td>{showRange && <td>{p.range}</td>}<td>{p.total}</td><td>{formatTime(p.last)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Alert history, newest first</h3>
          <div className="row no-print" style={{ marginBottom: 10 }}>
            <input type="search" className="search" aria-label="Search alert history" placeholder="Search person, camera or date" value={hq}
                   onChange={(e) => { setHq(e.target.value); setHpage(0); }} />
          </div>
          <div className="scroll">
            <table className="clickable">
              <thead><tr><th></th><th>Time</th><th>Person</th><th>Score</th><th>Source</th></tr></thead>
              <tbody>
                {hfiltered.length === 0 && <tr><td colSpan="5" className="muted">{d.history.length === 0 ? "No alerts yet." : "Nothing matches your search."}</td></tr>}
                {hrows.map((r) => (
                  <tr key={r.id} className={r.id === selected ? "sel" : ""} tabIndex={0}
                      onClick={() => setSelected(r.id)}
                      onKeyDown={(e) => e.key === "Enter" && setSelected(r.id)}>
                    <td><Face file={r.face} name={r.name} size={32} /></td><td>{formatTime(r.time)}</td><td>{r.name}</td><td>{r.score}</td><td>{r.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span>Page {hcur + 1} of {hpages}</span>
            <span className="row">
              <button className="btn btn-sm" disabled={hcur === 0} onClick={() => setHpage(hcur - 1)} aria-label="Previous page">‹</button>
              <button className="btn btn-sm" disabled={hcur >= hpages - 1} onClick={() => setHpage(hcur + 1)} aria-label="Next page">›</button>
            </span>
          </div>
        </div>
        <div className="card">
          <h3>Sighting details</h3>
          {!sel && <p className="muted">Select a sighting to see the face and the full picture.</p>}
          {sel && (
            <div className="detail">
              <p><strong><PersonLink name={sel.name} onOpen={onOpenPerson} /></strong><span className="muted">  {formatTime(sel.time)}  ·  score {sel.score}  ·  {sel.source}</span></p>
              {(sel.snapshot || sel.face)
                ? <>
                    {sel.face && <><h4>Face</h4><img className="snap face-big" src={snapshotUrl(sel.face)} alt={`Face of ${sel.name}`} /></>}
                    {sel.snapshot && <><h4>Full picture</h4><img className="snap" src={snapshotUrl(sel.snapshot)} alt={`Snapshot of ${sel.name}`} /></>}
                  </>
                : <p className="muted">No picture is available (it was turned off, or deleted to save space).</p>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}