import { useEffect, useRef, useState } from "react";
import { api, thumbUrl } from "../api.js";

export default function People() {
  const [people, setPeople] = useState([]);
  const [name, setName] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notes, setNotes] = useState([]);
  const [version, setVersion] = useState(0);
  const addTo = useRef(null);
  const picker = useRef(null);

  const load = () => api.people().then(setPeople).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const run = async (fn) => {
    setBusy(true); setErr(""); setNotes([]);
    try {
      const res = await fn();
      if (res?.notes) setNotes(res.notes);
      setVersion((v) => v + 1);
      await load();
    }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const submit = (e) => {
    e.preventDefault();
    const formEl = e.target;
    run(async () => {
      const res = await api.addPerson(name, files);
      setName(""); setFiles([]); formEl.reset();
      return res;
    });
  };

  const remove = (n) => {
    if (window.confirm(`Remove ${n} and all their photos?`)) run(() => api.removePerson(n));
  };

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
        <label>Photos
          <input type="file" accept="image/*" multiple required
                 onChange={(e) => setFiles(e.target.files)} />
        </label>
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

      <input ref={picker} type="file" accept="image/*" multiple hidden
             onChange={(e) => {
               const f = e.target.files;
               if (f.length && addTo.current) run(() => api.addPhotos(addTo.current, f));
               e.target.value = "";
             }} />

      <ul className="people">
        {people.length === 0 && <li className="muted empty">No people yet. Add the first person above.</li>}
        {people.map((p) => (
          <li key={p.name} className="card person">
            <img src={thumbUrl(p.name, version)} alt="" width="56" height="56" />
            <div><strong>{p.name}</strong><span className="muted">{p.photos} {p.photos === 1 ? "photo" : "photos"}</span></div>
            <button className="btn" disabled={busy} onClick={() => { addTo.current = p.name; picker.current.click(); }}>
              Add photos
            </button>
            <button className="btn" disabled={busy} onClick={() => remove(p.name)}>Remove</button>
          </li>
        ))}
      </ul>
    </section>
  );
}