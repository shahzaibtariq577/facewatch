import { useEffect, useState } from "react";
import { Activity, Cpu, MemoryStick, HardDrive, Camera, Smartphone, FolderOpen, RefreshCw } from "lucide-react";
import { api } from "../api.js";

const LEVEL = { ok: "OK", info: "Info", warn: "Check", error: "Problem" };
const OVERALL = {
  ok: "Everything looks fine.",
  warn: "Some things need a look.",
  error: "There is a problem to fix.",
};

function uptime(s) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}

function Meter({ icon: Icon, label, value, unit = "%", note }) {
  const has = value !== null && value !== undefined;
  const level = !has ? "" : unit === "%" && value >= 90 ? "bad" : unit === "%" && value >= 75 ? "mid" : "";
  return (
    <div className="card hl-meter">
      <span className="muted"><Icon size={15} aria-hidden="true" /> {label}</span>
      <b>{has ? `${value}${unit}` : "n/a"}</b>
      {has && unit === "%" && (
        <div className="hl-bar" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
          <i className={level} style={{ width: `${Math.min(100, value)}%` }} />
        </div>
      )}
      {note && <small className="muted">{note}</small>}
    </div>
  );
}

export default function Health() {
  const [h, setH] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    const load = () => api.health()
      .then((d) => { if (alive) { setH(d); setErr(""); } })
      .catch((e) => { if (alive) setErr(e.message); });
    load();
    const id = setInterval(load, 3000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (!h) return (
    <section>
      <div className="head"><h2>System health</h2></div>
      {err ? <p className="note error" role="alert">{err}</p> : <p className="muted">Loading...</p>}
    </section>
  );

  return (
    <section>
      <div className="head">
        <h2>System health</h2>
        <span className="pill muted"><RefreshCw size={13} aria-hidden="true" /> Updates every 3 seconds</span>
      </div>
      {err && <p className="note error" role="alert">Cannot reach the backend: {err}</p>}
      <p className={`hl-overall ${h.overall}`} role="status">
        <Activity size={18} aria-hidden="true" /> {OVERALL[h.overall] || OVERALL.ok}
      </p>

      <div className="hl-grid">
        <Meter icon={Cpu} label="Laptop processor" value={h.cpu} note={h.psutil ? "All programs together" : "Install psutil to see this"} />
        <Meter icon={MemoryStick} label="Laptop memory" value={h.ram} note={h.app_mb != null ? `FaceWatch itself: ${h.app_mb} MB` : "All programs together"} />
        <Meter icon={HardDrive} label="Disk" value={h.disk} note={`${h.disk_free_gb} GB free`} />
        <Meter icon={Camera} label="Frames per second" value={h.running && !h.paused ? h.fps : null} unit=" fps"
               note={h.running ? (h.source || "Camera") : "Not watching"} />
      </div>

      <div className="card">
        <h3>Checks</h3>
        <ul className="hl-list">
          {h.checks.map((c) => (
            <li key={c.title}>
              <span className={`hl-tag ${c.level}`}>{LEVEL[c.level]}</span>
              <div><b>{c.title}</b><br /><span className="muted">{c.text}</span></div>
            </li>
          ))}
        </ul>
      </div>

      <div className="hl-two">
        <div className="card">
          <h3><FolderOpen size={16} aria-hidden="true" /> Stored data</h3>
          <table>
            <tbody>
              <tr><td>Saved people photos</td><td>{h.people_mb} MB</td></tr>
              <tr><td>Alert pictures</td><td>{h.pictures_mb} MB</td></tr>
              <tr><td>Not recognised pictures</td><td>{h.unknown_mb} MB</td></tr>
              <tr><td>Face models</td><td>{h.models_mb} MB</td></tr>
              <tr><td><b>Total</b></td><td><b>{h.data_mb} MB</b></td></tr>
            </tbody>
          </table>
          <p className="muted"><small>Folder sizes refresh about every 30 seconds.</small></p>
        </div>
        <div className="card">
          <h3><Smartphone size={16} aria-hidden="true" /> App</h3>
          <table>
            <tbody>
              <tr><td>Running for</td><td>{uptime(h.uptime)}</td></tr>
              <tr><td>Saved people</td><td>{h.people}</td></tr>
              <tr><td>Phone alerts</td><td>{h.phone.ntfy || h.phone.telegram ? [h.phone.ntfy && "ntfy", h.phone.telegram && "Telegram"].filter(Boolean).join(" + ") : "Not set up"}</td></tr>
              <tr><td>Daily summary</td><td>{h.daily_summary.on ? `On, ${h.daily_summary.time}` : "Off"}</td></tr>
              <tr><td>Last summary sent</td><td>{h.daily_summary.last || "none yet"}</td></tr>
              <tr><td>Python</td><td>{h.python}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}