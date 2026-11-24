import { useEffect, useState } from "react";
import { Camera, Plus } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "../Toast.jsx";
import Modal from "../Modal.jsx";

const KINDS = [["webcam", "Webcam on this computer"], ["network", "Network camera (RTSP / IP / phone app)"], ["video", "Video file on this computer"]];
const KIND_LABEL = { webcam: "Webcam", network: "Network camera", video: "Video file" };
const EMPTY = { id: "", name: "", location: "", kind: "webcam", index: 0, url: "", path: "", user: "", pass: "" };

// Put the optional username and password into the address, the way the backend already expects it.
function withLogin(url, user, pass) {
  const u = url.trim();
  if (!u || !user || /\/\/[^/]*@/.test(u)) return u;
  return u.replace("://", `://${encodeURIComponent(user)}${pass ? `:${encodeURIComponent(pass)}` : ""}@`);
}

export default function Cameras({ status }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);     // null = closed, otherwise the camera being added or edited
  const [del, setDel] = useState(null);       // camera waiting for remove confirmation

  const load = () => api.cams().then((d) => { setData(d); setErr(""); }).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const run = async (fn, ok) => {
    setBusy(true); setErr("");
    try { await fn(); toast(ok); await load(); return true; }
    catch (e) { setErr(e.message); toast(e.message, "error"); return false; }
    finally { setBusy(false); }
  };

  const save = async (e) => {
    e.preventDefault();
    const body = { name: form.name, location: form.location, kind: form.kind, index: Number(form.index),
                   url: withLogin(form.url, form.user, form.pass), path: form.path };
    const ok = await run(async () => {
      if (form.id) await api.updateCam(form.id, body); else await api.addCam(body);
    }, form.id ? "Camera saved" : "Camera added");
    if (ok) setForm(null);
  };

  if (!data) return <section><header className="head"><h2>Cameras</h2></header>{err ? <p className="note error" role="alert">{err}</p> : <p className="muted">Loading...</p>}</section>;
  const set = (patch) => setForm({ ...form, ...patch });

  const running = !!status?.running;
  const lanes = status?.lanes || [];
  const connected = !running ? "--"
    : data.multi ? lanes.filter((l) => l.state === "running").length
    : status.state === "running" ? 1 : 0;
  const inUse = data.multi ? data.items.filter((c) => c.watch).length : data.items.filter((c) => c.active).length;

  // Only claim a connection state when the backend actually reports one.
  const badge = (c) => {
    if (data.multi) {
      if (!c.watch) return null;
      const l = running ? lanes.find((x) => x.name === c.name) : null;
      if (!l) return <span className="tag-now warn">In grid</span>;
      return l.state === "running" ? <span className="tag-now">Connected · in grid</span>
        : <span className="tag-now err">{l.state === "reconnecting" ? "Reconnecting" : "Disconnected"}</span>;
    }
    if (!c.active) return null;
    if (!running) return <span className="tag-now warn">In use</span>;
    if (status.state === "running") return <span className="tag-now">Connected · in use</span>;
    if (status.state === "starting") return <span className="tag-now warn">Connecting</span>;
    return <span className="tag-now err">{status.state === "reconnecting" ? "Reconnecting" : "Disconnected"}</span>;
  };

  return (
    <section>
      <header className="head">
        <div>
          <h2>Cameras</h2>
          <p className="muted">Manage your connected cameras and video sources.</p>
        </div>
        <button className="btn primary" disabled={!!form || data.items.length >= data.max} onClick={() => setForm({ ...EMPTY })}>
          <Plus size={15} aria-hidden="true" /> Add camera
        </button>
      </header>

      <div className="stats s3">
        <div className="card stat"><span>Total cameras</span><b>{data.items.length}</b><small>of {data.max} you can save</small></div>
        <div className="card stat"><span>{data.multi ? "In the grid" : "In use"}</span><b>{inUse}</b></div>
        <div className="card stat"><span>Connected</span><b>{connected}</b><small>{running ? "from the live feed" : "Shown while watching"}</small></div>
      </div>

      {data.running && <p className="note">Watching is on. Stop watching on the Live page before you choose a different camera or change grid mode.</p>}
      {err && <p className="note error" role="alert">{err}</p>}

      <div className="card setgroup">
        <h3>Grid mode</h3>
        <label className="check">
          <input type="checkbox" checked={!!data.multi} disabled={busy || data.running}
                 onChange={(e) => run(() => api.setCamMode(e.target.checked), e.target.checked ? "Grid mode on" : "Grid mode off")} />
          Watch several cameras at once (up to {data.max_watch})
        </label>
        <p className="muted">
          Tick <b>Watch</b> on each camera below. The Live page then shows them together in a grid. It applies the next time you press Start.
          Each camera needs its own webcam number or address. With grid mode off, FaceWatch watches only the camera marked "in use".
        </p>
      </div>

      {data.items.length === 0 && <p className="muted">No cameras saved yet. Press Add camera.</p>}
      <ul className="camgrid">
        {data.items.map((c) => (
          <li key={c.id} className={`card camcard ${c.active ? "on" : ""}`}>
            <div className="campreview" aria-hidden="true"><Camera size={26} /><span>No preview available</span></div>
            <div className="camtitle"><strong>{c.name}</strong>{badge(c)}</div>
            <div className="camlines">
              <span>Location: {c.location || "Not set"}</span>
              <span>Type: {KIND_LABEL[c.kind]} · Source: {c.source}</span>
            </div>
            <div className="camact">
              <label className="check" style={{ flex: "0 0 auto" }}>
                <input type="checkbox" checked={!!c.watch} disabled={busy || data.running}
                       onChange={(e) => run(() => api.watchCam(c.id, e.target.checked), e.target.checked ? `${c.name} will be watched in the grid` : `${c.name} is not in the grid`)} />
                Watch
              </label>
              <button className="btn" disabled={busy || c.active || data.running} onClick={() => run(() => api.useCam(c.id), `Now using ${c.name}`)}
                      title={data.running ? "Stop watching first" : c.active ? "Already in use" : ""}>Use camera</button>
              <button className="btn" disabled={busy} onClick={() => setForm({ ...EMPTY, ...c, url: "", user: "", pass: "" })}>Edit</button>
              <button className="btn danger-o" disabled={busy} onClick={() => setDel(c)}>Remove</button>
            </div>
          </li>
        ))}
      </ul>
      <p className="muted"><small>Passwords in network addresses are saved on this computer but never shown here or in the audit log.
        The Video source card in Settings still works; the camera in use updates to match it.</small></p>

      {form && (
        <Modal title={form.id ? "Edit camera" : "Add camera"} subtitle="Save a camera with a name and a place, for example Entrance or Office." onClose={() => setForm(null)}>
          <form onSubmit={save}>
            <label>Camera name
              <input value={form.name} onChange={(e) => set({ name: e.target.value })} required maxLength={40} placeholder="Entrance" />
            </label>
            <label>Location
              <input value={form.location} onChange={(e) => set({ location: e.target.value })} maxLength={40} list="cam-places" placeholder="Front door" />
              <datalist id="cam-places">{["Entrance", "Reception", "Office", "Warehouse", "Shop floor", "Parking"].map((p) => <option key={p} value={p} />)}</datalist>
            </label>
            <div className="two">
              <label>Camera type
                <select value={form.kind} onChange={(e) => set({ kind: e.target.value })}>
                  {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              {form.kind === "webcam" && (
                <label>Device
                  <select value={form.index} onChange={(e) => set({ index: e.target.value })}>
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => <option key={i} value={i}>Webcam {i}</option>)}
                  </select>
                </label>
              )}
            </div>
            {form.kind === "network" && (
              <>
                <label>Network address
                  <input value={form.url} onChange={(e) => set({ url: e.target.value })} autoComplete="off"
                         placeholder={form.id ? "Leave empty to keep the saved address" : "rtsp://192.168.1.20/stream"} />
                </label>
                <div className="two">
                  <label>Username (optional)
                    <input value={form.user} onChange={(e) => set({ user: e.target.value })} autoComplete="off" />
                  </label>
                  <label>Password (optional)
                    <input type="password" value={form.pass} onChange={(e) => set({ pass: e.target.value })} autoComplete="new-password" />
                  </label>
                </div>
              </>
            )}
            {form.kind === "video" && (
              <label>File path
                <input value={form.path} onChange={(e) => set({ path: e.target.value })} placeholder="C:\Videos\clip.mp4" />
              </label>
            )}
            {err && <p className="err-t" role="alert">{err}</p>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn primary" disabled={busy || !form.name.trim()}>{form.id ? "Save camera" : "Add camera"}</button>
            </div>
          </form>
        </Modal>
      )}

      {del && (
        <Modal title={`Remove ${del.name}?`} subtitle="This removes the camera from FaceWatch. Recorded alerts and visits are kept." onClose={() => setDel(null)}>
          <div className="mbody">
            <p className="modal-warn" style={{ margin: 0 }}>You can add it again later.</p>
            {err && <p className="err-t" role="alert">{err}</p>}
            <div className="modal-actions">
              <button className="btn" onClick={() => setDel(null)}>Cancel</button>
              <button className="btn danger" disabled={busy}
                      onClick={async () => { if (await run(() => api.deleteCam(del.id), "Camera removed")) setDel(null); }}>Remove camera</button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
