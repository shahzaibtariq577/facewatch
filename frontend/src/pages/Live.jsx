import { useEffect, useState } from "react";
import { Play, Square, Pause, Camera, Users, Gauge, Monitor, Activity } from "lucide-react";
import { api, formatTime, snapshotUrl } from "../api.js";

// One function decides the state, so the chip, the border and the text can never disagree.
function describe(s, offline) {
  if (offline) return { tone: "warn", label: "Backend offline", text: "Cannot reach the backend. Start it on port 8000." };
  if (!s) return { tone: "idle", label: "Connecting", text: "Connecting..." };
  if (s.state === "error" && !s.running) return { tone: "error", label: "Error", text: s.note || "Something went wrong." };
  if (!s.models_ready) return { tone: "warn", label: "Loading models", text: "Preparing the face models. The first run downloads about 40 MB." };
  if (!s.running) {
    return s.people === 0
      ? { tone: "warn", label: "No people yet", text: "Open People and add a photo to begin." }
      : { tone: "idle", label: "Stopped", text: "Press Start watching to begin." };
  }
  if (s.state === "reconnecting") return { tone: "warn", label: "Reconnecting", text: s.note || "Reconnecting to the camera..." };
  if (s.paused) return { tone: "warn", label: "Paused", text: "Monitoring is paused. No faces are checked and no alerts are sent. Press Resume to continue." };
  if (s.state === "starting") return { tone: "idle", label: "Connecting", text: "Connecting to the camera..." };
  if (s.alert_age !== null && s.alert_age < 6 && s.last_alert) {
    return { tone: "alert", label: `Alert: ${s.last_alert.name}`, text: `${s.last_alert.name} detected, similarity ${s.last_alert.score.toFixed(2)}` };
  }
  if (s.matched.length) return { tone: "match", label: `${s.matched.join(", ")} in view`, text: `${s.matched.join(", ")} in view` };
  if (s.faces > 0) return { tone: "face", label: "Face seen, no match", text: "A face is in view but it does not match anyone you saved." };
  if (s.missing?.length) return { tone: "warn", label: "Not seen for a while", text: `Not seen for a while: ${s.missing.join(", ")}` };
  return { tone: "idle", label: "Watching", text: "Watching. No face in view." };
}

const ICON = { visit: "➜", missing: "!", back: "✓", unknown: "?" };

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="lv-stat">
      <Icon size={16} aria-hidden="true" />
      <div><span>{label}</span><b>{value}</b></div>
    </div>
  );
}

export default function Live({ status, offline, error, streamKey, onToggle, onPause, settings, onChange, readOnly, onCameraUsed }) {
  const [feed, setFeed] = useState([]);
  const seq = status?.alert_seq;
  useEffect(() => {
    api.alerts(15).then(setFeed).catch(() => {});
  }, [seq]);

  const d = describe(status, offline);
  const running = !!status?.running;
  const paused = running && !!status?.paused;
  const [cams, setCams] = useState([]);
  const loadCams = () => api.cams().then((d) => setCams(d.items)).catch(() => {});
  useEffect(() => { loadCams(); }, [running]);
  const activeCam = cams.find((c) => c.active);
  const camLabel = activeCam ? `${activeCam.name}${activeCam.location ? ` · ${activeCam.location}` : ""}` : status?.source || "Camera";
  const chooseCamera = (id) => {
    if (!id) return;
    api.useCam(id).then(() => { loadCams(); if (onCameraUsed) onCameraUsed(); }).catch(() => loadCams());
  };
  const inView = running && status.matched?.length ? status.matched[0] : null;
  const lastHit = inView ? feed.find((a) => a.name === inView) : null;

  return (
    <section>
      <header className="head">
        <h2>Live</h2>
        <div className="row">
          {cams.length > 0 && (
            <select aria-label="Camera" value={activeCam ? activeCam.id : ""} disabled={running || readOnly}
                    title={running ? "Stop watching to change the camera" : "Choose the camera"}
                    onChange={(e) => chooseCamera(e.target.value)}>
              {!activeCam && <option value="">Other source</option>}
              {cams.map((c) => <option key={c.id} value={c.id}>{c.name}{c.location ? ` (${c.location})` : ""}</option>)}
            </select>
          )}
          {running && !readOnly && (
            <button className="btn lv-btn" onClick={onPause}>
              {paused ? <Play size={16} /> : <Pause size={16} />}
              {paused ? "Resume" : "Pause"}
            </button>
          )}
          {!readOnly && (
            <button className={running ? "btn danger lv-btn" : "btn primary lv-btn"} onClick={onToggle}
                    disabled={!status || !status.models_ready}>
              {running ? <Square size={16} /> : <Play size={16} />}
              {running ? "Stop" : "Start watching"}
            </button>
          )}
        </div>
      </header>
      {error && <p className="note error" role="alert">{error}</p>}
      {status?.notify_error && <p className="note error" role="alert">Telegram: {status.notify_error}</p>}

      <div className="live">
        <div>
          <div className={`lv-stage tone-${d.tone}`}>
            <div className="lv-top">
              <span className={`lv-chip tone-${d.tone}`} role="status">
                <i className={`lv-dot ${running && d.tone !== "warn" ? "pulse" : ""}`} aria-hidden="true" />
                {d.label}
              </span>
              <span className="lv-right">
                <span className="lv-live lv-src"><Camera size={14} aria-hidden="true" /> {camLabel}</span>
                {running && !paused && <span className="lv-live"><i className="lv-rec" aria-hidden="true" /> REC</span>}
              </span>
            </div>
            <div className="lv-video">
              {running
                ? <img key={streamKey} src={`/api/stream?k=${streamKey}`} alt="Live camera view" />
                : <div className="lv-off"><Camera size={40} aria-hidden="true" /><p>Camera is off</p></div>}
            </div>
            {running && (
              <div className="lv-bottom">
                <span>{paused ? "Monitoring paused" : `Monitoring active, ${status.fps.toFixed(0)} FPS`}</span>
                <span><Users size={14} aria-hidden="true" /> {status.faces} {status.faces === 1 ? "face" : "faces"} detected</span>
              </div>
            )}
          </div>
          <p className="lv-line">{d.text}</p>

          <div className="lv-stats">
            <Stat icon={Gauge} label="Best similarity" value={running ? status.best.toFixed(2) : "-"} />
            <Stat icon={Camera} label="Camera" value={activeCam ? activeCam.name : status?.source || "-"} />
            <Stat icon={Monitor} label="Resolution" value={running && status.resolution ? status.resolution : "-"} />
            <Stat icon={Activity} label="Frame rate" value={running && !paused ? `${status.fps.toFixed(0)} FPS` : "-"} />
          </div>
          {status?.note && running && <p className="meta">{status.note}</p>}
        </div>

        <div className="side-col">
          <aside className="card lv-who">
            <h3>Face detected</h3>
            {inView ? (
              <div className="who-row">
                {lastHit?.face
                  ? <img className="face" src={snapshotUrl(lastHit.face)} alt="" />
                  : <span className="face blank" aria-hidden="true">{inView[0]}</span>}
                <div>
                  <strong>{inView}</strong>
                  <p className="muted">Similarity {lastHit ? lastHit.score : status.best.toFixed(2)}</p>
                  <span className="badge-known">Known person</span>
                </div>
              </div>
            ) : running && status.faces > 0 ? (
              <div><strong>Face not recognised</strong><p className="muted">Not one of your saved people.</p></div>
            ) : <p className="muted">{running ? "No face in view." : "Start watching to see who is in view."}</p>}
          </aside>

          <aside className="card feed">
            <h3>Recent alerts</h3>
            {feed.length === 0
              ? <p className="muted">No alerts yet. When a saved person is seen, they appear here.</p>
              : <ul>{feed.map((a) => (
                  <li key={a.id}>
                    {a.face
                      ? <img className="face" src={snapshotUrl(a.face)} alt="" width="40" height="40" />
                      : <span className="face blank" aria-hidden="true">{a.name[0]}</span>}
                    <strong>{a.name}</strong>
                    <span>{a.score}</span>
                    <time>{formatTime(a.time, false)}</time>
                  </li>
                ))}</ul>}
          </aside>

          <aside className="card notices">
            <h3>Notices</h3>
            {!status?.events?.length
              ? <p className="muted">Arrivals, people not seen for a while, and returns show here.</p>
              : <ul>{status.events.map((e, i) => (
                  <li key={`${e.time}-${i}`} className={`ev ${e.kind}`}>
                    <span className="ev-icon" aria-hidden="true">{ICON[e.kind] || "•"}</span>
                    <span>{e.text}</span>
                    <time>{formatTime(e.time, false)}</time>
                  </li>
                ))}</ul>}
          </aside>
        </div>
      </div>
    </section>
  );
}