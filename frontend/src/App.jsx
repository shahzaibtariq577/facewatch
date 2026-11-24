import { useCallback, useEffect, useRef, useState } from "react";
import { Video, LayoutDashboard, Users, UserX, Bell, FileText, CalendarCheck, Activity, BellOff, Settings as Cog, Moon, Sun, ClipboardList, UserCog, KeyRound, Camera, Menu, PanelLeftClose, PanelLeftOpen, LogOut } from "lucide-react";
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
import Attendance from "./pages/Attendance.jsx";
import Audit from "./pages/Audit.jsx";
import Settings from "./pages/Settings.jsx";
import UsersPage from "./pages/Users.jsx";
import Cameras from "./pages/Cameras.jsx";
import Account from "./pages/Account.jsx";
import { useAuth } from "./Gate.jsx";

const PAGES = [
  ["live", "Live", Video],
  ["cameras", "Cameras", Camera],
  ["dashboard", "Dashboard", LayoutDashboard],
  ["people", "People", Users],
  ["unknown", "Not recognised", UserX],
  ["notifications", "Notifications", Bell],
  ["reports", "Reports", FileText],
  ["attendance", "Attendance", CalendarCheck],
  ["quiet", "Ignore", BellOff],
  ["health", "System health", Activity],
  ["audit", "Audit log", ClipboardList],
  ["settings", "Settings", Cog],
  ["users", "Users", UserCog],
  ["account", "My account", KeyRound],
];
const GROUPS = [
  ["Monitoring", ["live", "cameras", "health"]],
  ["Management", ["dashboard", "people", "unknown", "notifications"]],
  ["Records & admin", ["reports", "attendance", "quiet", "audit", "settings", "users", "account"]],
];
const ADMIN_ONLY = ["quiet", "audit", "settings", "users", "cameras"];

export default function App() {
  const { user, role } = useAuth();
  const admin = role === "admin";
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
  const [saveState, setSaveState] = useState("saved");    // saving | saved | error
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("fw-collapsed") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("fw-collapsed", collapsed ? "1" : "0"); } catch { /* storage blocked */ }
  }, [collapsed]);
  useEffect(() => {
    if (!drawer) return undefined;
    const esc = (e) => { if (e.key === "Escape") setDrawer(false); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [drawer]);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("fw-theme") || "light"; } catch { return "light"; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("fw-theme", theme); } catch { /* storage blocked */ }
  }, [theme]);
  useEffect(() => { document.documentElement.dataset.role = admin ? "admin" : "viewer"; }, [admin]);
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
      if (settingsRef.current?.beep && !status.last_alert?.muted) beep();   // no beep for an ignored person
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
    setDrawer(false);
    if (key === "dashboard") setUnseen(0);
  };
  const openPerson = (name) => { setFocus(name); open("people"); };
  const logout = async () => {
    try { await api.logout(); } catch { /* already logged out */ }
    window.dispatchEvent(new Event("fw-logout"));
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
    setSaveState("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const body = pending.current;
      pending.current = {};
      api.saveSettings(body)
        .then(() => { setSaveState("saved"); toast("Settings saved"); })
        .catch((e) => { setSaveState("error"); setError(e.message); toast(e.message, "error"); });
    }, 400);
  }, [toast]);

  const meta = Object.fromEntries(PAGES.map(([k, l, I]) => [k, [l, I]]));
  const visible = (k) => admin || !ADMIN_ONLY.includes(k);
  const badgeFor = (key) => {
    if (key === "dashboard" && unseen > 0) return <span className="badge">{unseen}</span>;
    if (key === "unknown" && unknownNew > 0) return <span className="badge">{unknownNew}</span>;
    if (key === "quiet" && quietCount > 0) return <span className="badge on">{quietCount} on</span>;
    if (key === "notifications" && notifUnread > 0) return <span className="badge">{notifUnread > 99 ? "99+" : notifUnread}</span>;
    return null;
  };
  const sysText = offline ? "Backend offline" : status?.paused ? "Paused" : status?.running ? "Watching" : "System online";

  return (
    <div className={`shell ${collapsed ? "collapsed" : ""} ${drawer ? "drawer" : ""}`}>
      <header className="topbar">
        <button className="burger" onClick={() => setDrawer(true)} aria-label="Open menu"><Menu size={20} /></button>
        <b>FaceWatch</b>
        {notifUnread > 0 && <span className="badge">{notifUnread > 99 ? "99+" : notifUnread}</span>}
      </header>
      <div className="scrim" onClick={() => setDrawer(false)} aria-hidden="true" />
      <nav className="side" aria-label="Main">
        <div className="side-top">
          <div>
            <h1 className="brand"><span className="full">FaceWatch</span><span className="mini">FW</span></h1>
            <p className="tagline">Real-time face monitoring</p>
          </div>
          <button className="collapse" onClick={() => setCollapsed(!collapsed)}
                  aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        {GROUPS.map(([group, keys]) => {
          const items = keys.filter(visible);
          if (!items.length) return null;
          return (
            <div key={group} style={{ display: "contents" }}>
              <p className="grp">{group}</p>
              {items.map((key) => {
                const [label, Icon] = meta[key];
                return (
                  <button key={key} className={`nav ${page === key ? "on" : ""}`} data-tip={label}
                          aria-current={page === key ? "page" : undefined} onClick={() => open(key)}>
                    <span className="nav-l"><Icon size={18} aria-hidden="true" /><span className="nav-t">{label}</span></span>
                    {badgeFor(key)}
                  </button>
                );
              })}
            </div>
          );
        })}
        <div className="side-foot">
          <span className={`sys ${offline ? "off" : status?.running ? "on" : ""}`} title={sysText}>
            <i className="lv-dot" aria-hidden="true" /><span className="t">{sysText}</span>
          </span>
          <div className="whoami"><b>{user}</b> · {admin ? "Admin" : "Viewer"}<small>Signed in</small></div>
          <div className="foot-actions">
            <button className="nav theme" data-tip={theme === "dark" ? "Light mode" : "Dark mode"}
                    onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                    aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
              <span className="nav-l">{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}<span className="nav-t">{theme === "dark" ? "Light mode" : "Dark mode"}</span></span>
            </button>
            <button className="nav" data-tip="Log out" onClick={logout}>
              <span className="nav-l"><LogOut size={17} aria-hidden="true" /><span className="nav-t">Log out</span></span>
            </button>
          </div>
          <span className="ver">v22.0</span>
        </div>
      </nav>
      <main className="main">
        {!admin && <p className="note" role="status">View-only account: you can look at everything here, but not change it.</p>}
        {page === "live" && (
          <Live status={status} offline={offline} error={error} streamKey={streamKey} onToggle={toggle}
                onPause={togglePause} settings={settings} onChange={updateSettings} readOnly={!admin}
                onOpenPage={open} onCameraUsed={() => api.settings().then(setSettings).catch(() => {})} />
        )}
        {page === "dashboard" && <Dashboard alertSeq={status?.alert_seq} onOpenPerson={openPerson} />}
        {page === "people" && <People focus={focus} onFocusDone={() => setFocus(null)} />}
        {page === "unknown" && <Unknown onChanged={refreshUnknown} />}
        {page === "notifications" && <Notifications onChanged={refreshNotif} onOpenPage={open} onOpenPerson={openPerson} />}
        {page === "reports" && <Reports onOpenPerson={openPerson} />}
        {page === "attendance" && <Attendance />}
        {page === "quiet" && <Quiet onChanged={refreshQuiet} />}
        {page === "health" && <Health />}
        {page === "cameras" && admin && <Cameras status={status} />}
        {page === "audit" && admin && <Audit />}
        {page === "users" && admin && <UsersPage />}
        {page === "account" && <Account />}
        {page === "settings" && admin && settings && (
          <Settings settings={settings} onChange={updateSettings} running={!!status?.running} saveState={saveState} />
        )}
      </main>
    </div>
  );
}