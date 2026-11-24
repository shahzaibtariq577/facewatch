import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Plus } from "lucide-react";
import { useToast } from "../Toast.jsx";
import Modal from "../Modal.jsx";

export default function Users() {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", confirm: "", role: "viewer" });
  const [showAdd, setShowAdd] = useState(false);
  const [reset, setReset] = useState(null);   // { username, pw }
  const [del, setDel] = useState("");

  const load = () => api.users().then((d) => { setList(d.items); setErr(""); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const run = async (fn, ok) => {
    setBusy(true); setErr("");
    try { await fn(); toast(ok); await load(); return true; }
    catch (e) { setErr(e.message); toast(e.message, "error"); return false; }
    finally { setBusy(false); }
  };

  const add = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) return;
    const ok = await run(async () => {
      await api.addUser(form.username.trim(), form.password, form.role);
    }, "User added");
    if (ok) { setForm({ username: "", password: "", confirm: "", role: "viewer" }); setShowAdd(false); }
  };

  if (!list) return <section><header className="head"><h2>Users</h2></header>{err ? <p className="note error" role="alert">{err}</p> : <p className="muted">Loading...</p>}</section>;

  const admins = list.filter((u) => u.role === "admin").length;
  const mismatch = form.confirm !== "" && form.password !== form.confirm;

  return (
    <section>
      <header className="head">
        <div>
          <h2>Users</h2>
          <p className="muted">Manage application accounts and access permissions.</p>
        </div>
        <button className="btn primary" onClick={() => { setErr(""); setShowAdd(true); }}><Plus size={15} aria-hidden="true" /> Add user</button>
      </header>

      <div className="stats s3">
        <div className="card stat"><span>Total users</span><b>{list.length}</b></div>
        <div className="card stat"><span>Admins</span><b>{admins}</b></div>
        <div className="card stat"><span>Viewers</span><b>{list.length - admins}</b></div>
      </div>
      {err && !showAdd && <p className="note error" role="alert">{err}</p>}

      <div className="card scroll">
        <table>
          <thead><tr><th>Username</th><th>Role</th><th>Actions</th></tr></thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.username}>
                <td><b>{u.username}</b>{u.you && <span className="tag-now">you</span>}</td>
                <td>
                  <select value={u.role} disabled={busy} aria-label={`Role of ${u.username}`}
                          onChange={(e) => run(() => api.updateUser(u.username, { role: e.target.value }), "Role changed")}>
                    <option value="viewer">Viewer</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td>
                  {reset && reset.username === u.username ? (
                    <span className="row">
                      <input type="password" placeholder="New password" aria-label={`New password for ${u.username}`}
                             value={reset.pw} autoComplete="new-password" onChange={(e) => setReset({ ...reset, pw: e.target.value })} />
                      <button className="btn primary" disabled={busy || reset.pw.length < 8}
                              onClick={() => run(async () => { await api.updateUser(u.username, { password: reset.pw }); setReset(null); }, "Password changed")}>Save</button>
                      <button className="btn" onClick={() => setReset(null)}>Cancel</button>
                    </span>
                  ) : del === u.username ? (
                    <span className="row">
                      <span>Delete {u.username}?</span>
                      <button className="btn danger" disabled={busy}
                              onClick={() => run(async () => { await api.deleteUser(u.username); setDel(""); }, "User deleted")}>Yes, delete</button>
                      <button className="btn" onClick={() => setDel("")}>Cancel</button>
                    </span>
                  ) : (
                    <span className="row">
                      <button className="btn" disabled={busy} onClick={() => { setDel(""); setReset({ username: u.username, pw: "" }); }}>Reset password</button>
                      <button className="btn danger-o" disabled={busy || u.you} onClick={() => { setReset(null); setDel(u.username); }}>Delete</button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted"><small>There must always be at least one admin. A deleted user is logged out at their next click. A reset password logs that user out everywhere.</small></p>
      </div>
    
      <div className="grid2 even" style={{ marginTop: 14 }}>
        <div className="card"><h3>Admin</h3><p className="muted" style={{ margin: 0 }}>Can change everything.</p></div>
        <div className="card"><h3>Viewer</h3><p className="muted" style={{ margin: 0 }}>Can only look: no start or stop, no changes, no settings, no audit log. The server refuses a viewer's changes even if a button is visible.</p></div>
      </div>

      {showAdd && (
        <Modal title="Add user" subtitle="Create an account and choose what it can do." onClose={() => setShowAdd(false)}>
          <form onSubmit={add}>
            <label>Username
              <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
                     required maxLength={30} autoComplete="off" autoCapitalize="none" />
            </label>
            <label>Password (at least 8 characters)
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                     required autoComplete="new-password" />
            </label>
            <label>Confirm password
              <input type="password" className={mismatch ? "bad" : ""} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                     required autoComplete="new-password" />
              {mismatch && <span className="err-t">Passwords do not match</span>}
            </label>
            <div className="rolepick" role="group" aria-label="Role">
              <button type="button" className={form.role === "admin" ? "on" : ""} aria-pressed={form.role === "admin"} onClick={() => setForm({ ...form, role: "admin" })}>
                <b>Admin</b><span>Can change everything.</span></button>
              <button type="button" className={form.role === "viewer" ? "on" : ""} aria-pressed={form.role === "viewer"} onClick={() => setForm({ ...form, role: "viewer" })}>
                <b>Viewer</b><span>Can only look. The server refuses changes.</span></button>
            </div>
            {err && <p className="err-t" role="alert">{err}</p>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn primary" disabled={busy || !form.username || form.password.length < 8 || mismatch || !form.confirm}>Add user</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}