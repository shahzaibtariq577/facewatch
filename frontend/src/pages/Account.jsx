import { useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../Gate.jsx";
import { useToast } from "../Toast.jsx";

export default function Account() {
  const { user, role } = useAuth();
  const toast = useToast();
  const [cur, setCur] = useState("");
  const [n1, setN1] = useState("");
  const [n2, setN2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (n1 !== n2) { setErr("The two new passwords are not the same."); return; }
    setBusy(true);
    try {
      await api.changePassword(cur, n1);
      setCur(""); setN1(""); setN2("");
      toast("Password changed");
    } catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  };

  return (
    <section>
      <header className="head"><h2>My account</h2></header>
      <p className="muted lede">Signed in as <b>{user}</b> ({role === "admin" ? "admin: can change everything" : "viewer: can only look"}).</p>
      <form className="card addform keep" onSubmit={submit}>
        <h3>Change my password</h3>
        <label>Current password
          <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" required />
        </label>
        <label>New password (at least 8 characters)
          <input type="password" value={n1} onChange={(e) => setN1(e.target.value)} autoComplete="new-password" required />
        </label>
        <label>Repeat new password
          <input type="password" value={n2} onChange={(e) => setN2(e.target.value)} autoComplete="new-password" required />
        </label>
        {err && <p className="note error" role="alert">{err}</p>}
        <button className="btn primary" disabled={busy || !cur || !n1}>Change password</button>
      </form>
    </section>
  );
}