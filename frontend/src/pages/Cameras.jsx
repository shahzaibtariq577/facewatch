import { useEffect, useState } from "react";
import { Camera, Plus } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "../Toast.jsx";

const KINDS = [["webcam", "Webcam on this computer"], ["network", "Network camera (RTSP / IP / phone app)"], ["video", "Video file on this computer"]];
const KIND_LABEL = { webcam: "Webcam", network: "Network camera", video: "Video file" };
const EMPTY = { id: "", name: "", location: "", kind: "webcam", index: 0, url: "", path: "" };

export default function Cameras() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);     // null = closed, otherwise the camera being added or edited
  const [del, setDel] = useState("");

  const load = () => api.cams().then((d) => { setData(d); setErr(""); }).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const run = async (fn, ok) => {
    setBusy(true); setErr("");
    try { await fn(); toast(ok); await load(); }
    catch (e) { setErr(e.message); toast(e.message, "error"); }
    finally { setBusy(false); }
  };

  const save = (e) => {
    e.preventDefault();
    const body = { name: form.name, location: form.location, kind: form.kind, index: Number(form.index), url: form.url, path: form.path };
    run(async () => {
      if (form.id) await api.updateCam(form.id, body); else await api.addCam(body);
      setForm(null);
    }, form.id ? "Camera saved" : "Camera added");
  };

  if (!data) return <section><header className="head"><h2>Cameras</h2></header>{err ? <p className="note error" role="alert">{err}</p> : <p className="muted">Loading...</p>}</section>;
  const set = (patch) => setForm({ ...form, ...patch });

  return (
    <section>
      <header className="head">
        <h2>Cameras</h2>
        <button className="btn primary" disabled={!!form || data.items.length >= data.max} onClick={() => setForm({ ...EMPTY })}>
          <Plus size={14} aria-hidden="true" /> Add camera
        </button>
      </header>
      <p className="muted lede">
        Save each camera with a name and a place, for example Entrance or Office. Pick the one to watch with "Use this camera",
        or on the Live page. Normally FaceWatch watches one camera. Turn on grid mode below to watch several at once. You can save up to {data.max}.
      </p>
      {data.running && <p className="note">Watching is on. Stop watching on the Live page before you choose a different camera or change grid mode.</p>}
      <div className="card setgroup">
        <h3>Grid mode</h3>
        <label className="check">
          <input type="checkbox" checked={!!data.multi} disabled={busy || data.running}
                 onChange={(e) => run(() => api.setCamMode(e.target.checked), e.target.checked ? "Grid mode on" : "Grid mode off")} />
          Watch several cameras at once (up to {data.max_watch})
        </label>
        <p className="muted">
          Tick <b>Watch</b> on each camera below. The Live page then shows them together in a grid. It applies the next time you press Start.
          Each camera needs its own webcam number or address. More cameras use more of your computer, so each one is checked about 10 times a second.
          With grid mode off, FaceWatch watches only the camera marked "in use".
        </p>
      </div>
      {err && <p className="note error" role="alert">{err}</p>}

      {form && (
        <form className="card addform keep" onSubmit={save}>
          <h3>{form.id ? "Edit camera" : "Add a camera"}</h3>
          <label>Name
            <input value={form.name} onChange={(e) => set({ name: e.target.value })} required maxLength={40} placeholder="Front door" />
          </label>
          <label>Location
            <input value={form.location} onChange={(e) => set({ location: e.target.value })} maxLength={40} list="cam-places" placeholder="Entrance" />
            <datalist id="cam-places">{["Entrance", "Reception", "Office", "Warehouse", "Shop floor", "Parking"].map((p) => <option key={p} value={p} />)}</datalist>
          </label>
          <label>Type
            <select value={form.kind} onChange={(e) => set({ kind: e.target.value })}>
              {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          {form.kind === "webcam" && (
            <label>Webcam number
              <select value={form.index} onChange={(e) => set({ index: e.target.value })}>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => <option key={i} value={i}>Camera {i}</option>)}
              </select>
            </label>
          )}
          {form.kind === "network" && (
            <label>Address
              <input value={form.url} onChange={(e) => set({ url: e.target.value })} autoComplete="off"
                     placeholder={form.id ? "Leave empty to keep the saved address" : "rtsp://user:pass@192.168.1.20/stream"} />
            </label>
          )}
          {form.kind === "video" && (
            <label>File path
              <input value={form.path} onChange={(e) => set({ path: e.target.value })} placeholder="C:\Videos\clip.mp4" />
            </label>
          )}
          <div className="row">
            <button className="btn primary" disabled={busy || !form.name}>{form.id ? "Save" : "Add camera"}</button>
            <button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      {data.items.length === 0 && <p className="muted">No cameras saved yet. Press Add camera.</p>}
      <ul className="camlist">
        {data.items.map((c) => (
          <li key={c.id} className={`card camitem ${c.active ? "on" : ""}`}>
            <span className="camicon" aria-hidden="true"><Camera size={20} /></span>
            <div className="cambody">
              <strong>{c.name}</strong>{!data.multi && c.active && <span className="tag-now">in use</span>}{data.multi && c.watch && <span className="tag-now">in grid</span>}
              <span className="muted">{c.location || "No location"} · {KIND_LABEL[c.kind]} · {c.source}</span>
            </div>
            <div className="camact">
              {del === c.id ? (
                <>
                  <span>Remove {c.name}?</span>
                  <button className="btn danger" disabled={busy} onClick={() => run(async () => { await api.deleteCam(c.id); setDel(""); }, "Camera removed")}>Yes, remove</button>
                  <button className="btn" onClick={() => setDel("")}>Cancel</button>
                </>
              ) : (
                <>
                  <label className="check">
                    <input type="checkbox" checked={!!c.watch} disabled={busy || data.running}
                           onChange={(e) => run(() => api.watchCam(c.id, e.target.checked), e.target.checked ? `${c.name} will be watched in the grid` : `${c.name} is not in the grid`)} />
                    Watch
                  </label>
                  <button className="btn" disabled={busy || c.active || data.running} onClick={() => run(() => api.useCam(c.id), `Now using ${c.name}`)}
                          title={data.running ? "Stop watching first" : ""}>Use this camera</button>
                  <button className="btn" disabled={busy} onClick={() => setForm({ ...EMPTY, ...c, url: "" })}>Edit</button>
                  <button className="btn" disabled={busy} onClick={() => setDel(c.id)}>Remove</button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="muted"><small>Passwords in network addresses are saved on this computer but never shown here or in the audit log.
        The Video source card in Settings still works; the camera in use updates to match it.</small></p>
    </section>
  );
}