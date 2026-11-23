import { useEffect, useState } from "react";
import { BellOff } from "lucide-react";
import { api, formatTime } from "../api.js";
import { useToast } from "../Toast.jsx";

const CHOICES = [[1, "1 hour"], [4, "4 hours"], [8, "8 hours"], [24, "24 hours"]];

function left(m) {
  if (m < 60) return `${m} min left`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min left` : `${h} h left`;
}

export default function Quiet({ onChanged }) {
  const toast = useToast();
  const [q, setQ] = useState(null);
  const [people, setPeople] = useState([]);
  const [hours, setHours] = useState({});     // chosen hours per person
  const [allHours, setAllHours] = useState(1);
  const [err, setErr] = useState("");

  const load = () => api.quiet().then((d) => { setQ(d); setErr(""); }).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    api.people().then(setPeople).catch(() => {});
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  const run = async (fn, msg) => {
    setErr("");
    try {
      setQ(await fn());
      toast(msg);
      onChanged?.();
    } catch (e) {
      setErr(e.message);
    }
  };

  if (!q) return (
    <section>
      <div className="head"><h2>Ignore</h2></div>
      {err ? <p className="note error" role="alert">{err}</p> : <p className="muted">Loading...</p>}
    </section>
  );
  const active = Object.fromEntries(q.people.map((p) => [p.name.toLowerCase(), p]));

  return (
    <section>
      <div className="head"><h2>Ignore for a while</h2></div>
      <p className="muted">Use this when you expect people to come and go, for example during a meeting.
        Visits are still recorded, so the Dashboard and Reports stay complete.</p>
      {err && <p className="note error" role="alert">{err}</p>}

      <div className="card qt-block">
        <h3><BellOff size={16} aria-hidden="true" /> Everyone: phone alerts</h3>
        <p className="muted">Stops all phone messages (arrivals, not seen, not recognised faces). The daily summary
          and the Test button still send. Notices inside the app still appear.</p>
        {q.all ? (
          <div className="row">
            <span className="qt-on">Ignored until {formatTime(q.all.until, false)} ({left(q.all.minutes_left)})</span>
            <button className="btn" onClick={() => run(() => api.clearQuiet("all"), "Phone alerts are back on")}>Stop ignoring</button>
          </div>
        ) : (
          <div className="row">
            <select value={allHours} onChange={(e) => setAllHours(Number(e.target.value))} aria-label="How long">
              {CHOICES.map(([h, l]) => <option key={h} value={h}>{l}</option>)}
            </select>
            <button className="btn primary" onClick={() => run(() => api.setQuiet("all", allHours), "Phone alerts ignored")}>Ignore phone alerts</button>
          </div>
        )}
      </div>

      <div className="card qt-block">
        <h3>One person</h3>
        <p className="muted">Stops that person's phone messages and their notices in the app (arrived, back in view,
          not seen). Their visits are still logged.</p>
        {people.length === 0 && <p className="muted">No saved people yet.</p>}
        <ul className="qt-list">
          {people.map((p) => {
            const a = active[p.name.toLowerCase()];
            return (
              <li key={p.name}>
                <b>{p.name}</b>
                {a ? (
                  <span className="row">
                    <span className="qt-on">Ignored until {formatTime(a.until, false)} ({left(a.minutes_left)})</span>
                    <button className="btn" onClick={() => run(() => api.clearQuiet("person", p.name), `${p.name} is no longer ignored`)}>Stop ignoring</button>
                  </span>
                ) : (
                  <span className="row">
                    <select value={hours[p.name] || 1} aria-label={`How long to ignore ${p.name}`}
                            onChange={(e) => setHours({ ...hours, [p.name]: Number(e.target.value) })}>
                      {CHOICES.map(([h, l]) => <option key={h} value={h}>{l}</option>)}
                    </select>
                    <button className="btn" onClick={() => run(() => api.setQuiet("person", hours[p.name] || 1, p.name), `${p.name} ignored`)}>Ignore</button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}