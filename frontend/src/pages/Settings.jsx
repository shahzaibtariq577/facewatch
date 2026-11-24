import { useEffect, useState } from "react";
import { Copy, Eye, EyeOff } from "lucide-react";
import { useToast } from "../Toast.jsx";
import { api } from "../api.js";

const INTERVALS = [[5, "Every 5 seconds"], [10, "Every 10 seconds"], [30, "Every 30 seconds"],
                   [60, "Every minute"], [300, "Every 5 minutes"]];
const GAPS = [[60, "1 minute"], [120, "2 minutes"], [300, "5 minutes"], [600, "10 minutes"], [1800, "30 minutes"]];
const NOT_SEEN = [[0, "Off"], [5, "5 minutes"], [15, "15 minutes"], [30, "30 minutes"],
                  [60, "1 hour"], [180, "3 hours"]];

const UNKNOWN_GAPS = [[30, "30 seconds"], [60, "1 minute"], [120, "2 minutes"], [300, "5 minutes"], [600, "10 minutes"]];

const cleanTopic = (v) => v.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
const randomTopic = () => {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return "facewatch-" + [...a].map((b) => (b % 36).toString(36)).join("");
};

const SECTIONS = [["detection", "Detection"], ["alerts", "Alerts"], ["visits", "Visits"], ["phone", "Phone notifications"],
                  ["unknown", "Not recognised"], ["summary", "Daily summary"], ["telegram", "Telegram"], ["storage", "Storage"], ["video", "Video source"], ["account", "Account"]];

export default function Settings({ settings: s, onChange, running, saveState = "saved" }) {
  const toast = useToast();
  const [showTopic, setShowTopic] = useState(false);
  const [active, setActive] = useState("detection");
  const go = (id) => { setActive(id); document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const copyTopic = async () => {
    try { await navigator.clipboard.writeText(s.ntfy_topic || ""); toast("Topic copied"); }
    catch { toast("Could not copy. Show the topic and copy it by hand.", "warn"); }
  };
  const [cams, setCams] = useState([0, 1]);
  const [scanMsg, setScanMsg] = useState("");
  const [usage, setUsage] = useState(null);
  const [token, setToken] = useState("");
  const [testMsg, setTestMsg] = useState("");
  const loadUsage = () => api.storage().then(setUsage).catch(() => {});
  useEffect(() => { loadUsage(); }, []);
  const wipe = async () => {
    if (!window.confirm("Delete ALL saved pictures (faces and full pictures)? The alert history stays.")) return;
    setUsage(await api.deletePictures());
  };

  const scan = async () => {
    setScanMsg("Scanning...");
    try {
      const { cameras } = await api.cameras();
      setCams(cameras.length ? cameras : [0]);
      setScanMsg(cameras.length ? `Found ${cameras.length}` : "No camera found");
    } catch (e) { setScanMsg(e.message); }
  };

  const test = async () => {
    setTestMsg("Sending...");
    try { await api.testNotify(); setTestMsg("Sent. Check Telegram."); }
    catch (e) { setTestMsg(e.message); }
  };

  const check = (k, label) => (
    <label className="check"><input type="checkbox" checked={!!s[k]} onChange={(e) => onChange({ [k]: e.target.checked })} />{label}</label>
  );

  return (
    <section>
      <header className="head">
        <div>
          <h2>Settings</h2>
          <p className="muted">Tune recognition, alerts and notifications. Changes save automatically.</p>
        </div>
        <span className={`savechip ${saveState}`} role="status">{saveState === "saving" ? "Saving..." : saveState === "error" ? "Error: not saved" : "Saved"}</span>
      </header>
      <div className="settings">
        <nav className="setnav" aria-label="Settings sections">
          {SECTIONS.map(([id, label]) => <button key={id} className={active === id ? "on" : ""} onClick={() => go(id)}>{label}</button>)}
        </nav>
        <div>

      <div className="card setgroup" id="set-detection">
        <h3>Detection</h3>
        <label className="range">Match strictness: <b>{(s.threshold_arc ?? 0.45).toFixed(2)}</b>
          <input type="range" min="0.30" max="0.75" step="0.01" value={s.threshold_arc ?? 0.45}
                 onChange={(e) => onChange({ threshold_arc: parseFloat(e.target.value) })} />
        </label>
        <p className="muted">Higher is stricter. If someone who only looks similar gets flagged, raise it. If the real person is missed, lower it. Good starting value: 0.45 to 0.50.</p>
        <label className="range">Lookalike safety gap: <b>{(s.margin ?? 0.05).toFixed(2)}</b>
          <input type="range" min="0" max="0.15" step="0.01" value={s.margin ?? 0.05}
                 onChange={(e) => onChange({ margin: parseFloat(e.target.value) })} />
        </label>
        <p className="muted">The best match must beat the second best person by this much, or the face stays "Not recognised". Higher is safer for people who look alike. 0 turns it off.</p>
        <details className="muted">
          <summary>Old model setting (only used if the app falls back to SFace)</summary>
          <label className="range">Old match strictness: <b>{s.threshold.toFixed(2)}</b>
            <input type="range" min="0.30" max="0.75" step="0.01" value={s.threshold}
                   onChange={(e) => onChange({ threshold: parseFloat(e.target.value) })} />
          </label>
        </details>
        {check("autostart", "Start watching automatically when the backend starts")}
        {check("auto_reconnect", "Reconnect automatically if the camera drops")}
      </div>

      <div className="card setgroup" id="set-alerts">
        <h3>Alerts</h3>
        <label>Alert again while the person stays in view
          <select value={s.alert_interval} onChange={(e) => onChange({ alert_interval: +e.target.value })}>
            {INTERVALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        {check("beep", "Play a beep in this browser")}
        {check("snapshots", "Save a snapshot picture with each alert")}
        {check("pictures_once", "Take only one picture per visit (not at every alert)")}
      </div>

      <div className="card setgroup" id="set-visits">
        <h3>Visits and "not seen"</h3>
        <label>A person back after this long counts as a new visit
          <select value={s.visit_gap} onChange={(e) => onChange({ visit_gap: +e.target.value })}>
            {GAPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>Warn me when a person has not been seen for
          <select value={s.not_seen_minutes} onChange={(e) => onChange({ not_seen_minutes: +e.target.value })}>
            {NOT_SEEN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <p className="muted">The "not seen" timer only runs while watching and the camera is connected. It restarts when you press Start or the camera reconnects. Notices are kept in memory and clear when the backend restarts.</p>
      </div>

      <div className="card setgroup" id="set-phone">
        <h3>Phone alerts (ntfy, easiest)</h3>
        <p className="muted">1) Install the free <b>ntfy</b> app on your phone. 2) Tap + and subscribe to the same topic name you type below. No account needed. Settings save automatically; wait a second before testing.</p>
        <label>Topic name (keep it secret and long)
          <span className="topicrow">
            <input type={showTopic ? "text" : "password"} autoComplete="off" value={s.ntfy_topic || ""} placeholder="facewatch-yourname-4821"
                   onChange={(e) => onChange({ ntfy_topic: cleanTopic(e.target.value) })} />
            <button type="button" className="btn" onClick={() => setShowTopic(!showTopic)} aria-label={showTopic ? "Hide topic" : "Show topic"}>
              {showTopic ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            <button type="button" className="btn" onClick={copyTopic} disabled={!s.ntfy_topic}><Copy size={15} aria-hidden="true" /> Copy</button>
          </span>
        </label>
        <div className="row">
          <button className="btn" onClick={() => onChange({ ntfy_topic: randomTopic() })}>Make a random topic</button>
        </div>
        <p className="muted">Anyone who knows the topic name can read your alerts. Use letters, numbers, - and _ only.</p>
        {check("notify_on_match", "Message me when a person arrives (start of a visit)")}
        {check("notify_send_photo", "Include the face photo")}
        {check("notify_on_missing", 'Message me when a person is "not seen"')}
        <div className="row">
          <button className="btn" onClick={test}>Send test message</button>
          <span className="muted">{testMsg}</span>
        </div>
        <p className="muted">The test goes to every channel that is filled in (ntfy and/or Telegram).</p>
      </div>

      <div className="card setgroup" id="set-unknown">
        <h3>Not recognised faces</h3>
        {check("unknown_events", "Save an event when a face stays in view and matches nobody")}
        {check("notify_on_unknown", "Send a phone alert for these events")}
        <label>Wait this long before the next event
          <select value={s.unknown_gap} onChange={(e) => onChange({ unknown_gap: +e.target.value })}>
            {UNKNOWN_GAPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>

      <div className="card setgroup" id="set-summary">
        <h3>Daily summary</h3>
        {check("daily_summary", "Send an end-of-day summary to the phone")}
        <label>Send after
          <input type="time" value={s.daily_summary_time || "18:00"}
                 onChange={(e) => { if (e.target.value) onChange({ daily_summary_time: e.target.value }); }} />
        </label>
        <p className="muted">Sent once a day through ntfy or Telegram, and only while the backend is running. To test it now, use "Send now" on the Reports page.</p>
      </div>

      <div className="card setgroup" id="set-telegram">
        <h3>Telegram (optional)</h3>
        <p className="muted">Only fill this in if you also want Telegram. Create a bot with @BotFather, press Start in your bot, and get your chat ID from @userinfobot.</p>
        <label>Bot token
          <input type="password" autoComplete="off" value={token}
                 placeholder={s.telegram_token_set ? "Saved. Type to replace." : "123456:ABC-DEF..."}
                 onChange={(e) => { setToken(e.target.value); onChange({ telegram_token: e.target.value }); }} />
        </label>
        <label>Chat ID
          <input value={s.telegram_chat || ""} placeholder="123456789"
                 onChange={(e) => onChange({ telegram_chat: e.target.value })} />
        </label>
      </div>

      <div className="card setgroup" id="set-storage">
        <h3>Storage</h3>
        <p className="muted">Pictures use {usage ? `${usage.mb} MB (${usage.files} files)` : "..."} on this computer.</p>
        {check("save_full_frame", "Save the full picture too (turn off to save only the small face photo)")}
        <label>Delete pictures older than
          <select value={s.keep_days} onChange={(e) => onChange({ keep_days: +e.target.value })}>
            {[[1, "1 day"], [3, "3 days"], [7, "7 days"], [30, "30 days"], [0, "Never (keep forever)"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <div className="row">
          <button className="btn" onClick={wipe}>Delete all saved pictures</button>
          <button className="btn" onClick={loadUsage}>Refresh size</button>
        </div>
      </div>

      <div className="card setgroup" id="set-video">
        <h3>Video source</h3>
        {running && <p className="note">Source changes apply the next time you press Start.</p>}
        <label className="check"><input type="radio" name="mode" checked={s.source_mode === "webcam"} onChange={() => onChange({ source_mode: "webcam" })} />Webcam</label>
        {s.source_mode === "webcam" && (
          <div className="row sub">
            <select value={s.cam_index} onChange={(e) => onChange({ cam_index: +e.target.value })}>
              {[...new Set([...cams, s.cam_index])].sort().map((i) => <option key={i} value={i}>Camera {i}</option>)}
            </select>
            <button className="btn" onClick={scan} disabled={running}>Scan cameras</button>
            <span className="muted">{scanMsg}</span>
          </div>
        )}
        <label className="check"><input type="radio" name="mode" checked={s.source_mode === "video"} onChange={() => onChange({ source_mode: "video" })} />Video file on the backend computer</label>
        {s.source_mode === "video" && (
          <input className="sub" placeholder="C:\Videos\clip.mp4" value={s.video_path} onChange={(e) => onChange({ video_path: e.target.value })} />
        )}
        <label className="check"><input type="radio" name="mode" checked={s.source_mode === "network"} onChange={() => onChange({ source_mode: "network" })} />Network camera (phone app, IP camera, RTSP)</label>
        {s.source_mode === "network" && (
          <>
            <input className="sub" placeholder="rtsp://user:pass@192.168.1.20/stream" value={s.url} onChange={(e) => onChange({ url: e.target.value })} />
            <p className="muted sub">Example: http://192.168.1.5:8080/video. Passwords are hidden in the log and the Live page.</p>
          </>
        )}
      </div>

      <div className="card setgroup" id="set-account">
        <h3>Account</h3>
        <button className="btn" onClick={() => fetch("/api/auth/logout", { method: "POST" }).then(() => window.location.reload())}>Log out</button>
      </div>
        </div>
      </div>
    </section>
  );
}