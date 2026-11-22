import { useEffect, useState } from "react";

async function call(path, body) {
  const res = await fetch(path, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : undefined);
  let data = {};
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new Error(data.detail || res.statusText);
  return data;
}

export default function Gate({ children }) {
  const [st, setSt] = useState(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const check = () => call("/api/auth/state").then(setSt).catch(() => setSt({ offline: true }));
  useEffect(() => {
    check();
    const out = () => setSt((s) => (s && s.logged_in ? { ...s, logged_in: false } : s));
    window.addEventListener("fw-logout", out);
    return () => window.removeEventListener("fw-logout", out);
  }, []);

  if (!st) return <p className="muted gate">Loading...</p>;
  if (st.logged_in) return children;
  if (st.offline) {
    return (
      <div className="gate card">
        <h2>FaceWatch</h2>
        <p className="note">Cannot reach the backend. Start it on port 8000.</p>
        <button className="btn" onClick={check}>Try again</button>
      </div>
    );
  }

  const setup = st.setup_needed;
  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (setup && pw !== pw2) { setErr("The two passwords are not the same."); return; }
    setBusy(true);
    try {
      await call(setup ? "/api/auth/setup" : "/api/auth/login", { password: pw });
      setPw(""); setPw2("");
      await check();
    } catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  };

  return (
    <form className="gate card" onSubmit={submit}>
      <h2>FaceWatch</h2>
      <p className="muted">{setup ? "First time: choose a password (at least 8 characters)." : "Enter your password."}</p>
      <label>Password
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)}
               autoComplete={setup ? "new-password" : "current-password"} autoFocus required />
      </label>
      {setup && (
        <label>Repeat password
          <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
                 autoComplete="new-password" required />
        </label>
      )}
      {err && <p className="note error" role="alert">{err}</p>}
      <button className="btn primary" disabled={busy || !pw}>{setup ? "Save password" : "Log in"}</button>
    </form>
  );
}