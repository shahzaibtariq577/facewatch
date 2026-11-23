import { useEffect, useState } from "react";
import { Users, Video, Server } from "lucide-react";
import { api, ago, formatTime } from "../api.js";
import { useToast } from "../Toast.jsx";

const FILTERS = [["", "All"], ["people", "People"], ["camera", "Cameras"], ["system", "System"]];
const ICON = { people: Users, camera: Video, system: Server };

export default function Notifications({ onChanged, onOpenPage, onOpenPerson }) {
  const [cat, setCat] = useState("");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const toast = useToast();

  const load = () => api.notifications(cat).then((d) => { setData(d); setErr(""); }).catch((e) => setErr(e.message));
  useEffect(() => {
    setData(null);
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [cat]);

  const refresh = async () => { await load(); if (onChanged) onChanged(); };
  const markRead = async () => {
    try { await api.readNotifications(cat); await refresh(); } catch (e) { toast(e.message, "error"); }
  };
  const clearAll = async () => {
    if (!window.confirm("Delete all notifications?")) return;
    try { await api.clearNotifications(); toast("Notifications cleared"); await refresh(); } catch (e) { toast(e.message, "error"); }
  };

  if (!data) return <p className="muted">{err || "Loading..."}</p>;
  const unreadShown = data.items.filter((n) => !n.read).length;

  return (
    <section>
      <header className="head">
        <h2>Notifications</h2>
        <div className="row">
          <div className="seg" role="group" aria-label="Filter">
            {FILTERS.map(([v, l]) => (
              <button key={v || "all"} className={cat === v ? "on" : ""} aria-pressed={cat === v} onClick={() => setCat(v)}>{l}</button>
            ))}
          </div>
          <button className="btn" onClick={markRead} disabled={unreadShown === 0}>Mark all read</button>
          <button className="btn" onClick={clearAll} disabled={data.total === 0}>Clear all</button>
        </div>
      </header>
      <p className="muted lede">
        A saved list of what happened: people arriving or not seen, camera problems, and system changes.
        {data.unread > 0 ? ` ${data.unread} unread.` : ""}
      </p>
      {err && <p className="note error" role="alert">{err}</p>}

      {data.items.length === 0
        ? <p className="muted">{data.total === 0 ? "No notifications yet. They appear here when something happens." : "Nothing in this group."}</p>
        : <ul className="nlist">{data.items.map((n) => {
            const Icon = ICON[n.category] || Server;
            return (
              <li key={n.id} className={`card nitem ${n.read ? "" : "unread"} k-${n.kind}`}>
                <span className={`nicon c-${n.category}`} aria-hidden="true"><Icon size={18} /></span>
                <div className="nbody">
                  <p>{n.text}</p>
                  <span className="muted" title={formatTime(n.time)}>{ago(n.time)} · {formatTime(n.time, false)}</span>
                </div>
                <div className="nact">
                  {n.kind === "unknown" && <button className="btn" onClick={() => onOpenPage("unknown")}>Review</button>}
                  {n.category === "people" && n.kind !== "unknown" && n.name &&
                    <button className="btn" onClick={() => onOpenPerson(n.name)}>Open {n.name}</button>}
                </div>
                {!n.read && <i className="ndot" aria-label="Unread" />}
              </li>
            );
          })}</ul>}
    </section>
  );
}