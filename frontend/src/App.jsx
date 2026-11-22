import { useCallback, useEffect, useRef, useState } from "react";
import { api, beep } from "./api.js";
import Live from "./pages/Live.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import People from "./pages/People.jsx";
import Settings from "./pages/Settings.jsx";

const PAGES = [
  ["live", "Live"],
  ["dashboard", "Dashboard"],
  ["people", "People"],
  ["settings", "Settings"],
];

export default function App() {
  const [page, setPage] = useState("live");
  const [status, setStatus] = useState(null);
  const [offline, setOffline] = useState(false);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState("");
  const [streamKey, setStreamKey] = useState(0);
  const [unseen, setUnseen] = useState(0);
  const pageRef = useRef(page);
  const settingsRef = useRef(settings);
  const seqRef = useRef(null);
  const saveTimer = useRef(null);
  pageRef.current = page;
  settingsRef.current = settings;

  // Poll the backend status.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await api.status();
        if (alive) { setStatus(s); setOffline(false); }
      } catch {
        if (alive) setOffline(true);
      }
    };
    tick();
    const id = setInterval(tick, 600);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    api.settings().then(setSettings).catch(() => {});
  }, [offline]);

  // New alert: beep and count it on the Dashboard tab.
  useEffect(() => {
    if (!status) return;
    const seq = status.alert_seq;
    if (seqRef.current === null) { seqRef.current = seq; return; }
    if (seq !== seqRef.current) {
      seqRef.current = seq;
      if (settingsRef.current?.beep) beep();
      if (pageRef.current !== "dashboard") setUnseen((n) => n + 1);
    }
  }, [status?.alert_seq]);

  // The backend may start watching by itself (auto start): refresh the video stream when it does.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (status?.running && !wasRunning.current) setStreamKey((k) => k + 1);
    wasRunning.current = !!status?.running;
  }, [status?.running]);

  const open = (key) => {
    setPage(key);
    if (key === "dashboard") setUnseen(0);
  };

  const toggle = async () => {
    setError("");
    try {
      if (status?.running) await api.stop();
      else await api.start();
      setStatus(await api.status());
    } catch (e) {
      setError(e.message);
    }
  };

  // Optimistic update, then save to the backend after a short pause.
  const pending = useRef({});
  const updateSettings = useCallback((patch) => {
    setSettings((s) => ({ ...s, ...patch }));
    pending.current = { ...pending.current, ...patch };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const body = pending.current;
      pending.current = {};
      api.saveSettings(body).catch((e) => setError(e.message));
    }, 400);
  }, []);

  return (
    <div className="shell">
      <nav className="side" aria-label="Main">
        <h1 className="brand">FaceWatch</h1>
        <p className="tagline">Real-time face watcher</p>
        {PAGES.map(([key, label]) => (
          <button key={key} className={`nav ${page === key ? "on" : ""}`}
                  aria-current={page === key ? "page" : undefined} onClick={() => open(key)}>
            {label}
            {key === "dashboard" && unseen > 0 && <span className="badge">{unseen}</span>}
          </button>
        ))}
        <span className="ver">v5.0</span>
      </nav>
      <main className="main">
        {page === "live" && (
          <Live status={status} offline={offline} error={error} streamKey={streamKey} onToggle={toggle} />
        )}
        {page === "dashboard" && <Dashboard alertSeq={status?.alert_seq} />}
        {page === "people" && <People />}
        {page === "settings" && settings && (
          <Settings settings={settings} onChange={updateSettings} running={!!status?.running} />
        )}
      </main>
    </div>
  );
}
