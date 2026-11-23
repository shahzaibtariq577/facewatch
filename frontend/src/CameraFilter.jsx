import { useEffect, useState } from "react";
import { api } from "./api.js";

// A "Camera" drop-down for the Dashboard, Reports and Attendance. It stays hidden while there is only one camera.
export default function CameraFilter({ value, onChange }) {
  const [opts, setOpts] = useState([]);
  useEffect(() => { api.camSources().then((d) => setOpts(d.items)).catch(() => {}); }, []);
  if (opts.length < 2 && !value) return null;
  return (
    <select aria-label="Camera" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All cameras</option>
      {opts.map((o) => <option key={o.name} value={o.name}>{o.name}{o.location ? ` (${o.location})` : ""}</option>)}
    </select>
  );
}