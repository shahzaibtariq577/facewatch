import { useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../Gate.jsx";
import { useToast } from "../Toast.jsx";

export default function Account() {
  const { user, role } = useAuth();
  const toast = useToast();
  // Password boxes always start empty and are cleared after saving. Nothing is ever prefilled.
  const [cur, setCur] = useState("");
  const [n1, setN1] = useState("");
  const [n2, setN2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const mismatch = n2 !== "" && n1 !== n2;

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
      <header className="head">
        <div>
          <h2>My account</h2>
          <p className="muted">Your profile and password.</p>
        </div>
      </header>
      <div className="grid2 even" style={{ alignItems: "start" }}>
        <div className="card">
          <h3>Profile</h3>
          <div className="who" style={{ gap: 14 }}>
            <span className="face blank" style={{ width: 64, height: 64, fontSize: 26 }} aria-hidden="true">{(user || "?")[0]}</span>
            <div>
              <strong style={{ fontSize: 18 }}>{user}</strong><br />
              <span className={`pill-s ${role === "admin" ? "blue" : ""}`}>{role === "admin" ? "Admin" : "Viewer"}</span>
            </div>
          </div>
          <p className="muted" style={{ margin: "14px 0 0" }}>{role === "admin" ? "Can change everything." : "Can only look. The server refuses changes."}</p>
        </div>
        <form className="card" onSubmit={submit} autoComplete="off" style={{ display: "grid", gap: 12 }}>
          <h3 style={{ margin: 0 }}>Change password</h3>
          <label>Current password
            <input type="password" name="fw-current" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="off" required />
          </label>
          <label>New password
            <input type="password" name="fw-new" value={n1} placeholder="At least 8 characters" onChange={(e) => setN1(e.target.value)} autoComplete="new-password" required />
          </label>
          <label>Confirm new password
            <input type="password" name="fw-confirm" className={mismatch ? "bad" : ""} value={n2} onChange={(e) => setN2(e.target.value)} autoComplete="new-password" required />
            {mismatch && <span className="err-t">Passwords do not match</span>}
          </label>
          {err && <p className="note error" role="alert" style={{ margin: 0 }}>{err}</p>}
          <div><button className="btn primary" disabled={busy || !cur || n1.length < 8 || n1 !== n2}>Save changes</button></div>
        </form>
      </div>
    </section>
  );
}
