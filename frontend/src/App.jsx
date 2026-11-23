import { useCallback, useEffect, useRef, useState } from "react";
import { Video, LayoutDashboard, Users, UserX, Bell, FileText, Activity, BellOff, Settings as Cog, Moon, Sun } from "lucide-react";
import { api, beep } from "./api.js";
import { useToast } from "./Toast.jsx";
import Live from "./pages/Live.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import People from "./pages/People.jsx";
import Unknown from "./pages/Unknown.jsx";
import Notifications from "./pages/Notifications.jsx";
import Reports from "./pages/Reports.jsx";
import Health from "./pages/Health.jsx";
import Quiet from "./pages/Quiet.jsx";
import Settings from "./pages/Settings.jsx";

const PAGES = [
  ["live", "Live", Video],
  ["dashboard", "Dashboard", LayoutDashboard],
  ["people", "People", Users],
  ["unknown", "Not recognised", UserX],
  ["notifications", "Notifications", Bell],
  ["reports", "Reports", FileText],
  ["quiet", "Ignore", BellOff],
  ["health", "System health", Activity],
  ["settings", "Settings", Cog],
];

export default function App() {
  const [page, setPage] = useState("live");
  const [status, setStatus] = useState(null);
  const [offline, setOffline] = useState(false);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState("");
  const [streamKey, setStreamKey] = useState(0);
  const [unseen, setUnseen] = useState(0);
  const [focus, setFocus] = useState(null);
  const [unknownNew, setUnknownNew] = useState(0);
  const [notifUnread, setNotifUnread] = useState(0);
  const [quietCount, setQuietCount] = useState(0);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("fw-theme") || "light"; } catch { return "light"; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("fw-theme", theme); } catch { /* storage blocked */ }
  }, [theme]);
  const toast = useToast();
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

  // "Not recognised" events: refresh the count when a new one is saved.
  const refreshUnknown = useCallback(() => {
    api.unknown(1).then((u) => setUnknownNew(u.new)).catch(() => {});
  }, []);
  const refreshNotif = useCallback(() => {
    api.notifications("", 1).then((n) => setNotifUnread(n.unread)).catch(() => {});
  }, []);
  useEffect(() => {
    if (status) refreshNotif();
  }, [status?.notif_seq]);
  const refreshQuiet = useCallback(() => {
    api.quiet().then((q) => setQuietCount((q.all ? 1 : 0) + q.people.length)).catch(() => {});
  }, []);
  useEffect(() => {
    refreshQuiet();
    const id = setInterval(refreshQuiet, 30000);
    return () => clearInterval(id);
  }, [refreshQuiet]);
  const unkRef = useRef(null);
  useEffect(() => {
    if (!status) return;
    const n = status.unknown_seq ?? 0;
    if (unkRef.current !== null && n > unkRef.current) toast("A face was not recognised", "warn");
    unkRef.current = n;
    refreshUnknown();
  }, [status?.unknown_seq]);

  // The backend may start watching by itself (auto start): refresh the video stream when it does.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (status?.running && !wasRunning.current) setStreamKey((k) => k + 1);
    wasRunning.current = !!status?.running;
  }, [status?.running]);

  const prevState = useRef(null);
  useEffect(() => {
    const cur = status?.state;
    if (cur === "reconnecting" && prevState.current !== "reconnecting") toast("Camera disconnected. Reconnecting...", "warn");
    else if (prevState.current === "reconnecting" && cur && cur !== "reconnecting") toast("Camera reconnected");
    if (cur) prevState.current = cur;
  }, [status?.state]);

  const open = (key) => {
    setPage(key);
    if (key === "dashboard") setUnseen(0);
  };
  const openPerson = (name) => { setFocus(name); open("people"); };

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

  const togglePause = async () => {
    setError("");
    try {
      const was = !!status?.paused;
      if (was) await api.resume();
      else await api.pause();
      setStatus(await api.status());
      toast(was ? "Monitoring resumed" : "Monitoring paused");
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
      api.saveSettings(body).then(() => toast("Settings saved")).catch((e) => { setError(e.message); toast(e.message, "error"); });
    }, 400);
  }, [toast]);

  return (
    <div className="shell">
      <nav className="side" aria-label="Main">
        <h1 className="brand">FaceWatch</h1>
        <p className="tagline">Real-time face watcher</p>
        {PAGES.map(([key, label, Icon]) => (
          <button key={key} className={`nav ${page === key ? "on" : ""}`}
                  aria-current={page === key ? "page" : undefined} onClick={() => open(key)}>
            <span className="nav-l"><Icon size={18} aria-hidden="true" />{label}</span>
            {key === "dashboard" && unseen > 0 && <span className="badge">{unseen}</span>}
            {key === "unknown" && unknownNew > 0 && <span className="badge">{unknownNew}</span>}
            {key === "quiet" && quietCount > 0 && <span className="badge on">{quietCount} on</span>}
            {key === "notifications" && notifUnread > 0 && <span className="badge">{notifUnread > 99 ? "99+" : notifUnread}</span>}
          </button>
        ))}
        <button className="nav theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
          <span className="nav-l">{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}<span className="t-l">{theme === "dark" ? "Light mode" : "Dark mode"}</span></span>
        </button>
        <span className={`sys ${offline ? "off" : status?.running ? "on" : ""}`}>
          <i className="lv-dot" aria-hidden="true" />
          {offline ? "Backend offline" : status?.paused ? "Paused" : status?.running ? "Watching" : "System online"}
        </span>
        <span className="ver">v14.0</span>
      </nav>
      <main className="main">
        {page === "live" && (
          <Live status={status} offline={offline} error={error} streamKey={streamKey} onToggle={toggle}
                onPause={togglePause} settings={settings} onChange={updateSettings} />
        )}
        {page === "dashboard" && <Dashboard alertSeq={status?.alert_seq} onOpenPerson={openPerson} />}
        {page === "people" && <People focus={focus} onFocusDone={() => setFocus(null)} />}
        {page === "unknown" && <Unknown onChanged={refreshUnknown} />}
        {page === "notifications" && <Notifications onChanged={refreshNotif} onOpenPage={open} onOpenPerson={openPerson} />}
        {page === "reports" && <Reports onOpenPerson={openPerson} />}
        {page === "quiet" && <Quiet onChanged={refreshQuiet} />}
        {page === "health" && <Health />}
        {page === "settings" && settings && (
          <Settings settings={settings} onChange={updateSettings} running={!!status?.running} />
        )}
      </main>
    </div>
  );
}