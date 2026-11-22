import { useEffect, useState } from "react";
import { api, formatTime, snapshotUrl } from "../api.js";

function banner(s, offline) {
  if (offline) return { tone: "warn", text: "Cannot reach the backend. Start it on port 8000." };
  if (!s) return { tone: "idle", text: "Connecting..." };
  if (s.state === "error" && !s.running) return { tone: "error", text: s.note || "Something went wrong." };
  if (!s.models_ready) return { tone: "warn", text: "Preparing the face models. The first run downloads about 40 MB." };
  if (!s.running) {
    return s.people === 0
      ? { tone: "warn", text: "No people yet. Open People and add a photo to begin." }
      : { tone: "idle", text: "Press Start watching to begin." };
  }
  if (s.state === "reconnecting") return { tone: "warn", text: s.note || "Reconnecting to the camera..." };
  if (s.alert_age !== null && s.alert_age < 6 && s.last_alert) {
    return { tone: "alert", text: `Alert: ${s.last_alert.name} detected (${s.last_alert.score.toFixed(2)})` };
  }
  if (s.matched.length) return { tone: "match", text: `${s.matched.join(", ")} in view` };
  if (s.missing?.length) return { tone: "warn", text: `Not seen for a while: ${s.missing.join(", ")}` };
  return { tone: "idle", text: "Watching. No target in view." };
}

const ICON = { visit: "➜", missing: "!", back: "✓" };

export default function Live({ status, offline, error, streamKey, onToggle }) {
  const [feed, setFeed] = useState([]);
  const seq = status?.alert_seq;
  useEffect(() => {
    api.alerts(15).then(setFeed).catch(() => {});
  }, [seq]);

  const b = banner(status, offline);
  const running = !!status?.running;
  const pill = !status ? "Connecting"
    : !status.models_ready ? "Loading models"
    : !running ? "Stopped"
    : status.state === "reconnecting" ? "Reconnecting"
    : `Watching, ${status.fps.toFixed(0)} FPS`;

  return (
    <section>
      <header className="head">
        <h2>Live</h2>
        <div className="row">
          <span className={`pill ${running ? "go" : ""}`}>{pill}</span>
          <button className={running ? "btn danger" : "btn primary"} onClick={onToggle}
                  disabled={!status || !status.models_ready}>
            {running ? "Stop" : "Start watching"}
          </button>
        </div>
      </header>
      {error && <p className="note error" role="alert">{error}</p>}
      {status?.notify_error && <p className="note error" role="alert">Telegram: {status.notify_error}</p>}

      <div className="live">
        <div>
          <p className={`banner ${b.tone}`} role="status">{b.text}</p>
          <div className={`frame ${b.tone === "alert" ? "alert" : ""}`}>
            {running
              ? <img key={streamKey} src={`/api/stream?k=${streamKey}`} alt="Live camera view" />
              : <span className="off">Camera is off</span>}
          </div>
          <p className="meta">
            {running
              ? `Faces in view: ${status.faces}   Best score: ${status.best.toFixed(2)}   Source: ${status.source}`
              : status?.source ? `Last source: ${status.source}` : ""}
            {status?.note && running ? `   ${status.note}` : ""}
          </p>
        </div>

        <div className="side-col">
          <aside className="card feed">
            <h3>Recent alerts</h3>
            {feed.length === 0
              ? <p className="muted">New alerts appear here while you are watching.</p>
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