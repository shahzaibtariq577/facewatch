import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useToast } from "../Toast.jsx";

export default function Users() {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", role: "viewer" });
  const [reset, setReset] = useState(null);   // { username, pw }
  const [del, setDel] = useState("");

  const load = () => api.users().then((d) => { setList(d.items); setErr(""); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const run = async (fn, ok) => {
    setBusy(true); setErr("");
    try { await fn(); toast(ok); await load(); }
    catch (e) { setErr(e.message); toast(e.message, "error"); }
    finally { setBusy(false); }
  };

  const add = (e) => {
    e.preventDefault();
    run(async () => {
      await api.addUser(form.username.trim(), form.password, form.role);
      setForm({ username: "", password: "", role: "viewer" });
    }, "User added");
  };

  if (!list) return <section><header className="head"><h2>Users</h2></header>{err ? <p className="note error" role="alert">{err}</p> : <p className="muted">Loading...</p>}</section>;

  return (
    <section>
      <header className="head"><h2>Users</h2></header>
      <p className="muted lede">
        An <b>admin</b> can change everything. A <b>viewer</b> can only look: no start or stop, no adding or deleting people,
        no settings, no audit log. The server refuses a viewer's changes even if a button is visible.
      </p>
      {err && <p className="note error" role="alert">{err}</p>}

      <form className="card addform" onSubmit={add}>
        <h3>Add a user</h3>
        <label>Username
          <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
                 required maxLength={30} autoComplete="off" autoCapitalize="none" />
        </label>
        <label>Password (at least 8 characters)
          <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                 required autoComplete="new-password" />
        </label>
        <label>Role
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="viewer">Viewer (can only look)</option>
            <option value="admin">Admin (can change everything)</option>
          </select>
        </label>
        <button className="btn primary" disabled={busy || !form.username || !form.password}>Add user</button>
      </form>

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
                      <button className="btn" disabled={busy || u.you} onClick={() => { setReset(null); setDel(u.username); }}>Delete</button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted"><small>There must always be at least one admin. A deleted user is logged out at their next click. A reset password logs that user out everywhere.</small></p>
      </div>
    </section>
  );
}