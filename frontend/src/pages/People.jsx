import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { api, ago, formatTime, thumbUrl } from "../api.js";
import { useToast } from "../Toast.jsx";
import Modal from "../Modal.jsx";

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
  const [consent, setConsent] = useState({});
  const [agreed, setAgreed] = useState(false);
  const [delMsg, setDelMsg] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [menu, setMenu] = useState("");
  const [renaming, setRenaming] = useState(null);   // { name, value }
  const [wiping, setWiping] = useState(null);       // { name, typed }
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => { if (!e.target.closest?.(".menu")) setMenu(""); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);
  const toast = useToast();
  const addTo = useRef(null);
  const picker = useRef(null);
  const personCam = useRef(null);
  const gallery = useRef(null);
  const camera = useRef(null);
  const histRef = useRef(null);

  const load = () => {
    api.people().then(setPeople).catch((e) => setErr(e.message));
    api.consent().then((d) => {
      const m = {};
      d.items.forEach((c) => { m[c.name.toLowerCase()] = c; });
      setConsent(m);
    }).catch(() => {});
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
    setBusy(true); setErr(""); setNotes([]); setDelMsg("");
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
      const existed = people.some((p) => p.name.toLowerCase() === name.trim().toLowerCase());
      const res = await api.addPerson(name, files);
      if (agreed) await api.setConsent(res.name, true);
      else if (!existed) await api.setConsent(res.name, null);
      setName(""); setFiles([]); setAgreed(false); setShowAdd(false);
      return res;
    }, "Person added");
  };

  const remove = (n) => {
    if (window.confirm(`Remove ${n} and all their photos?`)) run(() => api.removePerson(n), "Person removed");
  };

  const doRename = (e) => {
    e.preventDefault();
    const n = renaming.name, v = renaming.value.trim();
    if (!v || v === n) { setRenaming(null); return; }
    run(async () => {
      const r = await api.renamePerson(n, v);
      if (open === n) setOpen(null);
      setRenaming(null);
      return r;
    }, "Person renamed");
  };

  const toggleConsent = (n, c) =>
    run(() => api.setConsent(n, !(c && c.consent)), c && c.consent ? "Marked as no consent" : "Consent recorded");

  const doWipe = (e) => {
    e.preventDefault();
    const n = wiping.name;
    run(async () => {
      const r = await api.deletePersonData(n);
      if (open === n) setOpen(null);
      setWiping(null);
      setDelMsg(`Deleted all data of ${r.name}: ${r.photos} photos, ${r.alerts} alerts, ${r.pictures} pictures, ${r.unknown} not-recognised events, ${r.notifications} notifications.`);
      return r;
    }, "All data deleted");
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
  const readyCount = people.filter((p) => p.photos >= 2).length;
  const consentCount = people.filter((p) => consent[p.name.toLowerCase()]?.consent).length;

  return (
    <section>
      <header className="head">
        <div>
          <h2>People</h2>
          <p className="muted">Manage registered people and their recognition profiles.</p>
        </div>
        <button className="btn primary admin-only" onClick={() => { setErr(""); setShowAdd(true); }}><Plus size={15} aria-hidden="true" /> Add person</button>
      </header>
      <p className="muted lede">
        Add 2 or 3 clear, front-facing photos of each person you want to find. Only add people who have
        agreed to be recognised. Photos with no face are skipped, and weak photos get a warning.
      </p>

      <div className="stats s3">
        <div className="card stat"><span>Total people</span><b>{people.length}</b></div>
        <div className="card stat"><span>Ready profiles</span><b>{readyCount}</b><small>2 or more photos</small></div>
        <div className="card stat"><span>With consent recorded</span><b>{consentCount}</b><small>Use Record consent on each card</small></div>
      </div>

      {err && !showAdd && <p className="note error" role="alert">{err}</p>}
      {delMsg && <p className="note" role="status">{delMsg}</p>}
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
                      <strong>{formatTime(v.start)}{v.active && <span className="tag-now">now</span>}</strong>
                      <span className="muted">Last seen {formatTime(v.end, false)} · {dur(v.seconds)} · {v.alerts} {v.alerts === 1 ? "alert" : "alerts"}</span>
                    </div>
                  </li>
                ))}</ol>
              </>}
        </section>
      )}

      {people.length > 0 && (
        <div className="pbar">
          <input type="search" className="search" aria-label="Search people" placeholder="Search people by name" value={q}
                 onChange={(e) => setQ(e.target.value)} />
          <span className="pcount">
            {q ? `${shown.length} of ${people.length}` : `${people.length} ${people.length === 1 ? "person" : "people"}`}
          </span>
        </div>
      )}

      <ul className="pgrid">
        {people.length === 0 && <li className="muted empty">No people yet. Press Add person to register the first one.</li>}
        {people.length > 0 && shown.length === 0 && <li className="muted empty">No one matches "{q}".</li>}
        {shown.map((p) => {
          const s = stats[p.name];
          const ready = p.photos >= 2;
          const c = consent[p.name.toLowerCase()];
          return (
            <li key={p.name} className="card pcard">
              <div className="phead">
                <img src={thumbUrl(p.name, version)} alt={`Photo of ${p.name}`} width="64" height="64" />
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
              <p className="pconsent">
                <span className={`pill-s ${c ? (c.consent ? "ok" : "err") : "warn"}`}>
                  {c ? (c.consent ? `Consent recorded ${c.date}` : `No consent (marked ${c.date})`) : "Consent not recorded"}
                </span>
              </p>
              <div className="pact">
                <button className="btn" onClick={() => showHistory(p.name)}>History</button>
                <button className="btn admin-only" disabled={busy} onClick={() => addFor(p.name, picker)}>Add photos</button>
                <div className="menu admin-only">
                  <button className="btn" aria-haspopup="menu" aria-expanded={menu === p.name} onClick={() => setMenu(menu === p.name ? "" : p.name)}>More ▾</button>
                  {menu === p.name && (
                    <div className="menu-pop" role="menu">
                      <button role="menuitem" disabled={busy} onClick={() => { setMenu(""); setRenaming({ name: p.name, value: p.name }); }}>Rename</button>
                      <button role="menuitem" disabled={busy} onClick={() => { setMenu(""); addFor(p.name, personCam); }}>Take photo</button>
                      <button role="menuitem" disabled={busy} onClick={() => { setMenu(""); toggleConsent(p.name, c); }}>{c && c.consent ? "Mark no consent" : "Record consent"}</button>
                      <button role="menuitem" className="dng" disabled={busy} onClick={() => { setMenu(""); remove(p.name); }}>Remove (keep history)</button>
                    </div>
                  )}
                </div>
                <button className="btn danger-o admin-only" disabled={busy} onClick={() => setWiping({ name: p.name, typed: "" })}>Delete data</button>
              </div>
            </li>
          );
        })}
        {people.length > 0 && !q && (
          <li className="admin-only">
            <button className="card addcard" style={{ width: "100%", height: "100%" }} onClick={() => { setErr(""); setShowAdd(true); }}>
              <span><b>+ Add person</b>Name, clear front-facing photos and a consent tick</span>
            </button>
          </li>
        )}
      </ul>

      {showAdd && (
        <Modal title="Add person" subtitle="Add 2 or 3 clear, front-facing photos. Only add people who agreed to be recognised." onClose={() => setShowAdd(false)}>
          <form onSubmit={submit}>
            <label>Name
              <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} className={name === "" && err ? "bad" : ""} />
            </label>
            <div className="drop">
              <div className="row">
                <button type="button" className="btn" onClick={() => gallery.current.click()}>Choose photos</button>
                <button type="button" className="btn" onClick={() => camera.current.click()}>Take photo</button>
              </div>
              <span>{files.length ? `${files.length} ${files.length === 1 ? "photo" : "photos"} selected` : "Clear, front-facing photos work best"}</span>
            </div>
            {previews.length > 0 && (
              <div className="thumbs">
                {previews.map((u, i) => (
                  <div className="thumb" key={u}>
                    <img src={u} alt={`Selected photo ${i + 1}`} />
                    <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => setFiles((f) => f.filter((_, k) => k !== i))}><X size={13} /></button>
                  </div>
                ))}
              </div>
            )}
            <label className="check"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />This person agreed to be recognised</label>
            {err && <p className="err-t" role="alert">{err}</p>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn primary" disabled={busy || !name.trim() || !files.length}>{busy ? "Checking photos..." : "Add person"}</button>
            </div>
          </form>
        </Modal>
      )}

      {renaming && (
        <Modal title={`Rename ${renaming.name}`} onClose={() => setRenaming(null)}>
          <form onSubmit={doRename}>
            <label>New name
              <input value={renaming.value} onChange={(e) => setRenaming({ ...renaming, value: e.target.value })} required maxLength={40} />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setRenaming(null)}>Cancel</button>
              <button className="btn primary" disabled={busy || !renaming.value.trim()}>Rename</button>
            </div>
          </form>
        </Modal>
      )}

      {wiping && (
        <Modal title={`Delete all data of ${wiping.name}?`} onClose={() => setWiping(null)}>
          <form onSubmit={doWipe}>
            <p className="modal-warn" style={{ margin: 0 }}>
              This permanently deletes photos, alerts, pictures, visit history, notices, attendance setup and the consent record. It cannot be undone.
            </p>
            <label>Type the name "{wiping.name}" to confirm
              <input value={wiping.typed} onChange={(e) => setWiping({ ...wiping, typed: e.target.value })} autoComplete="off" />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setWiping(null)}>Cancel</button>
              <button className="btn danger" disabled={busy || wiping.typed.trim().toLowerCase() !== wiping.name.toLowerCase()}>Delete all data</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
