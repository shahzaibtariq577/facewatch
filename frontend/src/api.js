// Thin wrapper around the FaceWatch REST API. Paths are relative, so the same code
// works with the Vite dev proxy and when the backend serves the built app.
async function req(path, opts) {
  const res = await fetch(path, opts);
  if (res.status === 401) window.dispatchEvent(new Event("fw-logout"));
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).detail || msg;
    } catch { /* body was not JSON */ }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

const send = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const form = (name, files) => {
  const f = new FormData();
  if (name) f.append("name", name);
  [...files].forEach((file) => f.append("files", file));
  return { method: "POST", body: f };
};

const enc = encodeURIComponent;

export const api = {
  status: () => req("/api/status"),
  start: () => req("/api/start", { method: "POST" }),
  stop: () => req("/api/stop", { method: "POST" }),
  pause: () => req("/api/pause", { method: "POST" }),
  resume: () => req("/api/resume", { method: "POST" }),
  settings: () => req("/api/settings"),
  saveSettings: (patch) => req("/api/settings", send("PUT", patch)),
  cameras: () => req("/api/cameras"),
  people: () => req("/api/people"),
  addPerson: (name, files) => req("/api/people", form(name, files)),
  addPhotos: (name, files) => req(`/api/people/${enc(name)}/photos`, form(null, files)),
  removePerson: (name) => req(`/api/people/${enc(name)}`, { method: "DELETE" }),
  alerts: (limit = 15) => req(`/api/alerts?limit=${limit}`),
  dashboard: (days = 0) => req(`/api/dashboard?days=${days}`),
  health: () => req("/api/health"),
  history: (name) => req(`/api/people/${enc(name)}/history`),
  storage: () => req("/api/storage"),
  deletePictures: () => req("/api/snapshots", { method: "DELETE" }),
  clearAlerts: () => req("/api/alerts", { method: "DELETE" }),
  testNotify: () => req("/api/notify/test", { method: "POST" }),
};

export const thumbUrl = (name, v = 0) => `/api/people/${enc(name)}/thumb?v=${v}`;
export const snapshotUrl = (file) => `/snapshots/${enc(file)}`;

export function formatTime(t, withDate = true) {
  if (!t) return "none yet";
  const d = new Date(t.replace(" ", "T"));
  return d.toLocaleString([], withDate
    ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }
    : { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function ago(t) {
  if (!t) return "";
  const s = Math.max(0, Math.round((Date.now() - new Date(t.replace(" ", "T")).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

let audio;
export function beep() {
  try {
    audio = audio || new AudioContext();
    [[880, 0], [1175, 0.28]].forEach(([freq, delay]) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(audio.destination);
      osc.start(audio.currentTime + delay);
      osc.stop(audio.currentTime + delay + 0.22);
    });
  } catch { /* audio blocked until the first click */ }
}