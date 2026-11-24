import { useEffect, useState } from "react";
import { api, ago, formatTime, unknownUrl } from "../api.js";
import { useToast } from "../Toast.jsx";

export default function Unknown({ onChanged }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("new");
  const [openId, setOpenId] = useState(null);
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
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const dismiss = (id) => act(() => api.dismissUnknown(id), "Marked as reviewed");
  const remove = (id) => {
    if (window.confirm("Delete this event and its pictures?")) act(() => api.deleteUnknown(id), "Event deleted");
  };
  const addPerson = (e, id) => {
    e.preventDefault();
    act(async () => {
      await api.addUnknownAsPerson(id, name);
      setName(""); setOpenId(null);
    }, "Person added. Add more photos on the People page for better results.");
  };

  if (!data) return <p className="muted">{err || "Loading..."}</p>;
  const items = data.items.filter((x) => filter === "all" || x.status === "new");

  return (
    <section>
      <header className="head">
        <h2>Not recognised</h2>
        <div className="seg" role="group" aria-label="Filter">
          <button className={filter === "new" ? "on" : ""} aria-pressed={filter === "new"} onClick={() => setFilter("new")}>
            New{data.new > 0 ? ` (${data.new})` : ""}
          </button>
          <button className={filter === "all" ? "on" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
        </div>
      </header>
      <p className="muted lede">
        A face that stayed in view but did not match anyone you saved. This only means "not recognised".
        It does not mean the person is a stranger or that anything is wrong. Lookalikes and side views can fail to match.
      </p>
      {err && <p className="note error" role="alert">{err}</p>}

      {items.length === 0
        ? <p className="muted">{filter === "new" ? "Nothing to review." : "No events yet."}</p>
        : <ul className="ugrid">{items.map((x) => (
            <li key={x.id} className="card ucard">
              {x.face
                ? <img className="uface" src={unknownUrl(x.id, "face")} alt="Face that was not recognised" loading="lazy" />
                : <span className="uface blank">?</span>}
              <div className="umeta">
                <strong>Not recognised</strong>
                <span className="muted" title={formatTime(x.time)}>{ago(x.time)} · {formatTime(x.time, false)}</span>
                <span className="muted">{x.source}</span>
                {x.status === "dismissed" && <span className="pill-s">Reviewed</span>}
                {x.status === "added" && <span className="pill-s ok">Added as {x.person}</span>}
              </div>
              {x.full && (
                <details className="ufull">
                  <summary>Full picture</summary>
                  <img className="snap" src={unknownUrl(x.id, "full")} alt="Full camera picture" loading="lazy" />
                </details>
              )}
              {openId === x.id ? (
                <form className="uadd" onSubmit={(e) => addPerson(e, x.id)}>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required maxLength={40} aria-label="Name of the person" />
                  <button className="btn primary" disabled={busy || !name.trim()}>Save</button>
                  <button type="button" className="btn" onClick={() => setOpenId(null)}>Cancel</button>
                </form>
              ) : (
                <div className="pact">
                  {x.face && x.status !== "added" && <button className="btn admin-only" disabled={busy} onClick={() => { setOpenId(x.id); setName(""); }}>Add as person</button>}
                  {x.status === "new" && <button className="btn admin-only" disabled={busy} onClick={() => dismiss(x.id)}>Mark reviewed</button>}
                  <button className="btn admin-only" disabled={busy} onClick={() => remove(x.id)}>Delete</button>
                </div>
              )}
            </li>
          ))}</ul>}
    </section>
  );
}