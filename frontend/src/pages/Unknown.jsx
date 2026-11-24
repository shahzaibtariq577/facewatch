import { useEffect, useState } from "react";
import { api, ago, formatTime, unknownUrl } from "../api.js";
import { useToast } from "../Toast.jsx";

export default function Unknown({ onChanged }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState("new");
  const [cam, setCam] = useState("");
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = () => api.unknown(200).then((d) => { setData(d); setErr(""); }).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const act = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      toast(okMsg);
      await load();
      if (onChanged) onChanged();
      return true;
    } catch (e) {
      toast(e.message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <p className="muted">{err || "Loading..."}</p>;
  const reviewed = Math.max(0, data.total - data.new);
  const sources = [...new Set(data.items.map((x) => x.source).filter(Boolean))].sort();
  const needle = q.trim().toLowerCase();
  const items = data.items.filter((x) =>
    (status === "all" || (status === "new" ? x.status === "new" : x.status !== "new"))
    && (!cam || x.source === cam)
    && (!needle || (x.source || "").toLowerCase().includes(needle) || formatTime(x.time).toLowerCase().includes(needle)));
  const sel = data.items.find((x) => x.id === selId);

  const dismiss = (id) => act(() => api.dismissUnknown(id), "Marked as reviewed");
  const remove = async (id) => {
    if (!window.confirm("Delete this event and its pictures?")) return;
    if (await act(() => api.deleteUnknown(id), "Event deleted")) setSelId(null);
  };
  const addPerson = async (e, id) => {
    e.preventDefault();
    const ok = await act(async () => { await api.addUnknownAsPerson(id, name); }, "Person added. Add more photos on the People page for better results.");
    if (ok) { setName(""); setAdding(false); }
  };
  const tag = (x) => x.status === "new" ? <span className="pill-s warn">Pending</span>
    : x.status === "added" ? <span className="pill-s ok">Added as {x.person}</span> : <span className="pill-s">Reviewed</span>;

  return (
    <section>
      <header className="head">
        <div>
          <h2>Not recognised</h2>
          <p className="muted">Review faces that could not be matched to registered people.</p>
        </div>
      </header>

      <div className="stats s3">
        <div className="card stat"><span>Total not recognised</span><b>{data.total}</b></div>
        <div className="card stat"><span>Pending review</span><b>{data.new}</b></div>
        <div className="card stat"><span>Reviewed</span><b>{reviewed}</b></div>
      </div>

      <p className="muted lede">
        A face that stayed in view but did not match anyone you saved. This only means "not recognised".
        It does not mean the person is a stranger or that anything is wrong. Lookalikes and side views can fail to match.
      </p>

      <div className="row no-print" style={{ marginBottom: 14 }}>
        <input type="search" className="search" aria-label="Search" placeholder="Search camera or time" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Review status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="new">Pending review</option>
          <option value="done">Reviewed</option>
          <option value="all">All</option>
        </select>
        {sources.length > 1 && (
          <select aria-label="Camera" value={cam} onChange={(e) => setCam(e.target.value)}>
            <option value="">All cameras</option>
            {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>
      {err && <p className="note error" role="alert">{err}</p>}

      <div className="ulayout">
        <div className="card">
          <h3>Unknown detections</h3>
          {items.length === 0
            ? <div className="empty-state"><b>{status === "new" ? "Nothing to review" : "No events found"}</b>New faces that match nobody will appear here.</div>
            : <ul className="ulist">{items.map((x) => (
                <li key={x.id} className={`urow ${x.id === selId ? "sel" : ""}`}>
                  {x.face
                    ? <img className="uface" src={unknownUrl(x.id, "face")} alt="Face that was not recognised" loading="lazy" />
                    : <span className="uface blank">?</span>}
                  <div>
                    <strong>Unknown face</strong>
                    <span className="muted" title={formatTime(x.time)}>{ago(x.time)} · {formatTime(x.time, false)} · {x.source || "Unknown source"}</span>
                    <span className="muted">Best similarity {x.score ? Number(x.score).toFixed(2) : "--"}</span>
                  </div>
                  {tag(x)}
                  <button className="btn btn-sm" onClick={() => { setSelId(x.id); setAdding(false); }}>View details</button>
                </li>
              ))}</ul>}
        </div>

        <div className="card udetail">
          <h3>Details</h3>
          {!sel ? <p className="muted">Select a detection to see it.</p> : (
            <>
              {sel.full ? <img src={unknownUrl(sel.id, "full")} alt="Full camera picture" />
                : sel.face ? <img src={unknownUrl(sel.id, "face")} alt="Face close-up" />
                : <p className="muted">No picture was saved for this event.</p>}
              <p style={{ margin: "10px 0 0" }}><strong>{formatTime(sel.time)}</strong><br /><span className="muted">{sel.source || "Unknown source"}</span></p>
              {adding ? (
                <form className="uadd" onSubmit={(e) => addPerson(e, sel.id)}>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required maxLength={40} aria-label="Name of the person" />
                  <button className="btn primary" disabled={busy || !name.trim()}>Save</button>
                  <button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button>
                </form>
              ) : (
                <div className="pact">
                  {sel.status === "new" && <button className="btn admin-only" disabled={busy} onClick={() => dismiss(sel.id)}>Mark reviewed</button>}
                  {sel.face && sel.status !== "added" && <button className="btn admin-only" disabled={busy} onClick={() => { setAdding(true); setName(""); }}>Add as person</button>}
                  <button className="btn danger-o admin-only" disabled={busy} onClick={() => remove(sel.id)}>Delete data</button>
                </div>
              )}
              <p className="muted visits-note" style={{ margin: "12px 0 0" }}>Unknown faces are never added to People automatically.</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
