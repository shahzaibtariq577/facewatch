import { useEffect, useState } from "react";
import { Play, Square, Pause, Camera, Users } from "lucide-react";
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
  if (s.alert_age !== null && s.alert_age < 6 && s.last_alert && !s.last_alert.muted) {
    return { tone: "alert", label: `Alert: ${s.last_alert.name}`, text: `${s.last_alert.name} detected, similarity ${s.last_alert.score.toFixed(2)}` };
  }
  if (s.matched.length) return { tone: "match", label: `${s.matched.join(", ")} in view`, text: `${s.matched.join(", ")} in view` };
  if (s.faces > 0) return { tone: "face", label: "Face seen, no match", text: "A face is in view but it does not match anyone you saved." };
  if (s.missing?.length) return { tone: "warn", label: "Not seen for a while", text: `Not seen for a while: ${s.missing.join(", ")}` };
  return { tone: "idle", label: "Watching", text: "Watching. No face in view." };
}

const ICON = { visit: "➜", missing: "!", back: "✓", unknown: "?" };

function Stat({ label, value }) {
  return (
    <div className="lv-stat">
      <span>{label}</span><b>{value}</b>
    </div>
  );
}

export default function Live({ status, offline, error, streamKey, onToggle, onPause, settings, onChange, readOnly, onCameraUsed, onOpenPage }) {
  const [feed, setFeed] = useState([]);
  const seq = status?.alert_seq;
  useEffect(() => {
    api.alerts(15).then(setFeed).catch(() => {});
  }, [seq]);

  const d = describe(status, offline);
  const running = !!status?.running;
  const paused = running && !!status?.paused;
  const [cams, setCams] = useState([]);
  const [multiOn, setMultiOn] = useState(false);
  const [focusLane, setFocusLane] = useState(-1);          // -1 = all cameras in the grid
  const multi = running && !!status?.multi;
  const lanes = status?.lanes || [];
  useEffect(() => { if (!multi) setFocusLane(-1); }, [multi]);
  const loadCams = () => api.cams().then((d) => { setCams(d.items); setMultiOn(!!d.multi); }).catch(() => {});
  useEffect(() => { loadCams(); }, [running]);
  const activeCam = cams.find((c) => c.active);
  const camLabel = multi ? `${lanes.length} cameras` : activeCam ? `${activeCam.name}${activeCam.location ? ` · ${activeCam.location}` : ""}` : status?.source || "Camera";
  const chooseCamera = (id) => {
    if (!id) return;
    api.useCam(id).then(() => { loadCams(); if (onCameraUsed) onCameraUsed(); }).catch(() => loadCams());
  };
  const live = running && !paused && status?.state !== "reconnecting";
  const inView = running && status.matched?.length ? status.matched[0] : null;
  const lastHit = inView ? feed.find((a) => a.name === inView) : null;

  return (
    <section>
      <header className="head">
        <div>
          <h2>Live monitoring</h2>
          <p className="muted">Monitor your cameras and recognise registered people in real time.</p>
        </div>
        <div className="row">
          {cams.length > 0 && (
            <select aria-label="Camera" value={activeCam ? activeCam.id : ""} disabled={running || readOnly || multiOn}
                    title={multiOn ? "Grid mode is on. Choose cameras on the Cameras page." : running ? "Stop watching to change the camera" : "Choose the camera"}
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
                ? <img key={`${streamKey}-${multi ? focusLane : -1}`} src={`/api/stream?k=${streamKey}${multi && focusLane >= 0 ? `&lane=${focusLane}` : ""}`} alt="Live camera view" />
                : <div className="lv-off"><Camera size={36} aria-hidden="true" /><b>{offline ? "Disconnected from the backend" : "Camera is currently stopped."}</b><p>{offline ? "Start the backend on port 8000, then reload." : "Select a camera and press Start watching to begin monitoring."}</p></div>}
            </div>
            {running && (
              <div className="lv-bottom">
                <span>{paused ? "Monitoring paused" : multi ? `Monitoring ${lanes.length} cameras, ${status.fps.toFixed(0)} FPS each` : `Monitoring active, ${status.fps.toFixed(0)} FPS`}</span>
                <span><Users size={14} aria-hidden="true" /> {status.faces} {status.faces === 1 ? "face" : "faces"} detected</span>
              </div>
            )}
          </div>
          <p className="lv-line">{d.text}</p>
          {multi && (
            <div className="lv-lanes" role="group" aria-label="Cameras in the grid">
              <button className={`lv-lane ${focusLane === -1 ? "on" : ""}`} onClick={() => setFocusLane(-1)}>All cameras</button>
              {lanes.map((l) => (
                <button key={l.id} className={`lv-lane s-${l.state} ${focusLane === l.id ? "on" : ""}`} title={l.note || "Click to enlarge"}
                        onClick={() => setFocusLane(focusLane === l.id ? -1 : l.id)}>
                  {l.name}
                  <small>{l.state === "running" ? `${l.fps.toFixed(0)} FPS · ${l.faces} ${l.faces === 1 ? "face" : "faces"}` : l.state}</small>
                </button>
              ))}
            </div>
          )}

          <div className="lv-stats">
            <Stat label="Best similarity" value={running ? status.best.toFixed(2) : "--"} />
            <Stat label="Selected camera" value={multi ? `${lanes.length} cameras` : activeCam ? activeCam.name : status?.source || "--"} />
            <Stat label="Resolution" value={running && status.resolution ? status.resolution : "--"} />
            <Stat label="Frame rate" value={running && !paused ? `${status.fps.toFixed(0)} FPS` : "--"} />
          </div>
          {status?.note && running && <p className="meta">{status.note}</p>}
          {running && status?.model && <p className="meta">Face model: {status.model === "arcface" ? "ArcFace (stronger)" : "SFace (older)"}</p>}
        </div>

        <div className="side-col">
          <aside className="card lv-who">
            <div className="card-h">
              <h3>Face detection</h3>
              <small>{!running ? "waiting to start" : paused ? "paused" : "live"}</small>
            </div>
            <div className="counts" aria-label="Faces in view right now">
              <div><b>{live ? status.faces : "--"}</b><span>Detected</span></div>
              <div><b>{live ? status.matched.length : "--"}</b><span>Recognised</span></div>
              <div><b>{live ? Math.max(0, status.faces - status.matched.length) : "--"}</b><span>Unknown</span></div>
            </div>
            {inView ? (
              <div className="who-row" style={{ marginTop: 14 }}>
                {lastHit?.face
                  ? <img className="face" src={snapshotUrl(lastHit.face)} alt="" />
                  : <span className="face blank" aria-hidden="true">{inView[0]}</span>}
                <div>
                  <strong>{inView}</strong>
                  <p className="muted">Similarity {lastHit ? lastHit.score : status.best.toFixed(2)}</p>
                  <span className="badge-known">Known person</span>
                </div>
              </div>
            ) : live && status.faces > 0 ? (
              <p className="muted" style={{ margin: "12px 0 0" }}><b>Face not recognised.</b> Not one of your saved people.</p>
            ) : <p className="muted" style={{ margin: "12px 0 0" }}>{running ? "No face in view." : "Start watching to see who is in view."}</p>}
          </aside>

          <aside className="card feed">
            <div className="card-h">
              <h3>Recent alerts</h3>
              <small>{running ? "history" : "history, not live"}{onOpenPage && <> · <button className="linkbtn" onClick={() => onOpenPage("dashboard")}>View all</button></>}</small>
            </div>
            {feed.length === 0
              ? <p className="muted">No alerts yet. When a saved person is seen, they appear here.</p>
              : <ul>{feed.map((a) => (
                  <li key={a.id}>
                    {a.face
                      ? <img className="face" src={snapshotUrl(a.face)} alt="" width="38" height="38" />
                      : <span className="face blank" aria-hidden="true">{a.name[0]}</span>}
                    <div><strong>{a.name}</strong><span>{formatTime(a.time, false)} · {a.source}</span></div>
                    <div><b>{a.score}</b><span className="pill-s ok">Recognised</span></div>
                  </li>
                ))}</ul>}
          </aside>

          <aside className="card notices">
            <div className="card-h"><h3>Notices</h3></div>
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