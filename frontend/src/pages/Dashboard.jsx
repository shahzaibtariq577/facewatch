import { useEffect, useState } from "react";
import { api, formatTime, snapshotUrl } from "../api.js";

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

export default function Dashboard({ alertSeq }) {
  const [d, setD] = useState(null);
  const [selected, setSelected] = useState(null);
  const [err, setErr] = useState("");

  const load = () => api.dashboard().then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [alertSeq]);
  useEffect(() => {
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const clear = async () => {
    if (!window.confirm("Delete the alert history? Snapshot pictures are kept.")) return;
    await api.clearAlerts();
    setSelected(null);
    load();
  };

  if (!d) return <p className="muted">{err || "Loading..."}</p>;
  const sel = d.history.find((r) => r.id === selected);

  return (
    <section>
      <header className="head">
        <h2>Dashboard</h2>
        <div className="row">
          <a className="btn" href="/api/alerts/export" download>Export CSV</a>
          <button className="btn" onClick={clear}>Clear history</button>
        </div>
      </header>

      <div className="stats">
        <div className="card stat"><span>Alerts today</span><b>{d.today}</b></div>
        <div className="card stat"><span>Visits today</span><b>{d.visits_today}</b></div>
        <div className="card stat"><span>Total alerts</span><b>{d.total}</b></div>
        <div className="card stat"><span>People tracked</span><b>{d.people}</b></div>
        <div className="card stat">
          <span>Last alert</span>
          <b className="small">{d.last ? `${formatTime(d.last.time, false)} ${d.last.name}` : "none yet"}</b>
        </div>
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
                    <span>{formatTime(r.time, false)}  ·  {r.score}</span>
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
                  <td>{v.name} {v.active && <span className="tag-now">now</span>}</td>
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
        <div className="card"><h3>Alerts per hour today</h3><Hourly data={d.hourly} /></div>
        <div className="card">
          <h3>By person</h3>
          <table>
            <thead><tr><th>Person</th><th>Today</th><th>Total</th><th>Last seen</th></tr></thead>
            <tbody>
              {d.by_person.length === 0 && <tr><td colSpan="4" className="muted">No people yet.</td></tr>}
              {d.by_person.map((p) => (
                <tr key={p.name}><td className="who"><Face file={p.face} name={p.name} size={28} />{p.name}</td><td>{p.today}</td><td>{p.total}</td><td>{formatTime(p.last)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Alert history, newest first</h3>
          <div className="scroll">
            <table className="clickable">
              <thead><tr><th></th><th>Time</th><th>Person</th><th>Score</th><th>Source</th></tr></thead>
              <tbody>
                {d.history.length === 0 && <tr><td colSpan="5" className="muted">No alerts yet.</td></tr>}
                {d.history.map((r) => (
                  <tr key={r.id} className={r.id === selected ? "sel" : ""} tabIndex={0}
                      onClick={() => setSelected(r.id)}
                      onKeyDown={(e) => e.key === "Enter" && setSelected(r.id)}>
                    <td><Face file={r.face} name={r.name} size={32} /></td><td>{formatTime(r.time)}</td><td>{r.name}</td><td>{r.score}</td><td>{r.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h3>Sighting details</h3>
          {!sel && <p className="muted">Select a sighting to see the face and the full picture.</p>}
          {sel && (
            <div className="detail">
              <p><strong>{sel.name}</strong><span className="muted">  {formatTime(sel.time)}  ·  score {sel.score}  ·  {sel.source}</span></p>
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