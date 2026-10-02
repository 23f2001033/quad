// Quad frontend: a dependency-free SPA. Cognito auth over fetch, HTTP API for data, WebSocket API for live updates.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const TYPE_META = {
  subject: { label: "Course" },
  hackathon: { label: "Hackathon" },
  event: { label: "Event / fest" },
  club: { label: "Club" },
  other: { label: "Meetup & other" },
};
const LEVELS = ["Foundation", "Diploma in Programming", "Diploma in Data Science", "BSc", "BS", "Alumni"];
const MAX_FILE = 15 * 1024 * 1024;
const wideMQ = window.matchMedia("(min-width: 1201px)");

let cfg;
let session = null;
let me = null;
let dmUnread = 0, notifUnread = 0;
let ws = null, wsWanted = [], wsRetry = 0, wsPing = null, wsOpenedOnce = false;
let current = { handlers: [], reconnect: [] };
let routeSeq = 0;
let pendingSignup = null;

// ---------------- icons (Lucide-style, MIT) ----------------
const ICONS = {
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z"/>',
  trending: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  arrowUp: '<path d="M9 18v-6H5l7-7 7 7h-4v6H9z"/>',
  arrowDown: '<path d="M15 6v6h4l-7 7-7-7h4V6h6z"/>',
  comment: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  sparkles: '<path d="M9.94 14.5A2 2 0 0 0 8.5 13.06L2.36 11.5a.5.5 0 0 1 0-.96L8.5 8.94A2 2 0 0 0 9.94 7.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 7.5A2 2 0 0 0 15.5 8.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 13.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  chart: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  reply: '<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  grad: '<path d="M21.42 10.92a1 1 0 0 0-.02-1.84l-8.57-3.9a2 2 0 0 0-1.66 0l-8.57 3.9a1 1 0 0 0 0 1.83l8.57 3.91a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
};
const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
const theme = () => document.documentElement.dataset.theme || "light";
function hydrateIcons(root = document) {
  $$("[data-icon]", root).forEach((el) => {
    const name = el.dataset.icon === "theme" ? (theme() === "dark" ? "sun" : "moon") : el.dataset.icon;
    if (!el.querySelector("svg.ic") || el.dataset.icon === "theme") el.insertAdjacentHTML("afterbegin", icon(name));
    if (el.dataset.icon === "theme") $$("svg.ic", el).slice(1).forEach((s) => s.remove());
  });
}
function toggleTheme() {
  const t = theme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("quad.theme", t); } catch { /* private mode */ }
  $$('[data-icon="theme"]').forEach((el) => { el.innerHTML = icon(t === "dark" ? "sun" : "moon"); });
}

// ---------------- small helpers ----------------
const store = {
  get() { try { return JSON.parse(localStorage.getItem("quad.session") || "null"); } catch { return null; } },
  set(v) { try { v ? localStorage.setItem("quad.session", JSON.stringify(v)) : localStorage.removeItem("quad.session"); } catch { /* private mode */ } },
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const rich = (s) => esc(s).replace(/\bhttps?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
const hue = (str) => { let h = 7; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const initials = (n) => (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const avatar = (name, seed, size = "") => `<span class="avatar ${size}" style="background:hsl(${hue(seed || name)} 55% 48%)">${esc(initials(name))}</span>`;
const cAvatar = (name, seed, size = "") => `<span class="c-av ${size}" style="background:hsl(${hue(seed)} 62% 52%)">${esc((name || "?").replace(/[^A-Za-z0-9]/g, "")[0] || "Q").toUpperCase()}</span>`;
const banner = (seed) => `background:linear-gradient(120deg, hsl(${hue(seed)} 70% 58%), hsl(${(hue(seed) + 45) % 360} 70% 46%))`;
const dmConv = (a, b) => "d_" + [a, b].sort().join("_");
const postLink = (p) => `#/c/${p.cid}/p/${p.pid}`;
const go = (h) => { if (location.hash === h) route(); else location.hash = h; };
const fmtScore = (n) => { n = Number(n || 0); return Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); };
const plural = (n, w) => `${n} ${w}${Number(n) === 1 ? "" : "s"}`;

function ago(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
const clock = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
function dayLabel(ms) {
  const d = new Date(ms).toDateString(), today = new Date(), y = new Date();
  y.setDate(today.getDate() - 1);
  if (d === today.toDateString()) return "Today";
  if (d === y.toDateString()) return "Yesterday";
  return new Date(ms).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
function fmtSize(b) {
  b = Number(b || 0);
  return b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`;
}
function jwtClaims(t) {
  try {
    const b64 = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
  } catch { return {}; }
}
function toast(msg, err = false, onClick) {
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : "");
  t.textContent = msg;
  t.onclick = () => { onClick?.(); t.remove(); };
  $("#toasts").append(t);
  setTimeout(() => t.remove(), 5000);
}
function openModal(html) {
  $("#modal-body").innerHTML = html;
  hydrateIcons($("#modal-body"));
  const d = $("#modal");
  if (!d.open) d.showModal();
  return $("#modal-body");
}
function closeModal() { const d = $("#modal"); if (d.open) d.close(); }
const modalHead = (title) => `<div class="modal-head"><h2>${title}</h2><button class="icon-btn" type="button" data-action="close-modal" aria-label="Close">${icon("x")}</button></div>`;
const emptyState = (ic, html) => `<div class="empty">${icon(ic)}<div>${html}</div></div>`;

// ---------------- auth (Amazon Cognito) ----------------
async function cognito(target, body) {
  const r = await fetch(`https://cognito-idp.${cfg.region}.amazonaws.com/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}` },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error((j.message || "Something went wrong").replace(/^PreSignUp failed with error /, ""));
    e.code = (j.__type || "").split("#").pop();
    throw e;
  }
  return j;
}
function saveTokens(auth, demo = false) {
  session = { idToken: auth.IdToken, refreshToken: auth.RefreshToken || session?.refreshToken, exp: jwtClaims(auth.IdToken).exp * 1000, demo, federated: session?.federated };
  store.set(session);
}
async function idToken() {
  if (!session) return null;
  if (Date.now() > session.exp - 60_000) {
    if (!session.refreshToken) {
      logout();
      toast("Your demo session ended. Click “Try the demo” to start again.");
      return null;
    }
    try {
      const r = await cognito("InitiateAuth", { AuthFlow: "REFRESH_TOKEN_AUTH", ClientId: cfg.clientId, AuthParameters: { REFRESH_TOKEN: session.refreshToken } });
      saveTokens(r.AuthenticationResult);
    } catch { logout(); return null; }
  }
  return session.idToken;
}
async function api(method, path, body) {
  const isPublic = path.startsWith("/api/public/");
  const token = isPublic ? null : await idToken();
  if (!isPublic && !token) throw new Error("Please log in");
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = token;
  const r = await fetch(cfg.apiUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !isPublic) { logout(); throw new Error("Please log in again"); }
  if (!r.ok) throw new Error(j.error || j.message || `Request failed (${r.status})`);
  return j;
}
async function uploadFile(file) {
  if (file.size > MAX_FILE) throw new Error(`${file.name} is over 15 MB`);
  const type = file.type || "application/octet-stream";
  const p = await api("POST", "/api/uploads", { filename: file.name, contentType: type, size: file.size });
  const fd = new FormData();
  Object.entries(p.fields).forEach(([k, v]) => fd.append(k, v));
  fd.append("file", file);
  const r = await fetch(p.url, { method: "POST", body: fd });
  if (!r.ok) throw new Error(`Upload of ${file.name} failed`);
  return { key: p.key, name: file.name, size: file.size, type };
}

const domains = () => cfg.allowedDomains || [];
const AUTH = {
  async login(f) {
    const email = f.email.trim().toLowerCase();
    try {
      const r = await cognito("InitiateAuth", { AuthFlow: "USER_PASSWORD_AUTH", ClientId: cfg.clientId, AuthParameters: { USERNAME: email, PASSWORD: f.password } });
      saveTokens(r.AuthenticationResult);
      closeModal();
      await enterApp();
    } catch (e) {
      if (e.code === "UserNotConfirmedException") {
        pendingSignup = { email, password: f.password };
        await cognito("ResendConfirmationCode", { ClientId: cfg.clientId, Username: email });
        return authModal("confirm", email);
      }
      if (e.code === "NotAuthorizedException") throw new Error("Wrong email or password.");
      throw e;
    }
  },
  async signup(f) {
    const email = f.email.trim().toLowerCase();
    if (domains().length && !domains().some((d) => email.endsWith("@" + d))) throw new Error(`Please use your @${domains()[0]} student email.`);
    await cognito("SignUp", {
      ClientId: cfg.clientId, Username: email, Password: f.password,
      UserAttributes: [{ Name: "email", Value: email }, { Name: "name", Value: f.name.trim() }],
    });
    pendingSignup = { email, password: f.password };
    authModal("confirm", email);
  },
  async confirm(f, email) {
    await cognito("ConfirmSignUp", { ClientId: cfg.clientId, Username: email, ConfirmationCode: f.code.trim() });
    if (pendingSignup?.email === email) {
      await AUTH.login({ email, password: pendingSignup.password });
      pendingSignup = null;
      toast("Welcome to Quad! 🎉 Set up your profile so people can find you.");
      go("#/me");
    } else {
      authModal("login", email);
      toast("Email verified. Log in to continue.");
    }
  },
  async forgot(f) {
    const email = f.email.trim().toLowerCase();
    await cognito("ForgotPassword", { ClientId: cfg.clientId, Username: email });
    authModal("reset", email);
  },
  async reset(f, email) {
    await cognito("ConfirmForgotPassword", { ClientId: cfg.clientId, Username: email, ConfirmationCode: f.code.trim(), Password: f.password });
    toast("Password changed. Log in with your new password.");
    authModal("login", email);
  },
};

// "Continue with Google": Cognito hosted OAuth, authorization code + PKCE
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const redirectUri = () => `${location.origin}/`;
const GOOGLE_ICON = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>`;

async function googleLogin() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  try { sessionStorage.setItem("quad.pkce", JSON.stringify({ verifier, state })); } catch { return toast("Please allow site storage to sign in.", true); }
  const q = new URLSearchParams({
    identity_provider: "Google", response_type: "code", client_id: cfg.clientId, redirect_uri: redirectUri(),
    scope: "openid email profile", state, code_challenge: challenge, code_challenge_method: "S256",
  });
  location.href = `${cfg.authDomain}/oauth2/authorize?${q}`;
}

async function finishGoogleLogin() {
  const q = new URLSearchParams(location.search);
  if (!q.has("code") && !q.has("error")) return false;
  history.replaceState(null, "", location.pathname + location.hash);
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem("quad.pkce") || "null"); sessionStorage.removeItem("quad.pkce"); } catch { /* handled below */ }
  if (q.has("error")) {
    const msg = (q.get("error_description") || "Sign-in was cancelled.").replace(/^PreSignUp failed with error /, "");
    openModal(`${modalHead("Couldn't sign you in")}<p>${esc(msg)}</p>
      <p class="muted small">If Google picked your personal account, choose your <b>@${esc(domains()[0] || "student")}</b> account instead.</p>
      <div class="modal-actions"><button class="btn primary" data-action="google">${GOOGLE_ICON} Try again</button></div>`);
    return false;
  }
  if (!saved || saved.state !== q.get("state")) { toast("That sign-in link expired. Please try again.", true); return false; }
  const r = await fetch(`${cfg.authDomain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: cfg.clientId, code: q.get("code"), redirect_uri: redirectUri(), code_verifier: saved.verifier }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { toast(j.error_description || "Google sign-in failed. Please try again.", true); return false; }
  saveTokens({ IdToken: j.id_token, RefreshToken: j.refresh_token });
  session.federated = true;
  store.set(session);
  return true;
}

function authModal(mode, email = "") {
  const hint = domains().length ? `Only <b>@${esc(domains()[0])}</b> accounts can join.` : "";
  const emailField = `<label>Student email</label><input name="email" type="email" required autocomplete="email" value="${esc(email)}" placeholder="${domains().length ? "21f1000000@" + esc(domains()[0]) : "you@college.edu"}">`;
  const pw = (ac) => `<label>Password</label><input name="password" type="password" required minlength="8" autocomplete="${ac}"><p class="hint">At least 8 characters, with a number.</p>`;
  const google = cfg.authDomain ? `<button class="btn google" type="button" data-action="google">${GOOGLE_ICON} Continue with your IITM Google account</button>` : "";
  const emailSignup = `<form><label>Full name</label><input name="name" required maxlength="60" autocomplete="name">${emailField}${pw("new-password")}
      <p class="error"></p><div class="modal-actions"><button class="btn primary" type="submit">Create account</button></div></form>`;
  const views = {
    login: `${modalHead("Log in to Quad")}${google}${google ? `<p class="divider">or with email and password</p>` : ""}
      <form>${emailField}<label>Password</label><input name="password" type="password" required autocomplete="current-password">
      <p class="error"></p><div class="modal-actions"><button class="btn ${google ? "outline" : "primary"}" type="submit">Log in</button></div></form>
      <p class="switch">New here? <a href="#" data-auth="signup">Create an account</a> · <a href="#" data-auth="forgot">Forgot password?</a></p>`,
    signup: google
      ? `${modalHead("Join Quad")}<p class="muted">${hint} Google confirms you own your student address, so there are no codes to wait for.</p>${google}
        <p class="switch">Already joined? <a href="#" data-auth="login">Log in</a> · <a href="#" data-auth="signup-email">Sign up with an email code instead</a></p>`
      : `${modalHead("Join Quad")}<p class="muted small">${hint} We'll email you a code to confirm the address is yours.</p>${emailSignup}
        <p class="switch">Already joined? <a href="#" data-auth="login">Log in</a></p>`,
    "signup-email": `${modalHead("Sign up with email")}<p class="muted small">${hint} We'll email you a code from no-reply@verificationemail.com. It can take a few minutes, so check spam too.</p>${emailSignup}
      <p class="switch"><a href="#" data-auth="signup">← Back to Google sign-in</a></p>`,
    confirm: `${modalHead("Check your inbox")}<p class="muted">We sent a 6-digit code to <b>${esc(email)}</b>. It can take a minute, so check spam too.</p>
      <form><label>Verification code</label><input name="code" required inputmode="numeric" autocomplete="one-time-code" maxlength="6">
      <p class="error"></p><div class="modal-actions"><button class="btn ghost" type="button" data-resend>Resend code</button><button class="btn primary" type="submit">Verify</button></div></form>`,
    forgot: `${modalHead("Reset password")}<form>${emailField}<p class="error"></p>
      <div class="modal-actions"><button class="btn primary" type="submit">Send reset code</button></div></form>`,
    reset: `${modalHead("Choose a new password")}<p class="muted small">Enter the code we emailed to <b>${esc(email)}</b>.</p>
      <form><label>Code</label><input name="code" required inputmode="numeric" maxlength="6">${pw("new-password")}<p class="error"></p>
      <div class="modal-actions"><button class="btn primary" type="submit">Change password</button></div></form>`,
  };
  const body = openModal(views[mode]);
  $$("[data-auth]", body).forEach((a) => (a.onclick = (e) => { e.preventDefault(); authModal(a.dataset.auth, $("[name=email]", body)?.value || email); }));
  $("[data-resend]", body)?.addEventListener("click", async () => {
    try { await cognito("ResendConfirmationCode", { ClientId: cfg.clientId, Username: email }); toast("New code sent."); } catch (e) { toast(e.message, true); }
  });
  const form = $("form", body);
  if (!form) return;
  const submit = AUTH[mode === "signup-email" ? "signup" : mode];
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = $(".error", form), btn = $("[type=submit]", form);
    err.textContent = "";
    btn.disabled = true;
    try { await submit(Object.fromEntries(new FormData(form)), email); } catch (x) { err.textContent = x.message; } finally { btn.disabled = false; }
  };
  if (!cfg.authDomain || mode !== "login") $("input", form)?.focus();
}

async function demoLogin(btn) {
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = "Opening demo…";
  try {
    const r = await api("POST", "/api/public/demo");
    session = { idToken: r.idToken, exp: jwtClaims(r.idToken).exp * 1000, demo: true };
    store.set(session);
    await enterApp();
  } catch (e) { toast(e.message, true); } finally { btn.disabled = false; btn.innerHTML = label; }
}

function logout() {
  session = null;
  me = null;
  store.set(null);
  wsClose();
  closeModal();
  $("#app").hidden = true;
  $("#landing").hidden = false;
  history.replaceState(null, "", location.pathname);
  loadStats();
}

// ---------------- realtime (API Gateway WebSocket) ----------------
async function wsConnect() {
  if (!session || ws) return;
  let ticket;
  try { ({ ticket } = await api("POST", "/api/ws-ticket")); } catch { return wsRetryLater(); }
  const sock = new WebSocket(`${cfg.wsUrl}?ticket=${encodeURIComponent(ticket)}`);
  ws = sock;
  sock.onopen = () => {
    wsRetry = 0;
    wsSendWatch();
    clearInterval(wsPing);
    wsPing = setInterval(() => sock.readyState === 1 && sock.send('{"action":"ping"}'), 4 * 60_000);
    if (wsOpenedOnce) current.reconnect.forEach((fn) => fn());
    wsOpenedOnce = true;
  };
  sock.onmessage = (e) => { try { onEvent(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  sock.onclose = () => { if (ws === sock) { ws = null; clearInterval(wsPing); wsRetryLater(); } };
}
function wsRetryLater() { if (session) setTimeout(wsConnect, Math.min(30_000, 1000 * 2 ** wsRetry++)); }
function wsSendWatch() { if (ws?.readyState === 1) ws.send(JSON.stringify({ action: "watch", channels: wsWanted })); }
function watch(channels) { wsWanted = channels; wsSendWatch(); }
function wsClose() { const s = ws; ws = null; clearInterval(wsPing); wsOpenedOnce = false; s?.close(); }

function onEvent(ev) {
  if (ev.type === "dm" && current.conv !== ev.message.conv) {
    dmUnread++;
    renderBadges();
    toast(`${ev.fromName}: ${ev.message.text || "sent a file"}`, false, () => go(`#/dm/${ev.from}`));
  }
  if (ev.type === "notif") {
    notifUnread++;
    renderBadges();
    toast(`${ev.notif.actorName} ${ev.notif.text}`, false, () => go(ev.notif.link));
  }
  current.handlers.forEach((fn) => fn(ev));
}

// ---------------- app shell ----------------
async function enterApp() {
  $("#landing").hidden = true;
  $("#app").hidden = false;
  $("#demo-banner").hidden = !session.demo;
  try { me = await api("GET", "/api/me"); } catch (e) { toast(e.message, true); return; }
  $("#me-avatar").innerHTML = avatar(me.name, me.sub, "sm");
  await refreshSidebar();
  refreshBadges();
  wsConnect();
  route();
}

async function refreshSidebar() {
  const { communities } = await api("GET", "/api/my/communities");
  $("#my-comms").innerHTML = communities.length
    ? communities.map((c) => `<a href="#/c/${esc(c.cid)}" data-cid="${esc(c.cid)}">${cAvatar(c.name, c.cid, "sm")}<span>${esc(c.name)}</span></a>`).join("")
    : `<p class="muted small" style="padding:0 12px">Join communities from Explore and they'll show up here.</p>`;
  setActiveNav();
}
async function refreshBadges() {
  try {
    const [{ dms }, { unread }] = await Promise.all([api("GET", "/api/dms"), api("GET", "/api/notifications")]);
    dmUnread = dms.reduce((n, d) => n + Number(d.unread || 0), 0);
    notifUnread = unread;
    renderBadges();
  } catch { /* badges are cosmetic */ }
}
function renderBadges() {
  for (const [id, n] of [["#dm-badge", dmUnread], ["#notif-badge", notifUnread]]) {
    const b = $(id);
    b.hidden = n <= 0;
    b.textContent = n > 9 ? "9+" : n;
  }
}
function setActiveNav() {
  const parts = (location.hash.slice(1) || "/").split("/").filter(Boolean);
  const key = parts[0] === "dm" ? "messages" : parts[0] || "home";
  $$(".side-nav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === key));
  $$(".side-comms a").forEach((a) => a.classList.toggle("active", parts[0] === "c" && a.dataset.cid === parts[1]));
}
function closePanels(except) {
  $$(".menu-panel").forEach((p) => { if (p !== except) p.hidden = true; });
}

async function toggleNotifications() {
  const panel = $("#notif-panel");
  const opening = panel.hidden;
  closePanels(panel);
  panel.hidden = !opening;
  if (!opening) return;
  panel.innerHTML = `<div class="notif-head">Notifications</div><div class="loading">Loading…</div>`;
  try {
    const { notifications } = await api("GET", "/api/notifications");
    panel.innerHTML = `<div class="notif-head">Notifications</div>${notifications.length
      ? notifications.map((n) => `<a class="notif ${n.read ? "" : "unread"}" href="${esc(n.link)}">${avatar(n.actorName, n.actor, "sm")}
          <div class="grow"><div><b>${esc(n.actorName)}</b> ${esc(n.text)}</div><div class="muted xs">${ago(n.createdAt)}</div></div></a>`).join("")
      : `<div class="loading">${icon("bell")}<p>No notifications yet. Replies to your posts and comments will show up here.</p></div>`}`;
    if (notifications.some((n) => !n.read)) {
      notifUnread = 0;
      renderBadges();
      api("POST", "/api/notifications/read").catch(() => {});
    }
  } catch (e) { panel.innerHTML = `<div class="loading error">${esc(e.message)}</div>`; }
}

async function route() {
  if (!session || !me) return;
  document.body.classList.remove("menu-open");
  closeModal();
  closePanels();
  const parts = (location.hash.slice(1) || "/").split("/").filter(Boolean);
  const seq = ++routeSeq;
  current = { handlers: [], reconnect: [] };
  watch([]);
  document.body.classList.toggle("no-fab", /^(dm|messages)$/.test(parts[0] || "") || (parts[0] === "c" && parts[2] === "chat"));
  setActiveNav();
  const view = $("#view");
  const ctx = { view, stale: () => seq !== routeSeq };
  view.innerHTML = `<div class="page"><div class="page-main"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div></div>`;
  window.scrollTo(0, 0);
  try {
    if (parts[0] === "all") await viewFeed(ctx, "all");
    else if (parts[0] === "explore") await viewExplore(ctx);
    else if (parts[0] === "c" && parts[1] && parts[2] === "p" && parts[3]) await viewPost(ctx, parts[1], parts[3]);
    else if (parts[0] === "c" && parts[1]) await viewCommunity(ctx, parts[1], parts[2] || "posts");
    else if (parts[0] === "messages") await viewMessages(ctx, null);
    else if (parts[0] === "dm" && parts[1]) await viewMessages(ctx, parts[1]);
    else if (parts[0] === "u" && parts[1]) await viewUser(ctx, parts[1]);
    else if (parts[0] === "me") await viewMe(ctx);
    else if (parts[0] === "search") await viewSearch(ctx, decodeURIComponent(parts.slice(1).join("/")));
    else await viewFeed(ctx, "mine");
  } catch (e) {
    if (!ctx.stale() && session) view.innerHTML = `<div class="page"><div class="page-main">${emptyState("x", esc(e.message))}</div></div>`;
  }
  if (!ctx.stale()) hydrateIcons(view);
}

// ---------------- shared renderers ----------------
const sampleTag = (x) => (x.sample ? `<span class="tag sample" title="Sample content for the demo">Sample</span>` : "");
const profileLine = (u) => [u.level, u.batch && `Batch ${u.batch}`, u.city].filter(Boolean).map(esc).join(" · ");
const typeLabel = (t) => (TYPE_META[t] || TYPE_META.other).label;

function attsHtml(atts = []) {
  if (!atts?.length) return "";
  return `<div class="atts">${atts.map((a) => (a.type || "").startsWith("image/") && a.type !== "image/svg+xml"
    ? `<a href="${esc(a.url)}" target="_blank" rel="noopener"><img class="att-img" src="${esc(a.url)}" alt="${esc(a.name)}" loading="lazy"></a>`
    : `<a class="att-file" href="${esc(a.url)}" target="_blank" rel="noopener">${icon("file")}<span>${esc(a.name)}</span><small class="muted">${fmtSize(a.size)}</small></a>`).join("")}</div>`;
}

function commCard(c) {
  return `<a class="card comm-card" href="#/c/${esc(c.cid)}">
    <div class="row">${cAvatar(c.name, c.cid)}<div class="grow"><h3 class="ellipsis">${esc(c.name)}</h3><div class="muted xs">${typeLabel(c.type)} · ${plural(c.memberCount || 0, "member")}</div></div></div>
    <p>${esc(c.description || "")}</p>
    <div class="row gap-8">${c.joined ? `<span class="tag verified">${icon("check")} Joined</span>` : `<span class="tag">Open to join</span>`}${sampleTag(c)}</div></a>`;
}

function voteHtml(p) {
  const cls = p.myVote > 0 ? "up" : p.myVote < 0 ? "down" : "";
  return `<div class="vote ${cls}"><button class="v-up" data-v="1" aria-label="Upvote">${icon("arrowUp")}</button><b>${fmtScore(p.score)}</b><button class="v-down" data-v="-1" aria-label="Downvote">${icon("arrowDown")}</button></div>`;
}

function postCardHtml(p, { full = false, showCommunity = true, canDelete = false } = {}) {
  const meta = [
    showCommunity && p.communityName ? `${cAvatar(p.communityName, p.cid, "xs")}<a href="#/c/${esc(p.cid)}">q/${esc(p.communityName)}</a><span class="dot"></span>` : "",
    `<span>by <a href="#/u/${esc(p.author)}">${esc(p.authorName)}</a></span>`,
    p.authorLevel ? `<span class="dot"></span><span>${esc(p.authorLevel)}</span>` : "",
    `<span class="dot"></span><span>${ago(p.createdAt)}</span>`,
    sampleTag(p),
  ].join("");
  const title = p.title ? (full ? `<h1 class="post-title">${esc(p.title)}</h1>` : `<a class="post-title" href="${postLink(p)}">${esc(p.title)}</a>`) : "";
  return `<article class="card post-card ${full ? "" : "clickable"}" data-pid="${esc(p.pid)}">
    ${voteHtml(p)}
    <div class="post-body">
      <div class="post-meta">${meta}</div>
      ${title}
      ${p.text ? `<div class="post-text ${full ? "" : "clamp"}">${rich(p.text)}</div>` : ""}
      ${attsHtml(p.attachments)}
      <div class="post-actions">
        <a class="btn" href="${postLink(p)}" data-ccount>${icon("comment")}<span>${p.commentCount || 0}</span> ${Number(p.commentCount) === 1 ? "comment" : "comments"}</a>
        <button class="btn" data-share>${icon("link")} Share</button>
        ${canDelete ? `<button class="btn" data-del>${icon("trash")} Delete</button>` : ""}
      </div>
    </div></article>`;
}

function bindVote(node, p) {
  const redraw = () => { $(".vote", node).outerHTML = voteHtml(p); bindVote(node, p); };
  $(".vote", node).onclick = async (e) => {
    e.stopPropagation();
    const b = e.target.closest("[data-v]");
    if (!b) return;
    const v = Number(b.dataset.v), next = p.myVote === v ? 0 : v;
    const prev = { score: p.score, myVote: p.myVote };
    p.score = Number(p.score || 0) + next - (p.myVote || 0);  // optimistic
    p.myVote = next;
    redraw();
    try {
      Object.assign(p, await api("POST", `/api/communities/${p.cid}/posts/${p.pid}/vote`, { value: next }));
    } catch (x) {
      Object.assign(p, prev);
      toast(x.message, true);
    }
    redraw();
  };
}

function bindPostCard(node, p, { full = false, onDeleted } = {}) {
  bindVote(node, p);
  $("[data-share]", node).onclick = async (e) => {
    e.stopPropagation();
    const url = `${location.origin}/${postLink(p)}`;
    try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { prompt("Copy this link", url); }
  };
  $("[data-del]", node)?.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!confirm("Delete this post? This can't be undone.")) return;
    try { await api("DELETE", `/api/communities/${p.cid}/posts/${p.pid}`); toast("Post deleted"); onDeleted ? onDeleted() : node.remove(); }
    catch (x) { toast(x.message, true); }
  });
  if (!full) node.addEventListener("click", (e) => { if (!e.target.closest("a, button, img, .vote")) go(postLink(p)); });
}

function renderPostList(el, posts, opts = {}) {
  el.innerHTML = "";
  for (const p of posts) appendPost(el, p, opts);
}
function appendPost(el, p, opts = {}, top = false) {
  const holder = document.createElement("div");
  holder.innerHTML = postCardHtml(p, { ...opts, canDelete: p.author === me.sub || opts.isOwner });
  const node = holder.firstElementChild;
  top ? el.prepend(node) : el.append(node);
  bindPostCard(node, p);
  return node;
}

function composer(el, { placeholder, submitLabel, onSend, chat = false }) {
  el.innerHTML = chat
    ? `<div class="row"><input type="file" multiple hidden><button class="icon-btn" type="button" data-c="attach" title="Attach files">${icon("paperclip")}</button>
       <textarea class="grow" rows="1" placeholder="${esc(placeholder)}"></textarea><button class="btn primary send" data-c="send" aria-label="${esc(submitLabel)}">${icon("send")}</button></div><div class="pending"></div>`
    : `<textarea rows="3" placeholder="${esc(placeholder)}"></textarea><div class="pending"></div>
       <div class="row-between" style="margin-top:8px"><div><input type="file" multiple hidden><button class="btn ghost sm" type="button" data-c="attach">${icon("paperclip")} Attach</button></div>
       <button class="btn primary sm" data-c="send">${esc(submitLabel)}</button></div>`;
  const ta = $("textarea", el), input = $("input[type=file]", el), btn = $("[data-c=send]", el), pend = $(".pending", el);
  const btnHtml = btn.innerHTML;
  let files = [];
  const drawPending = () => {
    pend.innerHTML = files.map((f, i) => `<span class="chip">${icon("file")} ${esc(f.name)} <button class="icon-btn" data-rm="${i}" style="width:20px;height:20px">${icon("x")}</button></span>`).join("");
  };
  pend.onclick = (e) => { const b = e.target.closest("[data-rm]"); if (b) { files.splice(+b.dataset.rm, 1); drawPending(); } };
  $("[data-c=attach]", el).onclick = () => input.click();
  input.onchange = () => {
    for (const f of input.files) {
      if (f.size > MAX_FILE) toast(`${f.name} is over 15 MB`, true);
      else if (files.length < 5) files.push(f);
    }
    input.value = "";
    drawPending();
  };
  const autosize = () => { if (chat) { ta.style.height = "auto"; ta.style.height = Math.min(140, ta.scrollHeight) + "px"; } };
  ta.oninput = autosize;
  const send = async () => {
    const text = ta.value.trim();
    if ((!text && !files.length) || btn.disabled) return;
    btn.disabled = true;
    try {
      const atts = [];
      for (const f of files) { if (!chat) btn.textContent = `Uploading ${atts.length + 1}/${files.length}…`; atts.push(await uploadFile(f)); }
      await onSend(text, atts);
      ta.value = "";
      files = [];
      drawPending();
      autosize();
    } catch (e) { toast(e.message, true); } finally { btn.disabled = false; btn.innerHTML = btnHtml; ta.focus(); }
  };
  btn.onclick = send;
  if (chat) ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
}

function sortSeg(active) {
  return `<div class="seg" role="tablist">${[["hot", "flame", "Hot"], ["new", "clock", "New"], ["top", "chart", "Top"]]
    .map(([k, ic, l]) => `<button data-sort="${k}" class="${active === k ? "on" : ""}">${icon(ic)}${l}</button>`).join("")}</div>`;
}
const getPref = (k, d) => { try { return localStorage.getItem(`quad.${k}`) || d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(`quad.${k}`, v); } catch { /* ignore */ } };

// ---------------- views: feeds ----------------
async function viewFeed(ctx, scope) {
  const { view, stale } = ctx;
  let sort = getPref("sort", "hot");
  const [{ communities }, stats] = await Promise.all([api("GET", "/api/communities"), api("GET", "/api/public/stats").catch(() => ({}))]);
  if (stale()) return;
  const suggested = communities.filter((c) => !c.joined).sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0)).slice(0, 5);
  view.innerHTML = `<div class="page">
    <div class="page-main">
      <div class="page-head"><div><h1>${scope === "mine" ? `Hi ${esc(me.name.split(" ")[0])} 👋` : "Popular on Quad"}</h1>
        <p>${scope === "mine" ? "Posts from your communities" : "The best posts from every community"}</p></div>${sortSeg(sort)}</div>
      <div class="card compose-prompt">${avatar(me.name, me.sub)}<input readonly placeholder="Share notes, ask a doubt, find a teammate…" data-action="create-post"><button class="icon-btn" data-action="create-post" aria-label="Attach">${icon("paperclip")}</button></div>
      <div id="feed"></div>
    </div>
    <aside class="rail">
      ${!me.level && !me.demo ? `<div class="card"><h4>Finish your profile</h4><p class="muted small">Add your level, city and skills so classmates and teammates can find you.</p><a class="btn primary sm" href="#/me">Edit profile</a></div>` : ""}
      ${suggested.length ? `<div class="card"><h4>Communities to join</h4><div class="mini-list">${suggested.map((c) => `
        <div class="mini-item">${cAvatar(c.name, c.cid, "sm")}<a class="grow" href="#/c/${esc(c.cid)}" style="color:inherit"><div class="ellipsis" style="font-weight:600">${esc(c.name)}</div><div class="muted xs">${plural(c.memberCount || 0, "member")}</div></a>
        <button class="btn outline sm" data-join="${esc(c.cid)}">Join</button></div>`).join("")}</div>
        <a class="btn ghost sm block" style="margin-top:12px" href="#/explore">See all communities</a></div>` : ""}
      <div class="card"><h4>About Quad</h4><p class="muted small">A community for verified IIT Madras BS students: courses, exam prep, hackathons, fests and city meetups.</p>
        <div class="about-stats"><div><b>${stats.users ?? "–"}</b><span>students</span></div><div><b>${stats.posts ?? "–"}</b><span>posts</span></div><div><b>${stats.catchups ?? "–"}</b><span>AI catch-ups</span></div></div>
        <p class="muted xs">Unofficial student project. Not affiliated with IIT Madras.</p></div>
    </aside></div>`;
  const feed = $("#feed");
  const load = async () => {
    feed.innerHTML = `<div class="skeleton"></div><div class="skeleton"></div>`;
    const { posts } = await api("GET", `/api/feed?scope=${scope}&sort=${sort}`);
    if (stale()) return;
    if (!posts.length) {
      feed.innerHTML = scope === "mine"
        ? emptyState("compass", `Your home feed is empty.<br><a href="#/explore">Join a few communities</a> or browse <a href="#/all">Popular</a>.`)
        : emptyState("message", "No posts yet. Be the first to post!");
      return;
    }
    renderPostList(feed, posts);
  };
  $(".seg", view).onclick = (e) => {
    const b = e.target.closest("[data-sort]");
    if (!b || b.dataset.sort === sort) return;
    sort = b.dataset.sort;
    setPref("sort", sort);
    $$(".seg button", view).forEach((x) => x.classList.toggle("on", x === b));
    load();
  };
  $$("[data-join]", view).forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { await api("POST", `/api/communities/${b.dataset.join}/join`); b.textContent = "Joined"; b.classList.replace("outline", "ghost"); await refreshSidebar(); }
    catch (x) { toast(x.message, true); b.disabled = false; }
  }));
  await load();
}

async function viewExplore({ view, stale }) {
  const { communities } = await api("GET", "/api/communities");
  if (stale()) return;
  let filter = "all", q = "";
  const filters = [["all", "All"], ...Object.entries(TYPE_META).map(([k, v]) => [k, v.label])];
  view.innerHTML = `<div class="page"><div class="page-main wide">
    <div class="page-head"><div><h1>Explore communities</h1><p>Every community on Quad. Any verified student can join.</p></div>
      <button class="btn primary" data-action="create-community">${icon("plus")} New community</button></div>
    <div class="row wrap" style="margin-bottom:16px"><input type="search" id="ex-q" placeholder="Filter communities…" style="max-width:320px">
      <div class="chips" id="ex-f">${filters.map(([k, l]) => `<button class="chip ${k === "all" ? "on" : ""}" data-f="${k}">${esc(l)}</button>`).join("")}</div></div>
    <div id="ex-list"></div></div></div>`;
  const draw = () => {
    const list = communities.filter((c) => (filter === "all" || c.type === filter) && (!q || `${c.name} ${c.description || ""}`.toLowerCase().includes(q)));
    $("#ex-list").innerHTML = list.length ? `<div class="comm-grid">${list.map(commCard).join("")}</div>` : emptyState("compass", "Nothing matches yet. Why not start it?");
  };
  draw();
  $("#ex-q").oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  $("#ex-f").onclick = (e) => {
    const b = e.target.closest("[data-f]");
    if (!b) return;
    filter = b.dataset.f;
    $$("#ex-f .chip").forEach((x) => x.classList.toggle("on", x === b));
    draw();
  };
}

// ---------------- views: community ----------------
function aboutCard(c) {
  return `<div class="card"><h4>About this community</h4>
    ${c.description ? `<p class="small about-desc" style="white-space:pre-wrap" title="${esc(c.description)}">${rich(c.description)}</p>` : ""}
    <div class="about-stats"><div><b>${c.memberCount || 0}</b><span>members</span></div><div><b>${typeLabel(c.type)}</b><span>type</span></div></div>
    <p class="muted xs">Started by ${esc(c.createdByName || "someone")}${c.createdAt ? ` · ${new Date(c.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : ""}</p>
    ${c.joined
      ? `<div class="ai-actions"><button class="btn ai block" data-act="catchup">${icon("sparkles")} Catch me up</button>
         <button class="btn ai block" data-act="teammates">${icon("userPlus")} ${c.type === "hackathon" ? "Find teammates" : "Find study partners"}</button></div>`
      : `<button class="btn primary block" data-act="join" style="margin-top:12px">Join community</button>`}
  </div>`;
}

async function viewCommunity(ctx, cid, tab) {
  const { view, stale } = ctx;
  const c = await api("GET", `/api/communities/${cid}`);
  if (stale()) return;
  const wide = wideMQ.matches;
  if (wide && (tab === "chat" || tab === "about")) tab = "posts";
  const tabs = [["posts", "message", "Posts"], ...(wide ? [] : [["chat", "comment", "Group chat"]]), ["members", "users", "Members"], ...(wide ? [] : [["about", "sparkles", "About & AI"]])];
  view.innerHTML = `<div class="page">
    <div class="page-main">
      <div class="card c-banner" style="${banner(cid)}"></div>
      <div class="card c-head ${tab === "chat" ? "compact-head" : ""}">
        <div class="c-head-row">${cAvatar(c.name, cid, "lg")}
          <div><h1>${esc(c.name)}</h1><div class="muted small">${typeLabel(c.type)} · ${plural(c.memberCount || 0, "member")} ${sampleTag(c)}</div></div>
          <div class="actions">${c.joined
            ? `<button class="btn primary sm" data-action="create-post" data-cid="${esc(cid)}">${icon("plus")} Post</button>${c.role !== "owner" ? `<button class="btn outline sm" data-act="leave">Joined</button>` : `<span class="tag owner">You own this</span>`}`
            : `<button class="btn primary" data-act="join">Join</button>`}</div>
        </div>
        ${!wide && c.description ? `<p class="c-desc">${rich(c.description)}</p>` : ""}
      </div>
      <nav class="tabs">${tabs.map(([k, ic, l]) => `<a href="#/c/${esc(cid)}${k === "posts" ? "" : "/" + k}" class="${tab === k ? "active" : ""}">${icon(ic)}${l}</a>`).join("")}</nav>
      <div id="tab"></div>
    </div>
    ${wide ? `<aside class="rail fill">${aboutCard(c)}<div id="rail-chat"></div></aside>` : ""}
  </div>`;
  const join = async (e) => {
    e.target.disabled = true;
    try { await api("POST", `/api/communities/${cid}/join`); await refreshSidebar(); toast(`Joined ${c.name} 🎉`); route(); }
    catch (x) { toast(x.message, true); e.target.disabled = false; }
  };
  $$("[data-act=join]", view).forEach((b) => (b.onclick = join));
  $("[data-act=leave]", view)?.addEventListener("click", async () => {
    if (!confirm(`Leave ${c.name}?`)) return;
    await api("POST", `/api/communities/${cid}/leave`);
    await refreshSidebar();
    route();
  });
  const bindAI = (root) => {
    $$("[data-act=catchup]", root).forEach((b) => (b.onclick = () => catchUpModal(c)));
    $$("[data-act=teammates]", root).forEach((b) => (b.onclick = () => teammatesModal(c)));
    $$("[data-act=join]", root).forEach((b) => (b.onclick = join));
  };
  bindAI(view);
  if (c.joined) watch([`comm:${cid}`, `conv:c_${cid}`]);
  if (wide) {
    const rail = $("#rail-chat");
    if (c.joined) chatPanel(rail, `c_${cid}`, ctx, { title: "Live chat", sub: plural(c.memberCount || 0, "member") });
    else rail.innerHTML = `<div class="card"><h4>Live chat</h4><p class="muted small">Join to chat with ${plural(c.memberCount || 0, "member")} in real time.</p></div>`;
  }
  const tabEl = $("#tab");
  if (tab === "members") return membersTab(tabEl, c);
  if (tab === "about") { tabEl.innerHTML = aboutCard(c); bindAI(tabEl); return; }
  if (tab === "chat") {
    if (!c.joined) { tabEl.innerHTML = emptyState("comment", "Join this community to read and send messages."); return; }
    return chatPanel(tabEl, `c_${cid}`, ctx, { title: "Live chat", sub: plural(c.memberCount || 0, "member") });
  }
  return communityPosts(tabEl, c, ctx);
}

async function communityPosts(el, c, { stale }) {
  let sort = getPref("csort", "hot");
  el.innerHTML = `<div class="feed-bar"><span class="muted small">${c.joined ? "" : "Join to post and vote."}</span>${sortSeg(sort)}</div><div id="feed"></div>`;
  const feed = $("#feed", el);
  const opts = { showCommunity: false, isOwner: c.role === "owner" };
  const load = async () => {
    feed.innerHTML = `<div class="skeleton"></div>`;
    const { posts } = await api("GET", `/api/communities/${c.cid}/posts?sort=${sort}`);
    if (stale()) return;
    if (!posts.length) {
      feed.innerHTML = emptyState("message", `No posts yet.${c.joined ? ` <a href="#" data-action="create-post" data-cid="${esc(c.cid)}">Write the first one</a>.` : ""}`);
      return;
    }
    renderPostList(feed, posts, opts);
  };
  $(".seg", el).onclick = (e) => {
    const b = e.target.closest("[data-sort]");
    if (!b || b.dataset.sort === sort) return;
    sort = b.dataset.sort;
    setPref("csort", sort);
    $$(".seg button", el).forEach((x) => x.classList.toggle("on", x === b));
    load();
  };
  await load();
  current.handlers.push((ev) => {
    if (ev.type === "post" && ev.post.cid === c.cid && !$(`[data-pid="${CSS.escape(ev.post.pid)}"]`, feed)) {
      $(".empty", feed)?.remove();
      appendPost(feed, { ...ev.post, myVote: ev.post.author === me.sub ? 1 : 0 }, opts, true);
    }
    if (ev.type === "comment") {
      const n = $(`[data-pid="${CSS.escape(ev.pid)}"] [data-ccount] span`, feed);
      if (n) n.textContent = Number(n.textContent) + 1;
    }
  });
}

function membersTab(el, c) {
  el.innerHTML = `<div class="card list">${c.members.map((m) => `<div class="list-item">${avatar(m.name, m.sub)}
    <div class="grow"><div class="row gap-8"><a class="title" href="#/u/${esc(m.sub)}" style="color:inherit">${esc(m.name)}</a>${m.role === "owner" ? `<span class="tag owner">Owner</span>` : ""}${sampleTag(m)}</div>
      <div class="sub">${profileLine(m) || "IITM BS student"}</div>
      ${m.skills?.length ? `<div class="chips" style="margin-top:6px">${m.skills.slice(0, 6).map((s) => `<span class="skill">${esc(s)}</span>`).join("")}</div>` : ""}</div>
    ${m.sub !== me.sub ? `<a class="btn outline sm" href="#/dm/${esc(m.sub)}">${icon("message")} Message</a>` : ""}</div>`).join("")}</div>`;
}

// ---------------- views: post page with threaded comments ----------------
async function viewPost(ctx, cid, pid) {
  const { view, stale } = ctx;
  const [p, { comments }, c] = await Promise.all([
    api("GET", `/api/communities/${cid}/posts/${pid}`),
    api("GET", `/api/communities/${cid}/posts/${pid}/comments`),
    api("GET", `/api/communities/${cid}`),
  ]);
  if (stale()) return;
  view.innerHTML = `<div class="page">
    <div class="page-main">
      <a class="btn ghost sm" href="#/c/${esc(cid)}" style="margin-bottom:10px">${icon("back")} q/${esc(c.name)}</a>
      <div id="post"></div>
      <div class="card">
        <div class="comment-box"><form class="comment-form"><textarea placeholder="What are your thoughts?" maxlength="2000"></textarea>
          <div class="row"><button class="btn primary sm" type="submit">Comment</button></div></form></div>
        <div class="thread" id="thread"></div>
      </div>
    </div>
    <aside class="rail">${aboutCard(c)}</aside></div>`;
  const postEl = $("#post");
  postEl.innerHTML = postCardHtml(p, { full: true, canDelete: p.author === me.sub || c.role === "owner" });
  bindPostCard(postEl.firstElementChild, p, { full: true, onDeleted: () => go(`#/c/${cid}`) });
  $$("[data-act=catchup]", view).forEach((b) => (b.onclick = () => catchUpModal(c)));
  $$("[data-act=teammates]", view).forEach((b) => (b.onclick = () => teammatesModal(c)));
  $$("[data-act=join]", view).forEach((b) => (b.onclick = async () => { await api("POST", `/api/communities/${cid}/join`); await refreshSidebar(); route(); }));

  const list = comments;
  const thread = $("#thread");
  const bump = (n) => { const s = $("[data-ccount] span", postEl); s.textContent = Number(s.textContent) + n; };
  const draw = () => {
    const kids = {};
    for (const cm of list) (kids[cm.parent || ""] ||= []).push(cm);
    const ids = new Set(list.map((x) => x.cmid));
    const roots = list.filter((cm) => !cm.parent || !ids.has(cm.parent));
    const one = (cm, depth) => `<div class="cmt" data-cmid="${esc(cm.cmid)}">${avatar(cm.authorName, cm.author, "sm")}
      <div class="cmt-body">
        <div class="cmt-head"><a href="#/u/${esc(cm.author)}"><b>${esc(cm.authorName)}</b></a>${cm.author === p.author ? `<span class="tag owner">OP</span>` : ""}${sampleTag(cm)}<span>· ${ago(cm.createdAt)}</span></div>
        <div class="cmt-text ${cm.deleted ? "deleted" : ""}">${cm.deleted ? "[deleted]" : rich(cm.text)}</div>
        <div class="cmt-actions">${!cm.deleted ? `<button data-reply="${esc(cm.cmid)}">${icon("reply")} Reply</button>` : ""}
          ${cm.author === me.sub && !cm.deleted ? `<button data-cdel="${esc(cm.cmid)}">${icon("trash")} Delete</button>` : ""}</div>
        <div class="reply-slot"></div>
        ${(kids[cm.cmid] || []).length ? `<div class="replies">${kids[cm.cmid].map((k) => one(k, depth + 1)).join("")}</div>` : ""}
      </div></div>`;
    thread.innerHTML = roots.length ? roots.map((cm) => one(cm, 0)).join("") : `<p class="muted small" style="padding:16px 0 4px">No comments yet. Start the conversation.</p>`;
  };
  draw();
  const post = async (text, parent) => {
    const cm = await api("POST", `/api/communities/${cid}/posts/${pid}/comments`, { text, parent });
    if (!list.some((x) => x.cmid === cm.cmid)) { list.push(cm); bump(1); }
    draw();
  };
  const mainForm = $(".comment-form", view);
  mainForm.onsubmit = async (e) => {
    e.preventDefault();
    const ta = $("textarea", mainForm), btn = $("button", mainForm), text = ta.value.trim();
    if (!text) return;
    btn.disabled = true;
    try { await post(text, ""); ta.value = ""; } catch (x) { toast(x.message, true); } finally { btn.disabled = false; }
  };
  thread.onclick = async (e) => {
    const r = e.target.closest("[data-reply]"), d = e.target.closest("[data-cdel]");
    if (r) {
      const slot = $(".reply-slot", r.closest(".cmt"));
      if (slot.innerHTML) { slot.innerHTML = ""; return; }
      slot.innerHTML = `<form class="reply-form"><textarea placeholder="Write a reply…" maxlength="2000"></textarea>
        <div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn ghost sm" type="button" data-cancel>Cancel</button><button class="btn primary sm" type="submit">Reply</button></div></form>`;
      const f = $("form", slot);
      $("textarea", f).focus();
      $("[data-cancel]", f).onclick = () => { slot.innerHTML = ""; };
      f.onsubmit = async (ev) => {
        ev.preventDefault();
        const text = $("textarea", f).value.trim();
        if (!text) return;
        $("[type=submit]", f).disabled = true;
        try { await post(text, r.dataset.reply); } catch (x) { toast(x.message, true); $("[type=submit]", f).disabled = false; }
      };
    }
    if (d && confirm("Delete this comment?")) {
      try {
        await api("DELETE", `/api/communities/${cid}/posts/${pid}/comments/${d.dataset.cdel}`);
        const cm = list.find((x) => x.cmid === d.dataset.cdel);
        if (cm) { cm.deleted = true; cm.text = ""; }
        draw();
      } catch (x) { toast(x.message, true); }
    }
  };
  if (c.joined) watch([`comm:${cid}`]);
  current.handlers.push((ev) => {
    if (ev.type === "comment" && ev.pid === pid && !list.some((x) => x.cmid === ev.comment.cmid)) {
      list.push(ev.comment);
      bump(1);
      draw();
    }
  });
}

// ---------------- chat (community live chat + DMs) ----------------
async function chatPanel(el, conv, { stale }, { title = "", sub = "", head = "" } = {}) {
  current.conv = conv;
  el.innerHTML = `<div class="chat">${head || `<div class="chat-head"><span class="live"></span><div class="grow"><b>${esc(title)}</b>${sub ? `<div class="muted xs">${esc(sub)}</div>` : ""}</div></div>`}
    <div class="chat-log"><div class="loading">Loading messages…</div></div><div class="chat-form"></div></div>`;
  const log = $(".chat-log", el);
  const seen = new Set();
  let last = null;
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 120;
  const add = (m) => {
    if (seen.has(m.mid)) return;
    seen.add(m.mid);
    $("[data-empty]", log)?.remove();
    if (!last || new Date(last.createdAt).toDateString() !== new Date(m.createdAt).toDateString()) {
      log.insertAdjacentHTML("beforeend", `<div class="day-sep">${dayLabel(m.createdAt)}</div>`);
      last = null;
    }
    const mine = m.sender === me.sub;
    const cont = last && last.sender === m.sender && m.createdAt - last.createdAt < 5 * 60_000;
    log.insertAdjacentHTML("beforeend", `<div class="msg ${mine ? "mine" : ""} ${cont ? "cont" : ""}" data-mid="${esc(m.mid)}">
      ${mine ? `<button class="icon-btn del" data-mdel="${esc(m.mid)}" title="Delete message">${icon("trash")}</button>` : `<a class="msg-av" href="#/u/${esc(m.sender)}">${avatar(m.senderName, m.sender, "sm")}</a>`}
      <div>${cont ? "" : `<div class="meta">${mine ? "" : `${esc(m.senderName)} ${sampleTag(m)} · `}${clock(m.createdAt)}</div>`}
      ${m.text ? `<div class="bubble">${rich(m.text)}</div>` : ""}${attsHtml(m.attachments)}</div></div>`);
    last = m;
  };
  const toBottom = () => { log.scrollTop = log.scrollHeight; };
  log.addEventListener("load", (e) => { if (e.target.tagName === "IMG" && nearBottom()) toBottom(); }, true);
  log.onclick = async (e) => {
    const b = e.target.closest("[data-mdel]");
    if (!b || !confirm("Delete this message?")) return;
    try { await api("DELETE", `/api/conversations/${conv}/messages/${b.dataset.mdel}`); $(`[data-mid="${CSS.escape(b.dataset.mdel)}"]`, log)?.remove(); }
    catch (x) { toast(x.message, true); }
  };
  const load = async () => {
    const { messages } = await api("GET", `/api/conversations/${conv}/messages`);
    if (stale()) return;
    const first = !seen.size;
    if (first) log.innerHTML = messages.length ? "" : `<div class="empty" data-empty style="border:0">${icon("comment")}<div>No messages yet. Say hi 👋</div></div>`;
    const stick = first || nearBottom();
    messages.forEach(add);
    if (stick) toBottom();
  };
  await load();
  if (stale()) return;
  composer($(".chat-form", el), {
    placeholder: "Message…", submitLabel: "Send", chat: true,
    onSend: async (text, attachments) => { add(await api("POST", `/api/conversations/${conv}/messages`, { text, attachments })); toBottom(); },
  });
  current.handlers.push((ev) => {
    if (ev.type === "message" && ev.message.conv === conv) { const stick = nearBottom(); add(ev.message); if (stick) toBottom(); }
    if (ev.type === "message_deleted" && ev.conv === conv) $(`[data-mid="${CSS.escape(ev.mid)}"]`, log)?.remove();
  });
  current.reconnect.push(load);
}

async function viewMessages(ctx, sub) {
  const { view, stale } = ctx;
  if (sub === me.sub) return go("#/me");
  const [{ dms }, other] = await Promise.all([api("GET", "/api/dms"), sub ? api("GET", `/api/users/${sub}`) : null]);
  if (stale()) return;
  const item = (d) => `<a class="dm-item ${d.other === sub ? "active" : ""}" href="#/dm/${esc(d.other)}">${avatar(d.otherName, d.other)}
    <div class="grow"><div class="row-between"><span class="title ellipsis">${esc(d.otherName)}</span><span class="muted xs">${ago(d.lastAt)}</span></div>
    <div class="sub ellipsis">${esc(d.lastText || "")}</div></div>${Number(d.unread) && d.other !== sub ? `<i class="badge">${d.unread}</i>` : ""}</a>`;
  view.innerHTML = `<div class="dm-layout ${sub ? "has-conv" : ""}">
    <div class="card dm-list"><div class="dm-list-head"><b>Messages</b><button class="btn primary sm" data-act="new">${icon("plus")} New</button></div>
      <div class="dm-list-items">${dms.length ? dms.map(item).join("") : `<p class="muted small" style="padding:16px">No conversations yet. Message someone from a community's member list, or start one here.</p>`}</div></div>
    <div class="dm-pane" id="dm-pane">${sub ? "" : `<div class="card dm-empty"><div>${icon("message")}<p>Pick a conversation, or start a new one.</p></div></div>`}</div></div>`;
  $("[data-act=new]", view).onclick = newDmModal;
  if (sub) {
    const conv = dmConv(me.sub, sub);
    watch([`conv:${conv}`]);
    await chatPanel($("#dm-pane"), conv, ctx, {
      head: `<div class="chat-head"><a href="#/messages" class="icon-btn only-mobile" aria-label="Back">${icon("back")}</a>
        <a href="#/u/${esc(sub)}">${avatar(other.user.name, sub)}</a><div class="grow"><a href="#/u/${esc(sub)}" style="color:inherit"><b>${esc(other.user.name)}</b></a> ${sampleTag(other.user)}
        <div class="muted xs">${profileLine(other.user) || "IITM BS student"}</div></div></div>`,
    });
    refreshBadges();
  }
  current.handlers.push((ev) => { if (ev.type === "dm" && ev.from !== sub) route(); });
}

function newDmModal() {
  const body = openModal(`${modalHead("New message")}
    <input type="search" placeholder="Search by name, level, city or skill…"><div class="card list" style="margin-top:10px;max-height:50vh;overflow-y:auto" id="dm-results"><div class="loading">Loading…</div></div>`);
  const input = $("input", body), out = $("#dm-results", body);
  let timer;
  const search = async () => {
    try {
      const { users } = await api("GET", `/api/users?q=${encodeURIComponent(input.value.trim())}`);
      const list = users.filter((u) => u.sub !== me.sub && !u.demo);
      out.innerHTML = list.length ? list.slice(0, 30).map((u) => `<a class="list-item" href="#/dm/${esc(u.sub)}">${avatar(u.name, u.sub)}
        <div class="grow"><div class="title">${esc(u.name)} ${sampleTag(u)}</div><div class="sub">${profileLine(u) || "IITM BS student"}</div></div></a>`).join("") : `<div class="loading">No students found.</div>`;
    } catch (e) { out.innerHTML = `<p class="error" style="padding:12px">${esc(e.message)}</p>`; }
  };
  input.oninput = () => { clearTimeout(timer); timer = setTimeout(search, 250); };
  search();
  input.focus();
}

// ---------------- views: people ----------------
function profileHeader(u, { email = "", self = false } = {}) {
  return `<div class="card profile-banner" style="${banner(u.sub)}"></div>
    <div class="card profile-card">
      <div class="profile-top">${avatar(u.name, u.sub, "lg")}
        <div class="grow"><h1>${esc(u.name)}</h1>
          <div class="row gap-8 wrap" style="margin-top:4px">${u.demo ? `<span class="tag sample">Demo account</span>` : u.sample ? sampleTag(u) : `<span class="tag verified">${icon("check")} Verified IITM BS student</span>`}${email ? `<span class="muted small">${esc(email)}</span>` : ""}</div></div>
        ${self ? "" : `<a class="btn primary" href="#/dm/${esc(u.sub)}">${icon("message")} Message</a>`}</div>
      <div class="facts">${u.level ? `<span>${icon("grad")}${esc(u.level)}</span>` : ""}${u.batch ? `<span>${icon("calendar")}Batch ${esc(u.batch)}</span>` : ""}${u.city ? `<span>${icon("pin")}${esc(u.city)}</span>` : ""}</div>
      ${u.bio ? `<p style="margin:12px 0 0;white-space:pre-wrap">${rich(u.bio)}</p>` : ""}
      ${u.skills?.length ? `<div class="chips" style="margin-top:12px">${u.skills.map((s) => `<span class="skill">${esc(s)}</span>`).join("")}</div>` : ""}
    </div>`;
}

async function viewUser({ view, stale }, sub) {
  if (sub === me.sub) return go("#/me");
  const { user, communities } = await api("GET", `/api/users/${sub}`);
  if (stale()) return;
  view.innerHTML = `<div class="page"><div class="page-main">${profileHeader(user)}
    <h3 style="margin:24px 0 12px">Communities</h3>
    ${communities.length ? `<div class="chips">${communities.map((c) => `<a class="chip" href="#/c/${esc(c.cid)}">${cAvatar(c.name, c.cid, "xs")} ${esc(c.name)}</a>`).join("")}</div>` : `<p class="muted">Not in any communities yet.</p>`}
  </div></div>`;
}

async function viewMe({ view, stale }) {
  me = await api("GET", "/api/me");
  if (stale()) return;
  view.innerHTML = `<div class="page"><div class="page-main">${profileHeader(me, { email: me.email, self: true })}
    <div class="card card-pad" style="margin-top:16px"><h3>Edit profile</h3>
      ${me.demo ? `<p class="hint">The shared demo profile is read-only. Join with your student account to make your own.</p>` : `<p class="muted small">Your batch comes from your roll number, so it can't be edited.</p>`}
      <form class="form-grid">
        <div><label>Name</label><input name="name" required maxlength="60" value="${esc(me.name)}"></div>
        <div><label>Level</label><select name="level"><option value="">Choose…</option>${LEVELS.map((l) => `<option ${me.level === l ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div><label>City</label><input name="city" maxlength="40" value="${esc(me.city)}" placeholder="e.g. Chennai, Patna, Pune"></div>
        <div><label>Skills <span class="muted">(comma separated)</span></label><input name="skills" value="${esc((me.skills || []).join(", "))}" placeholder="Python, SQL, Flask, ML"></div>
        <div style="grid-column:1/-1"><label>Bio</label><textarea name="bio" maxlength="300" rows="3" placeholder="What are you studying, building or looking for?">${esc(me.bio)}</textarea></div>
        <div style="grid-column:1/-1;margin-top:16px" class="row"><button class="btn primary" type="submit">Save profile</button><span class="error"></span></div>
      </form></div></div></div>`;
  const form = $("form", view);
  if (me.demo) $$("input, select, textarea, button", form).forEach((x) => (x.disabled = true));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    f.skills = f.skills.split(",").map((s) => s.trim()).filter(Boolean);
    const btn = $("[type=submit]", form);
    btn.disabled = true;
    try {
      me = await api("PUT", "/api/me", f);
      $("#me-avatar").innerHTML = avatar(me.name, me.sub, "sm");
      toast("Profile saved ✓");
      route();
    } catch (x) { $(".error", form).textContent = x.message; btn.disabled = false; }
  };
}

async function viewSearch({ view, stale }, q) {
  $("#search-input").value = q;
  const r = await api("GET", `/api/search?q=${encodeURIComponent(q)}`);
  if (stale()) return;
  let tab = r.posts.length ? "posts" : r.communities.length ? "communities" : "people";
  view.innerHTML = `<div class="page"><div class="page-main">
    <div class="page-head"><div><h1>Results for “${esc(q)}”</h1></div></div>
    <nav class="tabs">${[["posts", r.posts.length, "Posts"], ["communities", r.communities.length, "Communities"], ["people", r.people.length, "People"]]
      .map(([k, n, l]) => `<a href="#" data-tab="${k}">${l} <span class="tag">${n}</span></a>`).join("")}</nav><div id="results"></div></div></div>`;
  const draw = () => {
    $$("[data-tab]", view).forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
    const out = $("#results");
    if (tab === "posts") { if (r.posts.length) renderPostList(out, r.posts); else out.innerHTML = emptyState("search", "No posts match."); }
    if (tab === "communities") out.innerHTML = r.communities.length ? `<div class="comm-grid">${r.communities.map(commCard).join("")}</div>` : emptyState("search", "No communities match.");
    if (tab === "people") out.innerHTML = r.people.length ? `<div class="card list">${r.people.map((u) => `<a class="list-item" href="#/u/${esc(u.sub)}">${avatar(u.name, u.sub)}
      <div class="grow"><div class="title">${esc(u.name)} ${sampleTag(u)}</div><div class="sub">${profileLine(u) || "IITM BS student"}</div></div></a>`).join("")}</div>` : emptyState("search", "No people match.");
  };
  $(".tabs", view).onclick = (e) => { const a = e.target.closest("[data-tab]"); if (a) { e.preventDefault(); tab = a.dataset.tab; draw(); } };
  draw();
}

// ---------------- modals ----------------
async function createPostModal(defaultCid) {
  const { communities } = await api("GET", "/api/my/communities");
  if (!communities.length) {
    openModal(`${modalHead("Create a post")}<p class="muted">Join a community first, then you can post in it.</p>
      <div class="modal-actions"><a class="btn primary" href="#/explore" data-action="close-modal">Explore communities</a></div>`);
    return;
  }
  const cid = defaultCid || (location.hash.match(/^#\/c\/([^/]+)/) || [])[1];
  const body = openModal(`${modalHead("Create a post")}
    <form><label>Community</label><select name="cid">${communities.map((c) => `<option value="${esc(c.cid)}" ${c.cid === cid ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
      <label>Title</label><input name="title" required maxlength="200" placeholder="e.g. Week 5 GA doubt: why is Q7 0.86?">
      <label>Details <span class="muted">(optional)</span></label><textarea name="text" rows="5" maxlength="6000" placeholder="Add context, links or notes…"></textarea>
      <div class="dropzone"><input type="file" multiple hidden><button class="btn outline sm" type="button" data-attach>${icon("paperclip")} Attach files</button><span class="muted xs">PDFs, images, up to 15 MB each</span></div>
      <div class="pending"></div><p class="error"></p>
      <div class="modal-actions"><button type="button" class="btn ghost" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Post</button></div></form>`);
  const form = $("form", body), input = $("input[type=file]", form), pend = $(".pending", form);
  let files = [];
  const drawPending = () => { pend.innerHTML = files.map((f, i) => `<span class="chip">${icon("file")} ${esc(f.name)} <button class="icon-btn" type="button" data-rm="${i}" style="width:20px;height:20px">${icon("x")}</button></span>`).join(""); };
  pend.onclick = (e) => { const b = e.target.closest("[data-rm]"); if (b) { files.splice(+b.dataset.rm, 1); drawPending(); } };
  $("[data-attach]", form).onclick = () => input.click();
  input.onchange = () => { for (const f of input.files) { if (f.size > MAX_FILE) toast(`${f.name} is over 15 MB`, true); else if (files.length < 5) files.push(f); } input.value = ""; drawPending(); };
  $("[name=title]", form).focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("[type=submit]", form), f = Object.fromEntries(new FormData(form));
    btn.disabled = true;
    try {
      const attachments = [];
      for (const file of files) { btn.textContent = `Uploading ${attachments.length + 1}/${files.length}…`; attachments.push(await uploadFile(file)); }
      btn.textContent = "Posting…";
      const p = await api("POST", `/api/communities/${f.cid}/posts`, { title: f.title, text: f.text, attachments });
      closeModal();
      toast("Posted ✓");
      go(postLink(p));
    } catch (x) { $(".error", form).textContent = x.message; btn.disabled = false; btn.textContent = "Post"; }
  };
}

function createCommunityModal() {
  const body = openModal(`${modalHead("Create a community")}
    <form><label>Name</label><input name="name" maxlength="80" required placeholder="e.g. MLT, Sep 2026 term study circle">
    <label>Type</label><select name="type">${Object.entries(TYPE_META).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("")}</select>
    <label>Description</label><textarea name="description" maxlength="500" rows="3" placeholder="Who is it for? What happens here?"></textarea>
    <p class="error"></p><div class="modal-actions"><button type="button" class="btn ghost" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Create community</button></div></form>`);
  const form = $("form", body);
  $("[name=name]", form).focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("[type=submit]", form);
    btn.disabled = true;
    try {
      const c = await api("POST", "/api/communities", Object.fromEntries(new FormData(form)));
      closeModal();
      await refreshSidebar();
      go(`#/c/${c.cid}`);
    } catch (x) { $(".error", form).textContent = x.message; btn.disabled = false; }
  };
}

// ✨ Catch me up (Amazon Bedrock)
function catchUpModal(c) {
  const windows = [["last_visit", "Since my last visit"], ["24h", "24 hours"], ["7d", "7 days"], ["30d", "30 days"]];
  const body = openModal(`${modalHead(`<span class="ai-head">${icon("sparkles")} Catch me up</span>`)}
    <p class="muted small">AI reads the posts, comments and live chat in <b>${esc(c.name)}</b> and tells you what matters.</p>
    <div class="chips cmu-windows">${windows.map(([k, l]) => `<button class="chip" data-w="${k}">${l}</button>`).join("")}</div><div id="cmu-out"></div>`);
  const out = $("#cmu-out", body);
  const list = (items, fn) => `<ul>${items.map(fn).join("")}</ul>`;
  const run = async (w, note = "") => {
    $$("[data-w]", body).forEach((b) => b.classList.toggle("on", b.dataset.w === w));
    out.innerHTML = `<p class="muted small">Reading posts and messages…</p><div class="shimmer"></div><div class="shimmer" style="width:85%"></div><div class="shimmer" style="width:65%"></div>`;
    try {
      const r = await api("POST", `/api/communities/${c.cid}/catchup`, { window: w });
      if (r.empty) {
        if (w === "last_visit") return run("7d", "Nothing new since your last visit, so here's the last 7 days.");
        out.innerHTML = emptyState("check", "You're all caught up. Nothing was posted in this period.");
        return;
      }
      const s = r.summary, n = r.counts;
      out.innerHTML = `<div class="cmu">${note ? `<p class="hint">${esc(note)}</p>` : ""}
        <div class="cmu-counts">Read ${plural(n.posts, "post")}, ${plural(n.messages, "chat message")} and ${plural(n.files, "file")} since ${new Date(r.since).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</div>
        <div class="cmu-tldr">${esc(s.tldr)}</div>
        ${s.highlights.length ? `<h3>Highlights</h3>${list(s.highlights, (h) => `<li><b>${esc(h.title)}</b>: ${esc(h.detail)}${h.who ? ` <span class="muted small">(${esc(h.who)})</span>` : ""}</li>`)}` : ""}
        ${s.deadlines.length ? `<h3>Deadlines & dates</h3>${list(s.deadlines, (d) => `<li><b>${esc(d.when)}</b>: ${esc(d.what)}</li>`)}` : ""}
        ${s.openQuestions.length ? `<h3>Unanswered questions (help out!)</h3>${list(s.openQuestions, (q) => `<li>${esc(q.question)} <span class="muted small">asked by ${esc(q.askedBy)}</span></li>`)}` : ""}
        ${s.files.length ? `<h3>Files worth opening</h3>${list(s.files, (f) => `<li><b>${esc(f.name)}</b> from ${esc(f.sharedBy)}: ${esc(f.why)}</li>`)}` : ""}
        ${s.mood ? `<p class="mood">Group vibe: ${esc(s.mood)}</p>` : ""}
        <p class="ai-note">Written by Amazon Bedrock (${esc(r.model)}). AI can make mistakes, so check the original posts for anything important.</p></div>`;
    } catch (e) { out.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  };
  $(".cmu-windows", body).onclick = (e) => { const b = e.target.closest("[data-w]"); if (b) run(b.dataset.w); };
  run("last_visit");
}

// ✨ Find teammates / study partners (Amazon Bedrock)
function teammatesModal(c) {
  const hack = c.type === "hackathon";
  const example = hack ? "A frontend person and an ML person for a 48-hour hackathon. I do backend." : "A study partner for weekly mock tests, ideally someone in Pune.";
  const body = openModal(`${modalHead(`<span class="ai-head">${icon("userPlus")} ${hack ? "Find teammates" : "Find study partners"}</span>`)}
    <p class="muted small">Describe what you need. AI compares it with the profiles of members of <b>${esc(c.name)}</b> and suggests who to message.</p>
    <form><textarea name="need" rows="3" maxlength="300" required placeholder="${esc(example)}"></textarea>
      ${!me.skills?.length && !me.demo ? `<p class="hint">Tip: <a href="#/me" data-action="close-modal">add your own skills</a> so matches can complement them.</p>` : ""}
      <div class="modal-actions"><button class="btn ai" type="submit">${icon("sparkles")} Find matches</button></div></form><div id="tm-out"></div>`);
  const form = $("form", body), out = $("#tm-out", body);
  $("textarea", form).focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("[type=submit]", form);
    btn.disabled = true;
    out.innerHTML = `<div class="shimmer"></div><div class="shimmer" style="width:80%"></div>`;
    try {
      const r = await api("POST", `/api/communities/${c.cid}/teammates`, { need: $("textarea", form).value });
      out.innerHTML = `${r.matches.length ? `<h3 style="margin:16px 0 4px;font-size:13px" class="muted">Suggested members</h3>${r.matches.map((m) => `<div class="match">${avatar(m.user.name, m.user.sub)}
          <div class="grow"><div class="row gap-8"><a href="#/u/${esc(m.user.sub)}" style="color:inherit"><b>${esc(m.user.name)}</b></a>${sampleTag(m.user)}</div>
          <div class="muted xs">${profileLine(m.user) || "IITM BS student"}</div><div class="small" style="margin-top:4px">${esc(m.why)}</div></div>
          <a class="btn outline sm" href="#/dm/${esc(m.user.sub)}">${icon("message")} Message</a></div>`).join("")}`
        : `<p class="muted" style="margin-top:16px">No strong matches yet. Try describing it differently, or invite more people to the community.</p>`}
        ${r.tip ? `<div class="cmu-tldr" style="margin-top:12px">${esc(r.tip)}</div>` : ""}
        <p class="ai-note">Suggestions by Amazon Bedrock, based only on what members wrote in their profiles.</p>`;
    } catch (x) { out.innerHTML = `<p class="error">${esc(x.message)}</p>`; } finally { btn.disabled = false; }
  };
}

// ---------------- boot ----------------
async function loadStats() {
  try {
    const s = await api("GET", "/api/public/stats");
    $$("[data-stat]").forEach((el) => (el.textContent = Number(s[el.dataset.stat] || 0).toLocaleString()));
  } catch { /* landing still works without numbers */ }
}

const ACTIONS = {
  "open-login": () => authModal("login"),
  "open-signup": () => authModal("signup"),
  demo: (el) => demoLogin(el),
  logout: () => {
    const federated = session?.federated;
    logout();
    // also end the Cognito hosted session, so the next "Continue with Google" can pick a different account
    if (federated && cfg.authDomain) location.href = `${cfg.authDomain}/logout?${new URLSearchParams({ client_id: cfg.clientId, logout_uri: redirectUri() })}`;
  },
  "logout-signup": () => { logout(); authModal("signup"); },
  "open-menu": () => document.body.classList.add("menu-open"),
  "close-menu": () => document.body.classList.remove("menu-open"),
  "close-modal": () => closeModal(),
  google: () => googleLogin(),
  theme: () => toggleTheme(),
  notifications: () => toggleNotifications(),
  "user-menu": () => { const p = $("#user-panel"); closePanels(p); p.hidden = !p.hidden; },
  "create-post": (el) => { document.body.classList.remove("menu-open"); createPostModal(el.dataset.cid).catch((e) => toast(e.message, true)); },
  "create-community": () => { document.body.classList.remove("menu-open"); createCommunityModal(); },
};

async function boot() {
  hydrateIcons();
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (el && ACTIONS[el.dataset.action]) {
      if (el.tagName !== "A" || el.dataset.action !== "close-modal") e.preventDefault();
      ACTIONS[el.dataset.action](el, e);
      return;
    }
    if (!e.target.closest(".dropdown")) closePanels();
  });
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
  window.addEventListener("hashchange", route);
  wideMQ.addEventListener("change", () => { if (/^#\/c\/[^/]+(\/(chat|about|members))?$/.test(location.hash)) route(); });
  $("#search-form").onsubmit = (e) => {
    e.preventDefault();
    const q = $("#search-input").value.trim();
    if (q.length >= 2) go(`#/search/${encodeURIComponent(q)}`);
  };
  try {
    cfg = await fetch("config.json", { cache: "no-store" }).then((r) => r.json());
  } catch {
    toast("Couldn't load app settings. Please refresh.", true);
    return;
  }
  loadStats();
  let fromGoogle = false;
  try { fromGoogle = await finishGoogleLogin(); } catch (e) { toast(e.message, true); }
  session = store.get();
  if (!session) return;
  await enterApp();
  if (fromGoogle && me && !me.level) {
    toast("Welcome to Quad! 🎉 Set up your profile so classmates can find you.");
    go("#/me");
  }
}
boot();
