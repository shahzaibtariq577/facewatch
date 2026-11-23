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
  consent: () => req("/api/consent"),
  audit: (category = "", from = "", to = "") =>
    req(`/api/audit?category=${enc(category)}&date_from=${from}&date_to=${to}`),
  setConsent: (name, consent) => req(`/api/people/${enc(name)}/consent`, send("PUT", { consent })),
  renamePerson: (name, newName) => req(`/api/people/${enc(name)}/rename`, send("POST", { new_name: newName })),
  deletePersonData: (name) => req(`/api/people/${enc(name)}/data`, { method: "DELETE" }),
  users: () => req("/api/users"),
  addUser: (username, password, role) => req("/api/users", send("POST", { username, password, role })),
  updateUser: (username, patch) => req(`/api/users/${enc(username)}`, send("PUT", patch)),
  deleteUser: (username) => req(`/api/users/${enc(username)}`, { method: "DELETE" }),
  changePassword: (current_password, new_password) => req("/api/auth/password", send("POST", { current_password, new_password })),
  logout: () => req("/api/auth/logout", { method: "POST" }),
  cams: () => req("/api/cams"),
  camSources: () => req("/api/cams/sources"),
  addCam: (body) => req("/api/cams", send("POST", body)),
  updateCam: (id, body) => req(`/api/cams/${enc(id)}`, send("PUT", body)),
  deleteCam: (id) => req(`/api/cams/${enc(id)}`, { method: "DELETE" }),
  useCam: (id) => req(`/api/cams/${enc(id)}/use`, { method: "POST" }),
  alerts: (limit = 15) => req(`/api/alerts?limit=${limit}`),
  dashboard: (days = 0, from = "", to = "", camera = "") =>
    req(`/api/dashboard?days=${days}${from && to ? `&date_from=${from}&date_to=${to}` : ""}${camera ? `&camera=${enc(camera)}` : ""}`),
  analytics: (days = 0, from = "", to = "", camera = "") =>
    req(`/api/analytics?days=${days}${from && to ? `&date_from=${from}&date_to=${to}` : ""}${camera ? `&camera=${enc(camera)}` : ""}`),
  health: () => req("/api/health"),
  attendance: (from, to, dept = "", camera = "") =>
    req(`/api/attendance?date_from=${from}&date_to=${to}&department=${enc(dept)}&camera=${enc(camera)}`),
  attendanceConfig: () => req("/api/attendance/config"),
  saveAttendanceConfig: (c) => req("/api/attendance/config", send("PUT", {
    grace: c.grace, workdays: c.workdays, shifts: c.shifts, departments: c.departments })),
  setAttendancePerson: (name, department, shift) => req("/api/attendance/person", send("PUT", { name, department, shift })),
  quiet: () => req("/api/quiet"),
  setQuiet: (scope, hours, name = "") => req("/api/quiet", send("POST", { scope, hours, name })),
  clearQuiet: (scope, name = "") => req(`/api/quiet?scope=${scope}&name=${enc(name)}`, { method: "DELETE" }),
  history: (name) => req(`/api/people/${enc(name)}/history`),
  storage: () => req("/api/storage"),
  deletePictures: () => req("/api/snapshots", { method: "DELETE" }),
  clearAlerts: () => req("/api/alerts", { method: "DELETE" }),
  testNotify: () => req("/api/notify/test", { method: "POST" }),
  notifications: (category = "", limit = 200) => req(`/api/notifications?category=${enc(category)}&limit=${limit}`),
  readNotifications: (category = "") => req(`/api/notifications/read?category=${enc(category)}`, { method: "POST" }),
  clearNotifications: () => req("/api/notifications", { method: "DELETE" }),
  report: (date = "", camera = "") => req(`/api/report?date=${date}&camera=${enc(camera)}`),
  sendReport: (date = "") => req(`/api/report/send?date=${date}`, { method: "POST" }),
  unknown: (limit = 100) => req(`/api/unknown?limit=${limit}`),
  dismissUnknown: (id) => req(`/api/unknown/${enc(id)}/dismiss`, { method: "POST" }),
  deleteUnknown: (id) => req(`/api/unknown/${enc(id)}`, { method: "DELETE" }),
  addUnknownAsPerson: (id, name) => req(`/api/unknown/${enc(id)}/add-person`, send("POST", { name })),
};

export const attendanceCsvUrl = (from, to, dept = "", camera = "") =>
  `/api/attendance/export?date_from=${from}&date_to=${to}&department=${enc(dept)}&camera=${enc(camera)}`;
export const auditCsvUrl = (category = "", from = "", to = "") =>
  `/api/audit/export?category=${enc(category)}&date_from=${from}&date_to=${to}`;
export const reportCsvUrl = (date = "", camera = "") => `/api/report/export?date=${date}&camera=${enc(camera)}`;
export const thumbUrl = (name, v = 0) => `/api/people/${enc(name)}/thumb?v=${v}`;
export const unknownUrl = (id, kind = "face") => `/api/unknown/${enc(id)}/image?kind=${kind}`;
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