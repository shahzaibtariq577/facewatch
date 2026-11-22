import { useEffect, useRef, useState } from "react";
import { api, ago, formatTime, thumbUrl } from "../api.js";
import { useToast } from "../Toast.jsx";

const dur = (s) => (s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min`
  : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`);

export default function People({ focus, onFocusDone }) {
  const [people, setPeople] = useState([]);
  const [name, setName] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notes, setNotes] = useState([]);
  const [version, setVersion] = useState(0);
  const [stats, setStats] = useState({});
  const [open, setOpen] = useState(null);
  const [hist, setHist] = useState(null);
  const [q, setQ] = useState("");
  const toast = useToast();
  const addTo = useRef(null);
  const picker = useRef(null);
  const personCam = useRef(null);
  const gallery = useRef(null);
  const camera = useRef(null);
  const histRef = useRef(null);

  const load = () => {
    api.people().then(setPeople).catch((e) => setErr(e.message));
    api.dashboard().then((d) => {
      const m = {};
      d.by_person.forEach((p) => { m[p.name] = { alerts: p.total, last: p.last, first: p.first, visits: 0, active: false }; });
      d.visits.forEach((v) => {
        if (!m[v.name]) m[v.name] = { alerts: 0, last: null, first: null, visits: 0, active: false };
        m[v.name].visits += 1;
        if (v.active) m[v.name].active = true;
      });
      setStats(m);
    }).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const run = async (fn, okMsg) => {
    setBusy(true); setErr(""); setNotes([]);
    try {
      const res = await fn();
      if (res?.notes) setNotes(res.notes);
      setVersion((v) => v + 1);
      await load();
      if (okMsg) toast(okMsg);
    }
    catch (e) { setErr(e.message); toast(e.message, "error"); }
    finally { setBusy(false); }
  };

  // Photos for the new person can come from the gallery and the camera, several times.
  const pick = (e) => {
    const list = [...e.target.files];
    setFiles((f) => [...f, ...list]);
    e.target.value = "";
  };

  // Photos for an existing person.
  const pickFor = (e) => {
    const list = [...e.target.files];
    if (list.length && addTo.current) run(() => api.addPhotos(addTo.current, list), "Photos added");
    e.target.value = "";
  };

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const res = await api.addPerson(name, files);
      setName(""); setFiles([]);
      return res;
    }, "Person added");
  };

  const remove = (n) => {
    if (window.confirm(`Remove ${n} and all their photos?`)) run(() => api.removePerson(n), "Person removed");
  };

  const openHist = (n) => {
    setOpen(n); setHist(null);
    api.history(n).then(setHist).catch((e) => toast(e.message, "error"));
  };
  const showHistory = (n) => (open === n ? setOpen(null) : openHist(n));

  // Opened from the Dashboard (click on a person's name): show that person's history.
  useEffect(() => {
    if (!focus) return;
    openHist(focus);
    if (onFocusDone) onFocusDone();
  }, [focus]);

  useEffect(() => {
    if (open && histRef.current) histRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [open]);

  const addFor = (n, ref) => { addTo.current = n; ref.current.click(); };

  const needle = q.trim().toLowerCase();
  const shown = people.filter((p) => p.name.toLowerCase().includes(needle));

  return (
    <section>
      <header className="head"><h2>People</h2></header>
      <p className="muted lede">
        Add 2 or 3 clear, front-facing photos of each person you want to find. Only add people who have
        agreed to be recognised. Photos with no face are skipped, and weak photos get a warning.
      </p>

      <form className="card addform" onSubmit={submit}>
        <label>Name
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
        </label>
        <div className="row">
          <button type="button" className="btn" onClick={() => gallery.current.click()}>Choose photos</button>
          <button type="button" className="btn" onClick={() => camera.current.click()}>Take photo</button>
        </div>
        <span className="muted">
          {files.length ? `${files.length} ${files.length === 1 ? "photo" : "photos"} selected` : "No photos selected yet"}
          {files.length > 0 && <> <button type="button" className="btn" onClick={() => setFiles([])}>Clear</button></>}
        </span>
        <button className="btn primary" disabled={busy || !name || !files.length}>
          {busy ? "Checking photos..." : "Add person"}
        </button>
      </form>
      {err && <p className="note error" role="alert">{err}</p>}
      {notes.length > 0 && (
        <div className="note" role="status">
          <strong>Photo check</strong>
          <ul className="notes-list">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          Photos with warnings were still saved. Add a clearer front-facing photo if you can.
        </div>
      )}

      <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={pick} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={picker} type="file" accept="image/*" multiple hidden onChange={pickFor} />
      <input ref={personCam} type="file" accept="image/*" capture="environment" hidden onChange={pickFor} />

      {open && (
        <section className="card hist" ref={histRef} aria-label={`${open} visit history`}>
          <div className="head">
            <h3>{open}: visit history</h3>
            <button className="btn" onClick={() => setOpen(null)}>Close</button>
          </div>
          {!hist ? <p className="muted">Loading...</p> : hist.visits === 0
            ? <p className="muted">No visits yet. When {open} is seen, each visit is listed here.</p>
            : <>
                <div className="hist-stats">
                  <div><span>Visits</span><b>{hist.visits}</b></div>
                  <div><span>Alerts</span><b>{hist.alerts}</b></div>
                  <div><span>Time present</span><b>{dur(hist.seconds)}</b></div>
                  <div><span>Last seen</span><b>{formatTime(hist.last)}</b></div>
                </div>
                <ol className="tl">{hist.items.map((v, i) => (
                  <li key={i}>
                    <i aria-hidden="true" />
                    <div>
                      <strong>{formatTime(v.start)}</strong>{v.active && <span className="tag-now">now</span>}
                      <span className="muted">Last seen {formatTime(v.end, false)} · {dur(v.seconds)} · {v.alerts} {v.alerts === 1 ? "alert" : "alerts"}</span>
                    </div>
                  </li>
                ))}</ol>
              </>}
        </section>
      )}

      {people.length > 0 && (
        <div className="pbar">
          <input type="text" aria-label="Search people" placeholder="Search people" value={q}
                 onChange={(e) => setQ(e.target.value)} />
          <span className="pcount">
            {q ? `${shown.length} of ${people.length}` : `${people.length} ${people.length === 1 ? "person" : "people"}`}
          </span>
        </div>
      )}

      <ul className="pgrid">
        {people.length === 0 && <li className="muted empty">No people yet. Add the first person above.</li>}
        {people.length > 0 && shown.length === 0 && <li className="muted empty">No one matches "{q}".</li>}
        {shown.map((p) => {
          const s = stats[p.name];
          const ready = p.photos >= 2;
          return (
            <li key={p.name} className="card pcard">
              <div className="phead">
                <img src={thumbUrl(p.name, version)} alt={`Photo of ${p.name}`} width="72" height="72" />
                <div>
                  <strong>{p.name}{s?.active && <span className="tag-now">now</span>}</strong>
                  <span className="muted">{p.photos} {p.photos === 1 ? "photo" : "photos"}</span>
                  <span className={`pill-s ${ready ? "ok" : "warn"}`}>{ready ? "Ready" : "Add more photos"}</span>
                </div>
              </div>
              <div className="pstat">
                <div><span>Visits</span><b>{s ? s.visits : 0}</b></div>
                <div><span>Alerts</span><b>{s ? s.alerts : 0}</b></div>
                <div><span>Last seen</span><b title={s?.last ? formatTime(s.last) : ""}>{s?.last ? ago(s.last) : "-"}</b></div>
              </div>
              {s?.first && <p className="pfirst">First seen {formatTime(s.first)}</p>}
              <div className="pact">
                <button className="btn" onClick={() => showHistory(p.name)}>History</button>
                <button className="btn" disabled={busy} onClick={() => addFor(p.name, picker)}>Add photos</button>
                <button className="btn" disabled={busy} onClick={() => addFor(p.name, personCam)}>Take photo</button>
                <button className="btn" disabled={busy} onClick={() => remove(p.name)}>Remove</button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}