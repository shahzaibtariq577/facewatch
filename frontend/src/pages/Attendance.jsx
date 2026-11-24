import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { api, attendanceCsvUrl } from "../api.js";
import { useToast } from "../Toast.jsx";
import CameraFilter from "../CameraFilter.jsx";

const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() + n); return iso(d); };
const STATUS = { present: "Present", late: "Late", absent: "Absent", off: "Day off", pending: "Not yet", upcoming: "Upcoming" };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Cards you can click: each one lists the people (and days) with that status.
const CARDS = [["present", "On time", ["present"]], ["late", "Late", ["late"]], ["absent", "Absent", ["absent"]], ["pending", "Not yet", ["pending", "upcoming"]]];
const dayName = (s) => DAYS[(new Date(`${s}T12:00:00`).getDay() + 6) % 7];

function Report() {
  const today = iso(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [dept, setDept] = useState("");
  const [camera, setCamera] = useState("");
  const [rep, setRep] = useState(null);
  const [sel, setSel] = useState("");
  const [show, setShow] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (from > to) { setErr("The start date is after the end date."); return; }
    let alive = true;
    api.attendance(from, to, dept, camera)
      .then((d) => { if (alive) { setRep(d); setErr(""); } })
      .catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [from, to, dept, camera]);

  const quick = (days) => { setTo(today); setFrom(addDays(today, -(days - 1))); };
  const person = rep?.people.find((p) => p.name === sel);
  const all = rep ? rep.people.flatMap((p) => p.rows.map((r) => ({ ...r, name: p.name, department: p.department, shift: p.shift }))) : [];
  const card = CARDS.find(([k]) => k === show);
  const list = card ? all.filter((r) => card[2].includes(r.status)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.name.localeCompare(b.name))) : [];
  const period = from === to ? (from === today ? "today" : from) : `${from} to ${to}`;

  return (
    <div>
      <div className="row no-print" style={{ marginBottom: 14 }}>
        <button className="btn" onClick={() => quick(1)}>Today</button>
        <button className="btn" onClick={() => quick(7)}>7 days</button>
        <button className="btn" onClick={() => quick(30)}>30 days</button>
        <label className="row">From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="row">To <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></label>
        <CameraFilter value={camera} onChange={setCamera} />
        <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
          <option value="">All departments</option>
          {rep?.departments.map((d) => <option key={d} value={d}>{d}</option>)}
          <option value="none">No department</option>
        </select>
        <a className="btn" href={attendanceCsvUrl(from, to, dept, camera)} download><Download size={14} aria-hidden="true" /> Export CSV</a>
        <button className="btn" onClick={() => window.print()}>Print</button>
      </div>
      {err && <p className="note error" role="alert">{err}</p>}
      {rep && (
        <>
          <div className="stats">
            <div className="card stat"><span>People</span><b>{rep.totals.people}</b></div>
            {CARDS.map(([k, label, kinds]) => (
              <button key={k} className={`card stat statbtn ${show === k ? "on" : ""}`} aria-pressed={show === k}
                      onClick={() => setShow(show === k ? "" : k)} title="Click to see who">
                <span>{label}</span><b>{all.filter((r) => kinds.includes(r.status)).length}</b>
              </button>
            ))}
          </div>
          <p className="muted no-print"><small>Click On time, Late, Absent or Not yet to see who. Showing {period}.</small></p>
          {card && (
            <div className="card at-scroll" style={{ marginBottom: 14 }}>
              <h3>{card[1]}: {period} ({list.length})</h3>
              {list.length === 0 ? <p className="muted">Nobody.</p> : (
                <table>
                  <thead><tr><th>Date</th><th>Name</th><th>Department</th><th>Shift</th><th>First in</th><th>Last out</th><th>{show === "late" ? "Late by" : "Minutes seen"}</th></tr></thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={`${r.date}-${r.name}`}>
                        <td>{dayName(r.date)} {r.date}</td>
                        <td><button className="at-link" onClick={() => setSel(r.name)}>{r.name}</button></td>
                        <td>{r.department || <span className="muted">none</span>}</td>
                        <td>{r.shift.name} <span className="muted">{r.shift.start}-{r.shift.end}</span></td>
                        <td>{r.first_in || "-"}</td><td>{r.last_out || "-"}</td>
                        <td>{show === "late" ? (r.late_minutes ? `${r.late_minutes} min` : "-") : (r.minutes || "-")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="muted"><small>Click a name for that person's day-by-day times (shown further down).</small></p>
            </div>
          )}
          <div className="card at-scroll">
            <h3>People</h3>
            {rep.people.length === 0 ? <p className="muted">No saved people in this department.</p> : (
              <table>
                <thead><tr><th>Name</th><th>Department</th><th>Shift</th><th>Present</th><th>Late</th><th>Absent</th><th>Hours</th></tr></thead>
                <tbody>
                  {rep.people.map((p) => (
                    <tr key={p.name} className={sel === p.name ? "at-sel" : ""}>
                      <td><button className="at-link" onClick={() => setSel(sel === p.name ? "" : p.name)}>{p.name}</button></td>
                      <td>{p.department || <span className="muted">none</span>}</td>
                      <td>{p.shift.name} <span className="muted">{p.shift.start}-{p.shift.end}</span></td>
                      <td>{p.present}</td><td>{p.late}</td><td>{p.absent}</td><td>{p.hours}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted"><small>Click a name for day-by-day times. Late means first seen more than {rep.grace} minutes after the shift start.</small></p>
          </div>
          {person && (
            <div className="card at-scroll" style={{ marginTop: 14 }}>
              <h3>{person.name}: day by day</h3>
              <table>
                <thead><tr><th>Date</th><th>Status</th><th>First in</th><th>Last out</th><th>Minutes seen</th><th>Late by</th></tr></thead>
                <tbody>
                  {person.rows.map((r) => (
                    <tr key={r.date}>
                      <td>{dayName(r.date)} {r.date}</td>
                      <td><span className={`at-tag ${r.status}`}>{STATUS[r.status]}</span></td>
                      <td>{r.first_in || "-"}</td><td>{r.last_out || "-"}</td>
                      <td>{r.minutes || "-"}</td><td>{r.late_minutes ? `${r.late_minutes} min` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="card at-scroll" style={{ marginTop: 14 }}>
            <h3>Day by day (everyone)</h3>
            <table>
              <thead><tr><th>Date</th><th>Present</th><th>Late</th><th>Absent</th></tr></thead>
              <tbody>
                {[...rep.by_day].reverse().map((d) => (
                  <tr key={d.date}><td>{dayName(d.date)} {d.date}</td><td>{d.present}</td><td>{d.late}</td><td>{d.absent}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted"><small>This is based on what the camera saw. "Absent" means not seen by the camera,
            for example someone out of view or working elsewhere. It does not prove the person was away.</small></p>
        </>
      )}
    </div>
  );
}

function Setup() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [newDept, setNewDept] = useState("");
  const [err, setErr] = useState("");

  const load = () => api.attendanceConfig().then((d) => { setData(d); setDraft(d.config); setErr(""); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  if (!draft) return err ? <p className="note error" role="alert">{err}</p> : <p className="muted">Loading...</p>;

  const set = (patch) => setDraft({ ...draft, ...patch });
  const setShift = (i, patch) => set({ shifts: draft.shifts.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const toggleDay = (d) => set({ workdays: draft.workdays.includes(d) ? draft.workdays.filter((x) => x !== d) : [...draft.workdays, d].sort() });
  const addDept = () => {
    const n = newDept.trim();
    if (n && !draft.departments.some((d) => d.toLowerCase() === n.toLowerCase())) set({ departments: [...draft.departments, n] });
    setNewDept("");
  };
  const save = async () => {
    setErr("");
    try {
      const d = await api.saveAttendanceConfig(draft);
      setData(d); setDraft(d.config);
      toast("Attendance setup saved");
    } catch (e) { setErr(e.message); }
  };
  const assign = async (name, patch) => {
    const cur = data.people.find((p) => p.name === name);
    const next = { ...cur, ...patch };
    setErr("");
    try {
      await api.setAttendancePerson(name, next.department, next.shift);
      setData({ ...data, people: data.people.map((p) => (p.name === name ? next : p)) });
    } catch (e) { setErr(e.message); }
  };
  const saved = data.config;

  return (
    <div>
      {err && <p className="note error" role="alert">{err}</p>}
      <div className="card at-block">
        <h3>Shifts</h3>
        {draft.shifts.map((s, i) => (
          <div className="row at-row" key={s.id || i}>
            <input type="text" value={s.name} onChange={(e) => setShift(i, { name: e.target.value })} aria-label="Shift name" />
            <input type="time" value={s.start} onChange={(e) => setShift(i, { start: e.target.value })} aria-label="Start" />
            <span className="muted">to</span>
            <input type="time" value={s.end} onChange={(e) => setShift(i, { end: e.target.value })} aria-label="End" />
            <button className="btn" disabled={draft.shifts.length < 2}
                    onClick={() => set({ shifts: draft.shifts.filter((_, k) => k !== i) })}>Remove</button>
          </div>
        ))}
        <button className="btn" disabled={draft.shifts.length >= 10}
                onClick={() => set({ shifts: [...draft.shifts, { name: "New shift", start: "09:00", end: "17:00" }] })}>Add shift</button>
        <p className="muted"><small>A shift must end on the same day it starts. Night shifts across midnight are not supported yet.</small></p>
      </div>

      <div className="card at-block">
        <h3>Late and work days</h3>
        <label className="row">Grace time before "late"
          <input type="number" min="0" max="120" value={draft.grace} style={{ width: 80 }}
                 onChange={(e) => set({ grace: Number.parseInt(e.target.value, 10) || 0 })} /> minutes</label>
        <div className="row" style={{ marginTop: 10 }}>
          <span>Work days:</span>
          {DAYS.map((d, i) => (
            <label key={d} className="row"><input type="checkbox" checked={draft.workdays.includes(i)} onChange={() => toggleDay(i)} />{d}</label>
          ))}
        </div>
        <p className="muted"><small>Nobody is marked absent on days that are not work days.</small></p>
      </div>

      <div className="card at-block">
        <h3>Departments</h3>
        <div className="row">
          {draft.departments.map((d) => (
            <span className="at-chip" key={d}>{d}
              <button aria-label={`Remove ${d}`} onClick={() => set({ departments: draft.departments.filter((x) => x !== d) })}>×</button></span>
          ))}
          {draft.departments.length === 0 && <span className="muted">No departments yet.</span>}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <input type="text" value={newDept} placeholder="New department" onChange={(e) => setNewDept(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter") addDept(); }} />
          <button className="btn" onClick={addDept}>Add</button>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={save}>Save setup</button>
        <span className="muted">Save before choosing departments or shifts for people below.</span>
      </div>

      <div className="card at-block at-scroll">
        <h3>People</h3>
        {data.people.length === 0 ? <p className="muted">No saved people yet.</p> : (
          <table>
            <thead><tr><th>Name</th><th>Department</th><th>Shift</th></tr></thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.name}>
                  <td>{p.name}</td>
                  <td>
                    <select value={p.department} onChange={(e) => assign(p.name, { department: e.target.value })} aria-label={`Department for ${p.name}`}>
                      <option value="">None</option>
                      {saved.departments.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={p.shift} onChange={(e) => assign(p.name, { shift: e.target.value })} aria-label={`Shift for ${p.name}`}>
                      {saved.shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.start}-{s.end})</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function Attendance() {
  const [tab, setTab] = useState("report");
  return (
    <section>
      <div className="head">
        <h2>Attendance</h2>
        <div className="row no-print">
          <button className={`btn ${tab === "report" ? "primary" : ""}`} onClick={() => setTab("report")}>Report</button>
          <button className={`btn admin-only ${tab === "setup" ? "primary" : ""}`} onClick={() => setTab("setup")}>Setup</button>
        </div>
      </div>
      {tab === "report" ? <Report /> : <Setup />}
    </section>
  );
}