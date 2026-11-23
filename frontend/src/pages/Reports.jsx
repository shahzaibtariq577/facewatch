import { useEffect, useState } from "react";
import { api, formatTime, reportCsvUrl } from "../api.js";
import { useToast } from "../Toast.jsx";

const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const dur = (s) => (s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`);
const hourRange = (h) => `${String(h).padStart(2, "0")}:00 to ${String((h + 1) % 24).padStart(2, "0")}:00`;

export default function Reports({ onOpenPerson }) {
  const today = iso(new Date());
  const [date, setDate] = useState(today);
  const [rep, setRep] = useState(null);
  const [err, setErr] = useState("");
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    const load = () => api.report(date).then((r) => { if (alive) { setRep(r); setErr(""); } }).catch((e) => { if (alive) setErr(e.message); });
    setRep(null);
    load();
    const id = setInterval(load, 15000);
    return () => { alive = false; clearInterval(id); };
  }, [date]);

  useEffect(() => { api.settings().then(setSettings).catch(() => {}); }, []);

  const move = (n) => {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + n);
    const v = iso(d);
    if (v <= today) setDate(v);
  };

  const save = async (patch) => {
    setSettings((s) => ({ ...s, ...patch }));
    try { await api.saveSettings(patch); toast("Settings saved"); } catch (e) { toast(e.message, "error"); }
  };
  const sendNow = async () => {
    setBusy(true);
    try { await api.sendReport(date); toast("Summary sent to your phone"); } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  const label = new Date(`${date}T00:00:00`).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <section>
      <header className="head">
        <h2>Daily report</h2>
        <div className="row no-print">
          <button className="btn" onClick={() => move(-1)} aria-label="Previous day">‹ Previous</button>
          <input type="date" aria-label="Report date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <button className="btn" onClick={() => move(1)} disabled={date >= today} aria-label="Next day">Next ›</button>
          {date !== today && <button className="btn" onClick={() => setDate(today)}>Today</button>}
        </div>
      </header>
      <p className="muted lede">{label}. This report shows who was seen and when. It does not rate or judge anyone.</p>
      {err && <p className="note error" role="alert">{err}</p>}

      {!rep ? <p className="muted">{err ? "" : "Loading..."}</p> : (
        <>
          {rep.is_today && <p className="muted visits-note">Today is not finished yet. The numbers change as people are seen.</p>}
          <div className="stats">
            <div className="card stat"><span>People seen</span><b>{rep.people_seen}</b></div>
            <div className="card stat"><span>Visits</span><b>{rep.visits}</b></div>
            <div className="card stat"><span>Time present</span><b>{dur(rep.seconds)}</b></div>
            <div className="card stat"><span>Busiest hour</span><b className="small">{rep.busiest_hour == null ? "-" : hourRange(rep.busiest_hour)}</b></div>
            <div className="card stat"><span>Not recognised</span><b>{rep.unknown_events}</b></div>
            <div className="card stat"><span>Camera problems</span><b>{rep.camera_problems}</b></div>
          </div>

          <div className="card gallery-card">
            <div className="head">
              <h3>Who was seen</h3>
              <div className="row no-print">
                <button className="btn" onClick={() => window.print()}>Print</button>
                <a className="btn" href={reportCsvUrl(date)} download>Export CSV</a>
              </div>
            </div>
            <div className="scroll">
              <table>
                <thead><tr><th>Person</th><th>First seen</th><th>Last seen</th><th>Visits</th><th>Time present</th><th>Alerts</th></tr></thead>
                <tbody>
                  {rep.people.length === 0 && <tr><td colSpan="6" className="muted">Nobody was seen on this day.</td></tr>}
                  {rep.people.map((p) => (
                    <tr key={p.name}>
                      <td><button className="linkbtn" onClick={() => onOpenPerson(p.name)}>{p.name}</button></td>
                      <td>{formatTime(p.first, false)}</td><td>{formatTime(p.last, false)}</td>
                      <td>{p.visits}</td><td>{dur(p.seconds)}</td><td>{p.alerts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted visits-note">Time present is from the first to the last alert of each visit, so it can be a few seconds short.</p>
          </div>

          <div className="card gallery-card">
            <h3>Not seen on this day</h3>
            {rep.not_seen.length === 0
              ? <p className="muted">{rep.people_seen ? "Everyone saved was seen." : "No saved people."}</p>
              : <ul className="chips">{rep.not_seen.map((n) => <li key={n}>{n}</li>)}</ul>}
          </div>
        </>
      )}

      <div className="card no-print">
        <h3>Daily summary to your phone</h3>
        {!settings ? <p className="muted">Loading...</p> : (
          <>
            <div className="row sumrow">
              <label className="check">
                <input type="checkbox" checked={!!settings.daily_summary} onChange={(e) => save({ daily_summary: e.target.checked })} />
                Send a short summary every day at
              </label>
              <input type="time" aria-label="Summary time" value={settings.daily_summary_time || "18:00"}
                     onChange={(e) => e.target.value && save({ daily_summary_time: e.target.value })} />
              <button className="btn" disabled={busy} onClick={sendNow}>Send now</button>
            </div>
            <p className="muted visits-note">
              {settings.ntfy_topic ? "Sent through your ntfy topic." : "Type an ntfy topic in Settings first, or the message cannot be sent."}
              {" "}"Send now" sends the summary of the day shown above. The backend must be running at the chosen time.
            </p>
          </>
        )}
      </div>
    </section>
  );
}