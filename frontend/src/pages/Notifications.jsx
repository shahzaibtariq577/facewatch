import { useEffect, useState } from "react";
import { Users, Video, Server } from "lucide-react";
import { api, ago, formatTime } from "../api.js";
import { useToast } from "../Toast.jsx";

const FILTERS = [["", "All"], ["people", "People"], ["camera", "Cameras"], ["system", "System"]];
const KINDS = [["", "Any type"], ["visit", "Arrived"], ["missing", "Not seen"], ["back", "Back in view"], ["unknown", "Not recognised"]];
const GROUPABLE = ["visit", "missing", "back", "unknown"];   // repeated notices of these types can be merged
const ICON = { people: Users, camera: Video, system: Server };

// Merge notices that follow each other and are the same type for the same person.
function groupItems(items) {
  const out = [];
  for (const n of items) {
    const last = out[out.length - 1];
    if (last && GROUPABLE.includes(n.kind) && last.kind === n.kind && last.category === n.category && last.name === n.name) {
      last.count += 1;
      last.oldest = n.time;
      last.read = last.read && n.read;
      last.ids.push(n.id);
    } else {
      out.push({ ...n, count: 1, oldest: n.time, ids: [n.id] });
    }
  }
  return out;
}

export default function Notifications({ onChanged, onOpenPage, onOpenPerson }) {
  const [cat, setCat] = useState("");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [group, setGroup] = useState(true);
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
  const resetFilters = () => { setKind(""); setQ(""); setUnreadOnly(false); };

  if (!data) return <p className="muted">{err || "Loading..."}</p>;
  const unreadShown = data.items.filter((n) => !n.read).length;

  const needle = q.trim().toLowerCase();
  const filtered = data.items.filter((n) =>
    (!kind || n.kind === kind)
    && (!unreadOnly || !n.read)
    && (!needle || n.text.toLowerCase().includes(needle) || (n.name || "").toLowerCase().includes(needle)));
  const rows = group ? groupItems(filtered) : filtered.map((n) => ({ ...n, count: 1, oldest: n.time, ids: [n.id] }));
  const filtering = !!(kind || needle || unreadOnly);

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
          <button className="btn admin-only" onClick={markRead} disabled={unreadShown === 0}>Mark all read</button>
          <button className="btn admin-only" onClick={clearAll} disabled={data.total === 0}>Clear all</button>
        </div>
      </header>
      <p className="muted lede">
        A saved list of what happened: people arriving or not seen, camera problems, and system changes.
        {data.unread > 0 ? ` ${data.unread} unread.` : ""}
      </p>

      <div className="row no-print" style={{ marginBottom: 14 }}>
        <input type="search" aria-label="Search notifications" placeholder="Search a name or word" value={q}
               onChange={(e) => setQ(e.target.value)} />
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type of notice">
          {KINDS.map(([v, l]) => <option key={v || "any"} value={v}>{l}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />Unread only</label>
        <label className="check"><input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} />Group repeats</label>
        {filtering && <button className="btn" onClick={resetFilters}>Clear filters</button>}
        <span className="muted">Showing {rows.length} {rows.length === 1 ? "line" : "lines"} ({filtered.length} of {data.items.length} notices)</span>
      </div>
      {err && <p className="note error" role="alert">{err}</p>}

      {rows.length === 0
        ? <p className="muted">{data.total === 0 ? "No notifications yet. They appear here when something happens." : filtering ? "Nothing matches these filters." : "Nothing in this group."}</p>
        : <ul className="nlist">{rows.map((n) => {
            const Icon = ICON[n.category] || Server;
            return (
              <li key={n.ids[0]} className={`card nitem ${n.read ? "" : "unread"} k-${n.kind}`}>
                <span className={`nicon c-${n.category}`} aria-hidden="true"><Icon size={18} /></span>
                <div className="nbody">
                  <p>{n.text}{n.count > 1 && <> <span className="pill-s">× {n.count}</span></>}</p>
                  <span className="muted" title={formatTime(n.time)}>
                    {ago(n.time)} · {formatTime(n.time, false)}
                    {n.count > 1 && <> · {n.count} times since {formatTime(n.oldest, false)}</>}
                  </span>
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