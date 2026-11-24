import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { api, auditCsvUrl, formatTime } from "../api.js";

const FILTERS = [["", "All"], ["login", "Logins"], ["people", "People"], ["data", "Data"], ["settings", "Settings"], ["control", "Control"], ["users", "Users"]];
const LABEL = { login: "Login", people: "People", data: "Data", settings: "Settings", control: "Control", users: "Users", other: "Other" };

export default function Audit() {
  const [cat, setCat] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const bad = from && to && from > to;

  useEffect(() => {
    if (bad) return undefined;
    let alive = true;
    const go = () => api.audit(cat, from, to)
      .then((d) => { if (alive) { setData(d); setErr(""); } })
      .catch((e) => { if (alive) setErr(e.message); });
    go();
    const id = setInterval(go, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [cat, from, to, bad]);

  return (
    <section>
      <header className="head">
        <div>
          <h2>Audit log</h2>
          <p className="muted">Review administrative actions and application activity.</p>
        </div>
        <div className="row">
          <div className="seg" role="group" aria-label="Type">
            {FILTERS.map(([v, l]) => (
              <button key={v || "all"} className={cat === v ? "on" : ""} aria-pressed={cat === v} onClick={() => setCat(v)}>{l}</button>
            ))}
          </div>
          <input type="date" aria-label="From date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" aria-label="To date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          {(from || to) && <button className="btn" onClick={() => { setFrom(""); setTo(""); }}>Clear dates</button>}
          <a className="btn" href={auditCsvUrl(cat, from, to)} download><Download size={14} aria-hidden="true" /> Export CSV</a>
        </div>
      </header>
      {data && (
        <div className="stats s2">
          <div className="card stat"><span>Events saved</span><b>{data.total}</b></div>
          <div className="card stat"><span>Matching this filter</span><b>{data.shown}</b></div>
        </div>
      )}
      <p className="muted lede">
        A saved list of who changed what: logins, people, deleted data, settings and start/stop.
        Passwords and setting values are never saved here. Only changes are logged, not just looking at a page.
      </p>
      {bad && <p className="note error" role="alert">The start date is after the end date.</p>}
      {err && <p className="note error" role="alert">{err}</p>}
      {!data ? <p className="muted">Loading...</p> : (
        <div className="card scroll">
          <table>
            <thead><tr><th>Time</th><th>Type</th><th>Who</th><th>What happened</th><th>From</th><th>Result</th></tr></thead>
            <tbody>
              {data.items.length === 0 && (
                <tr><td colSpan="6" className="muted">{data.total === 0 ? "Nothing logged yet. Changes you make will appear here." : "Nothing matches this filter."}</td></tr>
              )}
              {data.items.map((x) => (
                <tr key={x.id}>
                  <td>{formatTime(x.time)}</td>
                  <td><span className="pill-s">{LABEL[x.category] || x.category}</span></td>
                  <td>{x.user || "-"}</td>
                  <td>{x.text}</td>
                  <td>{x.ip || "-"}</td>
                  <td>{x.ok ? <span className="pill-s ok">OK</span> : <span className="pill-s err">Failed</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted"><small>Showing {data.items.length} of {data.shown} matching events ({data.total} saved in total, newest first).</small></p>
        </div>
      )}
    </section>
  );
}