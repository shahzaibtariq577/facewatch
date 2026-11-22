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
  const personCam = useRef(null);
  const gallery = useRef(null);
  const camera = useRef(null);

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

  // Photos for the new person can come from the gallery and the camera, several times.
  const pick = (e) => {
    const list = [...e.target.files];
    setFiles((f) => [...f, ...list]);
    e.target.value = "";
  };

  // Photos for an existing person.
  const pickFor = (e) => {
    const list = [...e.target.files];
    if (list.length && addTo.current) run(() => api.addPhotos(addTo.current, list));
    e.target.value = "";
  };

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const res = await api.addPerson(name, files);
      setName(""); setFiles([]);
      return res;
    });
  };

  const remove = (n) => {
    if (window.confirm(`Remove ${n} and all their photos?`)) run(() => api.removePerson(n));
  };

  const addFor = (n, ref) => { addTo.current = n; ref.current.click(); };

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

      <ul className="people">
        {people.length === 0 && <li className="muted empty">No people yet. Add the first person above.</li>}
        {people.map((p) => (
          <li key={p.name} className="card person">
            <img src={thumbUrl(p.name, version)} alt="" width="56" height="56" />
            <div><strong>{p.name}</strong><span className="muted">{p.photos} {p.photos === 1 ? "photo" : "photos"}</span></div>
            <button className="btn" disabled={busy} onClick={() => addFor(p.name, picker)}>Add photos</button>
            <button className="btn" disabled={busy} onClick={() => addFor(p.name, personCam)}>Take photo</button>
            <button className="btn" disabled={busy} onClick={() => remove(p.name)}>Remove</button>
          </li>
        ))}
      </ul>
    </section>
  );
}