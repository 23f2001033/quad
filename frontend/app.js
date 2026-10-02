// Quad frontend: a dependency-free SPA. Cognito auth over fetch, HTTP API for data, WebSocket API for live updates.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const TYPE_META = {
  subject: { emoji: "📚", label: "Course" },
  hackathon: { emoji: "🏆", label: "Hackathon" },
  event: { emoji: "🎉", label: "Event / fest" },
  club: { emoji: "🎸", label: "Club" },
  other: { emoji: "📍", label: "Meetup & other" },
};
const LEVELS = ["Foundation", "Diploma in Programming", "Diploma in Data Science", "BSc", "BS", "Alumni"];
const MAX_FILE = 15 * 1024 * 1024;

let cfg;
let session = null;
let me = null;
let dmUnread = 0;
let ws = null, wsWanted = [], wsRetry = 0, wsPing = null, wsOpenedOnce = false;
let current = {};
let routeSeq = 0;
let pendingSignup = null;

// ---------------- small helpers ----------------
const store = {
  get() { try { return JSON.parse(localStorage.getItem("quad.session") || "null"); } catch { return null; } },
  set(v) { try { v ? localStorage.setItem("quad.session", JSON.stringify(v)) : localStorage.removeItem("quad.session"); } catch { /* private mode */ } },
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const rich = (s) => esc(s).replace(/\bhttps?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
const hue = (str) => { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const initials = (n) => (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const avatar = (name, seed, size = "") => `<span class="avatar ${size}" style="background:hsl(${hue(seed || name)} 55% 48%)">${esc(initials(name))}</span>`;
const dmConv = (a, b) => "d_" + [a, b].sort().join("_");
const go = (h) => { location.hash = h; };

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
  const d = $("#modal");
  if (!d.open) d.showModal();
  return $("#modal-body");
}
function closeModal() { const d = $("#modal"); if (d.open) d.close(); }

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
  session = { idToken: auth.IdToken, refreshToken: auth.RefreshToken || session?.refreshToken, exp: jwtClaims(auth.IdToken).exp * 1000, demo };
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

function authModal(mode, email = "") {
  const close = `<button class="icon-btn" type="button" data-action="close-modal" aria-label="Close">✕</button>`;
  const hint = domains().length ? `Only <b>@${esc(domains()[0])}</b> addresses can join.` : "";
  const emailField = `<label>Student email</label><input name="email" type="email" required autocomplete="email" value="${esc(email)}" placeholder="${domains().length ? "21f1000000@" + esc(domains()[0]) : "you@college.edu"}">`;
  const pw = (ac) => `<label>Password</label><input name="password" type="password" required minlength="8" autocomplete="${ac}"><p class="hint">At least 8 characters, with a number.</p>`;
  const views = {
    login: `<div class="modal-head"><h2>Log in</h2>${close}</div><form>${emailField}<label>Password</label><input name="password" type="password" required autocomplete="current-password">
      <p class="error"></p><div class="modal-actions"><button class="btn primary" type="submit">Log in</button></div></form>
      <p class="switch">New here? <a href="#" data-auth="signup">Create an account</a> · <a href="#" data-auth="forgot">Forgot password?</a></p>`,
    signup: `<div class="modal-head"><h2>Join Quad</h2>${close}</div><p class="muted small">${hint} We'll email you a code to confirm the address is yours.</p>
      <form><label>Full name</label><input name="name" required maxlength="60" autocomplete="name">${emailField}${pw("new-password")}
      <p class="error"></p><div class="modal-actions"><button class="btn primary" type="submit">Create account</button></div></form>
      <p class="switch">Already joined? <a href="#" data-auth="login">Log in</a></p>`,
    confirm: `<div class="modal-head"><h2>Check your inbox</h2>${close}</div><p class="muted">We sent a 6-digit code to <b>${esc(email)}</b>. It can take a minute, so check spam too.</p>
      <form><label>Verification code</label><input name="code" required inputmode="numeric" autocomplete="one-time-code" maxlength="6">
      <p class="error"></p><div class="modal-actions"><button class="btn ghost" type="button" data-resend>Resend code</button><button class="btn primary" type="submit">Verify</button></div></form>`,
    forgot: `<div class="modal-head"><h2>Reset password</h2>${close}</div><form>${emailField}<p class="error"></p>
      <div class="modal-actions"><button class="btn primary" type="submit">Send reset code</button></div></form>`,
    reset: `<div class="modal-head"><h2>Choose a new password</h2>${close}</div><p class="muted small">Enter the code we emailed to <b>${esc(email)}</b>.</p>
      <form><label>Code</label><input name="code" required inputmode="numeric" maxlength="6">${pw("new-password")}<p class="error"></p>
      <div class="modal-actions"><button class="btn primary" type="submit">Change password</button></div></form>`,
  };
  const body = openModal(views[mode]);
  $$("[data-auth]", body).forEach((a) => (a.onclick = (e) => { e.preventDefault(); authModal(a.dataset.auth, $("[name=email]", body)?.value || email); }));
  $("[data-resend]", body)?.addEventListener("click", async () => {
    try { await cognito("ResendConfirmationCode", { ClientId: cfg.clientId, Username: email }); toast("New code sent."); } catch (e) { toast(e.message, true); }
  });
  const form = $("form", body);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = $(".error", form), btn = $("[type=submit]", form);
    err.textContent = "";
    btn.disabled = true;
    try { await AUTH[mode](Object.fromEntries(new FormData(form)), email); } catch (x) { err.textContent = x.message; } finally { btn.disabled = false; }
  };
  $("input", form)?.focus();
}

async function demoLogin(btn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Opening demo…";
  try {
    const r = await api("POST", "/api/public/demo");
    session = { idToken: r.idToken, exp: jwtClaims(r.idToken).exp * 1000, demo: true };
    store.set(session);
    await enterApp();
  } catch (e) { toast(e.message, true); } finally { btn.disabled = false; btn.textContent = label; }
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
    if (wsOpenedOnce) current.onReconnect?.();
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
    renderBadge();
    toast(`💬 ${ev.fromName}: ${ev.message.text || "sent a file"}`, false, () => go(`#/dm/${ev.from}`));
  }
  current.onEvent?.(ev);
}

// ---------------- app shell ----------------
async function enterApp() {
  $("#landing").hidden = true;
  $("#app").hidden = false;
  $("#demo-banner").hidden = !session.demo;
  try { me = await api("GET", "/api/me"); } catch (e) { toast(e.message, true); return; }
  await refreshSidebar();
  refreshDmBadge();
  wsConnect();
  route();
}

async function refreshSidebar() {
  const { communities } = await api("GET", "/api/my/communities");
  $("#my-comms").innerHTML = communities.length
    ? communities.map((c) => `<a href="#/c/${esc(c.cid)}" data-cid="${esc(c.cid)}">${(TYPE_META[c.type] || TYPE_META.other).emoji} <span>${esc(c.name)}</span></a>`).join("")
    : `<p class="hint" style="padding:0 10px">Join communities from Explore.</p>`;
  $("#side-me").innerHTML = `<a class="row" href="#/me" style="color:inherit">${avatar(me.name, me.sub, "sm")}<span class="small"><b>${esc(me.name)}</b></span></a>`;
  setActiveNav();
}
async function refreshDmBadge() {
  try {
    const { dms } = await api("GET", "/api/dms");
    dmUnread = dms.reduce((n, d) => n + Number(d.unread || 0), 0);
    renderBadge();
  } catch { /* badge is cosmetic */ }
}
function renderBadge() { const b = $("#dm-badge"); b.hidden = dmUnread <= 0; b.textContent = dmUnread; }
function setActiveNav() {
  const parts = (location.hash.slice(1) || "/").split("/").filter(Boolean);
  const key = parts[0] === "dm" ? "messages" : parts[0] || "home";
  $$(".side-nav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === key));
  $$(".side-comms a").forEach((a) => a.classList.toggle("active", parts[0] === "c" && a.dataset.cid === parts[1]));
}

async function route() {
  if (!session || !me) return;
  document.body.classList.remove("menu-open");
  closeModal();
  const parts = (location.hash.slice(1) || "/").split("/").filter(Boolean);
  const seq = ++routeSeq;
  current = {};
  watch([]);
  setActiveNav();
  const view = $("#view");
  const ctx = { view, stale: () => seq !== routeSeq };
  view.innerHTML = `<div class="loading">Loading…</div>`;
  window.scrollTo(0, 0);
  try {
    if (parts[0] === "explore") await viewExplore(ctx);
    else if (parts[0] === "c" && parts[1]) await viewCommunity(ctx, parts[1], parts[2] || "posts");
    else if (parts[0] === "messages") await viewMessages(ctx);
    else if (parts[0] === "dm" && parts[1]) await viewDM(ctx, parts[1]);
    else if (parts[0] === "u" && parts[1]) await viewUser(ctx, parts[1]);
    else if (parts[0] === "me") await viewMe(ctx);
    else await viewHome(ctx);
  } catch (e) {
    if (!ctx.stale() && session) view.innerHTML = `<div class="empty">😕 ${esc(e.message)}</div>`;
  }
}

// ---------------- shared renderers ----------------
function commCard(c) {
  const t = TYPE_META[c.type] || TYPE_META.other;
  return `<a class="comm-card" href="#/c/${esc(c.cid)}">
    <div class="row"><span class="comm-emoji">${t.emoji}</span><span class="tag">${t.label}</span>${c.joined ? `<span class="tag verified">Joined</span>` : ""}${sampleTag(c)}</div>
    <h3>${esc(c.name)}</h3><p>${esc(c.description || "")}</p><span class="muted small">👥 ${c.memberCount || 0} members</span></a>`;
}
function dmItem(d) {
  return `<a class="list-item" href="#/dm/${esc(d.other)}">${avatar(d.otherName, d.other)}
    <div class="grow"><div class="title">${esc(d.otherName)}</div><div class="sub">${esc(d.lastText || "")}</div></div>
    <div class="small muted">${ago(d.lastAt)}</div>${Number(d.unread) ? `<i class="badge">${d.unread}</i>` : ""}</a>`;
}
function attsHtml(atts = []) {
  if (!atts?.length) return "";
  return `<div class="atts">${atts.map((a) => (a.type || "").startsWith("image/") && a.type !== "image/svg+xml"
    ? `<a href="${esc(a.url)}" target="_blank" rel="noopener"><img class="att-img" src="${esc(a.url)}" alt="${esc(a.name)}" loading="lazy"></a>`
    : `<a class="att-file" href="${esc(a.url)}" target="_blank" rel="noopener">📄 <span>${esc(a.name)}</span> <small class="muted">${fmtSize(a.size)}</small></a>`).join("")}</div>`;
}
const sampleTag = (x) => (x.sample ? ` <span class="tag sample" title="Sample content for the demo">Sample</span>` : "");
const profileLine = (u) => [u.level, u.batch && `Batch ${u.batch}`, u.city && `📍 ${u.city}`].filter(Boolean).map(esc).join(" · ");

function composer(el, { placeholder, submitLabel, onSend, chat = false }) {
  el.innerHTML = chat
    ? `<div class="row"><input type="file" multiple hidden><button class="icon-btn" type="button" data-c="attach" title="Attach files">📎</button>
       <textarea class="grow" rows="1" placeholder="${esc(placeholder)}"></textarea><button class="btn primary" data-c="send">${esc(submitLabel)}</button></div><div class="pending"></div>`
    : `<textarea rows="3" placeholder="${esc(placeholder)}"></textarea><div class="pending"></div>
       <div class="bar"><div><input type="file" multiple hidden><button class="btn ghost sm" type="button" data-c="attach">📎 Attach files</button></div>
       <button class="btn primary sm" data-c="send">${esc(submitLabel)}</button></div>`;
  const ta = $("textarea", el), input = $("input[type=file]", el), btn = $("[data-c=send]", el), pend = $(".pending", el);
  let files = [];
  const drawPending = () => {
    pend.innerHTML = files.map((f, i) => `<span class="chip">📄 ${esc(f.name)} <button class="icon-btn small" data-rm="${i}" style="padding:0 2px;font-size:12px">✕</button></span>`).join("");
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
  const send = async () => {
    const text = ta.value.trim();
    if ((!text && !files.length) || btn.disabled) return;
    btn.disabled = true;
    try {
      const atts = [];
      for (const f of files) { btn.textContent = `Uploading ${atts.length + 1}/${files.length}…`; atts.push(await uploadFile(f)); }
      btn.textContent = "Sending…";
      await onSend(text, atts);
      ta.value = "";
      files = [];
      drawPending();
    } catch (e) { toast(e.message, true); } finally { btn.disabled = false; btn.textContent = submitLabel; ta.focus(); }
  };
  btn.onclick = send;
  if (chat) ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
}

// ---------------- views ----------------
async function viewHome({ view, stale }) {
  const [{ communities }, { dms }] = await Promise.all([api("GET", "/api/communities"), api("GET", "/api/dms")]);
  if (stale()) return;
  const joined = communities.filter((c) => c.joined);
  const suggested = communities.filter((c) => !c.joined).slice(0, 6);
  view.innerHTML = `
    <div class="page-head"><div><h1>Hi ${esc(me.name.split(" ")[0])} 👋</h1><p class="muted">${me.batch ? `Batch ${esc(me.batch)} · ` : ""}Here's what's happening on Quad.</p></div>
      <a class="btn primary" href="#/explore">🧭 Explore communities</a></div>
    ${!me.level && !me.demo ? `<div class="card" style="margin-bottom:14px"><b>Complete your profile</b><p class="muted small">Add your level, city and skills so classmates and teammates can find you.</p><a class="btn sm primary" href="#/me">Edit profile</a></div>` : ""}
    <h2 class="section-title">Your communities</h2>
    ${joined.length ? `<div class="comm-grid">${joined.map(commCard).join("")}</div>` : `<div class="empty">You haven't joined any communities yet. <a href="#/explore">Explore</a> to find your course groups.</div>`}
    ${dms.length ? `<h2 class="section-title">Recent messages</h2><div class="list">${dms.slice(0, 5).map(dmItem).join("")}</div>` : ""}
    ${suggested.length ? `<h2 class="section-title">Suggested for you</h2><div class="comm-grid">${suggested.map(commCard).join("")}</div>` : ""}`;
}

async function viewExplore({ view, stale }) {
  const { communities } = await api("GET", "/api/communities");
  if (stale()) return;
  let filter = "all", q = "";
  const filters = [["all", "All"], ...Object.entries(TYPE_META).map(([k, v]) => [k, `${v.emoji} ${v.label}`])];
  view.innerHTML = `
    <div class="page-head"><div><h1>Explore</h1><p class="muted">Every community on Quad. Anyone verified can join.</p></div><button class="btn primary" data-act="create">＋ New community</button></div>
    <input type="search" id="ex-q" placeholder="Search communities…" style="margin-bottom:10px">
    <div class="chips" id="ex-f" style="margin-bottom:14px">${filters.map(([k, l]) => `<button class="chip ${k === "all" ? "on" : ""}" data-f="${k}">${esc(l)}</button>`).join("")}</div>
    <div id="ex-list"></div>`;
  const draw = () => {
    const list = communities.filter((c) => (filter === "all" || c.type === filter) && (!q || `${c.name} ${c.description || ""}`.toLowerCase().includes(q)));
    $("#ex-list").innerHTML = list.length ? `<div class="comm-grid">${list.map(commCard).join("")}</div>` : `<div class="empty">Nothing matches yet. Why not start it?</div>`;
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
  $("[data-act=create]", view).onclick = createCommunityModal;
}

function createCommunityModal() {
  const body = openModal(`<div class="modal-head"><h2>New community</h2><button class="icon-btn" data-action="close-modal">✕</button></div>
    <form><label>Name</label><input name="name" maxlength="80" required placeholder="e.g. MLT, Sep 2026 term study circle">
    <label>Type</label><select name="type">${Object.entries(TYPE_META).map(([k, v]) => `<option value="${k}">${v.emoji} ${v.label}</option>`).join("")}</select>
    <label>Description</label><textarea name="description" maxlength="500" rows="3" placeholder="Who is it for? What happens here?"></textarea>
    <p class="error"></p><div class="modal-actions"><button type="button" class="btn ghost" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Create</button></div></form>`);
  const form = $("form", body);
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

async function viewCommunity(ctx, cid, tab) {
  const { view, stale } = ctx;
  const c = await api("GET", `/api/communities/${cid}`);
  if (stale()) return;
  const t = TYPE_META[c.type] || TYPE_META.other;
  view.innerHTML = `
    <div class="comm-head">
      <div class="row"><span class="comm-emoji">${t.emoji}</span><span class="tag">${t.label}</span><span class="muted small">👥 ${c.memberCount || 0} members · started by ${esc(c.createdByName || "someone")}</span></div>
      <h1>${esc(c.name)}</h1>${c.description ? `<p class="muted" style="white-space:pre-wrap">${rich(c.description)}</p>` : ""}
      <div class="actions">${c.joined
        ? `<button class="btn ai" data-act="catchup">✨ Catch me up</button>${c.role !== "owner" ? `<button class="btn ghost sm" data-act="leave">Leave</button>` : ""}`
        : `<button class="btn primary" data-act="join">Join community</button>`}</div>
    </div>
    <nav class="tabs">${[["posts", "📝 Posts"], ["chat", "💬 Group chat"], ["members", `👥 Members`]].map(([k, l]) => `<a href="#/c/${esc(cid)}/${k}" class="${tab === k ? "active" : ""}">${l}</a>`).join("")}</nav>
    <div id="tab"></div>`;
  $("[data-act=join]", view)?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try { await api("POST", `/api/communities/${cid}/join`); await refreshSidebar(); toast(`Joined ${c.name} 🎉`); route(); } catch (x) { toast(x.message, true); e.target.disabled = false; }
  });
  $("[data-act=leave]", view)?.addEventListener("click", async () => {
    if (!confirm(`Leave ${c.name}?`)) return;
    await api("POST", `/api/communities/${cid}/leave`);
    await refreshSidebar();
    route();
  });
  $("[data-act=catchup]", view)?.addEventListener("click", () => catchUpModal(c));
  if (c.joined) watch([`comm:${cid}`, `conv:c_${cid}`]);
  const tabEl = $("#tab");
  if (tab === "members") return membersTab(tabEl, c);
  if (tab === "chat") {
    if (!c.joined) { tabEl.innerHTML = `<div class="empty">Join this community to read and send messages.</div>`; return; }
    return chatPanel(tabEl, `c_${cid}`, ctx);
  }
  return postsTab(tabEl, c, ctx);
}

async function postsTab(el, c, { stale }) {
  el.innerHTML = `${c.joined ? `<div class="composer" id="post-composer"></div>` : ""}<div id="feed"><div class="loading">Loading posts…</div></div><div id="more"></div>`;
  const feed = $("#feed");
  const seen = new Set();
  const addPost = (p, top) => {
    if (seen.has(p.pid)) return;
    seen.add(p.pid);
    $(".empty", feed)?.remove();
    const holder = document.createElement("div");
    holder.innerHTML = postHtml(p);
    const node = holder.firstElementChild;
    top ? feed.prepend(node) : feed.append(node);
    bindPost(node, p, c);
  };
  if (c.joined) {
    composer($("#post-composer"), {
      placeholder: "Share an announcement, a question, notes…", submitLabel: "Post",
      onSend: async (text, attachments) => addPost(await api("POST", `/api/communities/${c.cid}/posts`, { text, attachments }), true),
    });
  }
  const load = async (before) => {
    const { posts } = await api("GET", `/api/communities/${c.cid}/posts${before ? `?before=${before}` : ""}`);
    if (stale()) return;
    if (!before) feed.innerHTML = posts.length ? "" : `<div class="empty">No posts yet.${c.joined ? " Be the first!" : ""}</div>`;
    posts.forEach((p) => addPost(p, false));
    $("#more").innerHTML = posts.length === 25 ? `<button class="btn outline" style="width:100%">Load older posts</button>` : "";
    $("#more button")?.addEventListener("click", () => load(posts[posts.length - 1].pid));
  };
  await load();
  current.onEvent = (ev) => {
    if (ev.type === "post" && ev.post.cid === c.cid) addPost(ev.post, true);
    if (ev.type === "comment") $(`[data-pid="${CSS.escape(ev.pid)}"]`, feed)?._onComment?.(ev.comment);
  };
}

function postHtml(p) {
  return `<article class="post" data-pid="${esc(p.pid)}">
    <div class="post-head"><a href="#/u/${esc(p.author)}">${avatar(p.authorName, p.author)}</a>
      <div class="grow"><a class="who" href="#/u/${esc(p.author)}" style="color:inherit">${esc(p.authorName)}</a>${sampleTag(p)}
      <div class="muted small">${p.authorLevel ? `${esc(p.authorLevel)} · ` : ""}${ago(p.createdAt)}</div></div></div>
    ${p.text ? `<div class="post-text">${rich(p.text)}</div>` : ""}${attsHtml(p.attachments)}
    <div class="post-actions"><button class="btn sm ${p.liked ? "liked" : ""}" data-p="like">${p.liked ? "♥" : "♡"} <span>${p.likeCount || 0}</span></button>
      <button class="btn sm" data-p="comments">💬 <span>${p.commentCount || 0}</span></button></div>
    <div class="comments" hidden></div></article>`;
}

function bindPost(node, p, c) {
  const likeBtn = $("[data-p=like]", node), cBtn = $("[data-p=comments]", node), box = $(".comments", node);
  const ids = new Set();
  let loaded = false;
  likeBtn.onclick = async () => {
    if (!c.joined) return toast("Join the community to like posts");
    try {
      const r = await api("POST", `/api/communities/${c.cid}/posts/${p.pid}/like`);
      likeBtn.classList.toggle("liked", r.liked);
      likeBtn.innerHTML = `${r.liked ? "♥" : "♡"} <span>${r.likeCount}</span>`;
    } catch (e) { toast(e.message, true); }
  };
  const addComment = (cm) => {
    const d = document.createElement("div");
    d.className = "comment";
    d.innerHTML = `${avatar(cm.authorName, cm.author, "sm")}<div class="bubble"><b class="small">${esc(cm.authorName)}</b>${sampleTag(cm)} <span class="muted small">${ago(cm.createdAt)}</span><div>${rich(cm.text)}</div></div>`;
    box.insertBefore(d, $("form", box));
  };
  node._onComment = (cm) => {
    if (ids.has(cm.cmid)) return;
    ids.add(cm.cmid);
    const n = $("span", cBtn);
    n.textContent = Number(n.textContent) + 1;
    if (loaded) addComment(cm);
  };
  cBtn.onclick = async () => {
    box.hidden = !box.hidden;
    if (box.hidden || loaded) return;
    loaded = true;
    box.innerHTML = c.joined ? `<form><input placeholder="Write a comment…" maxlength="1000"><button class="btn sm primary">Reply</button></form>` : "";
    const { comments } = await api("GET", `/api/communities/${c.cid}/posts/${p.pid}/comments`);
    comments.forEach((cm) => { ids.add(cm.cmid); addComment(cm); });
    const f = $("form", box);
    if (f) f.onsubmit = async (e) => {
      e.preventDefault();
      const inp = $("input", f), text = inp.value.trim();
      if (!text) return;
      inp.disabled = true;
      try { node._onComment(await api("POST", `/api/communities/${c.cid}/posts/${p.pid}/comments`, { text })); inp.value = ""; }
      catch (er) { toast(er.message, true); } finally { inp.disabled = false; inp.focus(); }
    };
  };
}

function membersTab(el, c) {
  el.innerHTML = `<div class="list">${c.members.map((m) => `<div class="list-item">${avatar(m.name, m.sub)}
    <div class="grow"><a class="title" href="#/u/${esc(m.sub)}" style="color:inherit">${esc(m.name)}</a> ${m.role === "owner" ? `<span class="tag">Owner</span>` : ""}${sampleTag(m)}
      <div class="sub">${profileLine(m)}</div>
      ${m.skills?.length ? `<div class="chips" style="margin-top:4px">${m.skills.slice(0, 6).map((s) => `<span class="chip">${esc(s)}</span>`).join("")}</div>` : ""}</div>
    ${m.sub !== me.sub ? `<a class="btn sm outline" href="#/dm/${esc(m.sub)}">Message</a>` : ""}</div>`).join("")}</div>`;
}

async function chatPanel(el, conv, { stale }, head = "") {
  current.conv = conv;
  el.innerHTML = `<div class="chat ${conv.startsWith("d_") ? "dm" : ""}">${head}<div class="chat-log"><div class="loading">Loading messages…</div></div><div class="chat-form"></div></div>`;
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
    log.insertAdjacentHTML("beforeend", `<div class="msg ${mine ? "mine" : ""} ${cont ? "cont" : ""}">
      ${mine ? "" : `<a href="#/u/${esc(m.sender)}">${avatar(m.senderName, m.sender, "sm")}</a>`}
      <div>${cont ? "" : `<div class="meta">${mine ? "" : `${esc(m.senderName)}${sampleTag(m)} · `}${clock(m.createdAt)}</div>`}
      ${m.text ? `<div class="bubble">${rich(m.text)}</div>` : ""}${attsHtml(m.attachments)}</div></div>`);
    last = m;
  };
  const toBottom = () => { log.scrollTop = log.scrollHeight; };
  log.addEventListener("load", (e) => { if (e.target.tagName === "IMG" && nearBottom()) toBottom(); }, true);
  const load = async () => {
    const { messages } = await api("GET", `/api/conversations/${conv}/messages`);
    if (stale()) return;
    const first = !seen.size;
    if (first) log.innerHTML = messages.length ? "" : `<div class="empty" data-empty>No messages yet. Say hi 👋</div>`;
    const stick = first || nearBottom();
    messages.forEach(add);
    if (stick) toBottom();
  };
  await load();
  if (stale()) return;
  composer($(".chat-form", el), {
    placeholder: "Message… (Enter to send, Shift+Enter for a new line)", submitLabel: "Send", chat: true,
    onSend: async (text, attachments) => { add(await api("POST", `/api/conversations/${conv}/messages`, { text, attachments })); toBottom(); },
  });
  current.onEvent = (ev) => {
    if (ev.type === "message" && ev.message.conv === conv) { const stick = nearBottom(); add(ev.message); if (stick) toBottom(); }
  };
  current.onReconnect = load;
}

async function viewMessages({ view, stale }) {
  const { dms } = await api("GET", "/api/dms");
  if (stale()) return;
  view.innerHTML = `
    <div class="page-head"><div><h1>Messages</h1><p class="muted">Direct messages with other verified students.</p></div><button class="btn primary" data-act="new">✉️ New message</button></div>
    ${dms.length ? `<div class="list">${dms.map(dmItem).join("")}</div>` : `<div class="empty">No conversations yet. Message someone from a community's member list, or start one here.</div>`}`;
  $("[data-act=new]", view).onclick = newDmModal;
  current.onEvent = (ev) => { if (ev.type === "dm") route(); };
}

function newDmModal() {
  const body = openModal(`<div class="modal-head"><h2>New message</h2><button class="icon-btn" data-action="close-modal">✕</button></div>
    <input type="search" placeholder="Search by name, level, city or skill…"><div class="list" style="margin-top:10px" id="dm-results"><div class="loading">Loading…</div></div>`);
  const input = $("input", body), out = $("#dm-results", body);
  let timer;
  const search = async () => {
    try {
      const { users } = await api("GET", `/api/users?q=${encodeURIComponent(input.value.trim())}`);
      const list = users.filter((u) => u.sub !== me.sub);
      out.innerHTML = list.length ? list.slice(0, 30).map((u) => `<a class="list-item" href="#/dm/${esc(u.sub)}">${avatar(u.name, u.sub)}
        <div class="grow"><div class="title">${esc(u.name)}${sampleTag(u)}</div><div class="sub">${profileLine(u)}</div></div></a>`).join("") : `<div class="loading">No students found.</div>`;
    } catch (e) { out.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  };
  input.oninput = () => { clearTimeout(timer); timer = setTimeout(search, 250); };
  search();
  input.focus();
}

async function viewDM(ctx, sub) {
  if (sub === me.sub) return go("#/me");
  const { user } = await api("GET", `/api/users/${sub}`);
  if (ctx.stale()) return;
  const conv = dmConv(me.sub, sub);
  watch([`conv:${conv}`]);
  ctx.view.innerHTML = `<div id="dm"></div>`;
  await chatPanel($("#dm"), conv, ctx, `<div class="chat-head"><a href="#/messages" class="icon-btn" aria-label="Back">←</a>
    <a href="#/u/${esc(sub)}">${avatar(user.name, sub)}</a><div class="grow"><b>${esc(user.name)}</b>${sampleTag(user)}<div class="muted small">${profileLine(user)}</div></div></div>`);
  refreshDmBadge();
}

async function viewUser({ view, stale }, sub) {
  if (sub === me.sub) return go("#/me");
  const { user, communities } = await api("GET", `/api/users/${sub}`);
  if (stale()) return;
  view.innerHTML = `
    <div class="profile-card">
      <div class="row" style="flex-wrap:wrap">${avatar(user.name, sub, "lg")}
        <div class="grow"><h1 style="margin:0">${esc(user.name)}${sampleTag(user)}</h1><div class="muted">${profileLine(user) || "IITM BS student"}</div></div>
        <a class="btn primary" href="#/dm/${esc(sub)}">✉️ Message</a></div>
      ${user.bio ? `<p style="margin-top:14px;white-space:pre-wrap">${rich(user.bio)}</p>` : ""}
      ${user.skills?.length ? `<div class="chips" style="margin-top:10px">${user.skills.map((s) => `<span class="chip">${esc(s)}</span>`).join("")}</div>` : ""}
    </div>
    <h2 class="section-title">Communities</h2>
    ${communities.length ? `<div class="chips">${communities.map((c) => `<a class="chip" href="#/c/${esc(c.cid)}">${(TYPE_META[c.type] || TYPE_META.other).emoji} ${esc(c.name)}</a>`).join("")}</div>` : `<p class="muted">Not in any communities yet.</p>`}`;
}

async function viewMe({ view, stale }) {
  me = await api("GET", "/api/me");
  if (stale()) return;
  view.innerHTML = `
    <div class="page-head"><h1>Your profile</h1></div>
    <div class="profile-card">
      <div class="row">${avatar(me.name, me.sub, "lg")}<div><b>${esc(me.email)}</b>
        ${me.demo ? `<span class="tag sample">Demo account</span>` : `<span class="tag verified">✓ Verified student</span>`}
        <div class="muted small">${me.batch ? `Batch ${esc(me.batch)}, read from your roll number` : ""}</div></div></div>
      ${me.demo ? `<p class="hint" style="margin-top:12px">The shared demo profile is read-only. Sign up with your student email to make your own.</p>` : ""}
      <form class="form-grid">
        <div><label>Name</label><input name="name" required maxlength="60" value="${esc(me.name)}"></div>
        <div><label>Level</label><select name="level"><option value="">Choose…</option>${LEVELS.map((l) => `<option ${me.level === l ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div><label>City</label><input name="city" maxlength="40" value="${esc(me.city)}" placeholder="e.g. Chennai, Patna, Pune"></div>
        <div><label>Skills <span class="hint">(comma separated)</span></label><input name="skills" value="${esc((me.skills || []).join(", "))}" placeholder="Python, SQL, Flask, ML"></div>
        <div style="grid-column:1/-1"><label>Bio</label><textarea name="bio" maxlength="300" rows="3" placeholder="What are you studying, building or looking for?">${esc(me.bio)}</textarea></div>
        <div style="grid-column:1/-1;margin-top:14px" class="row"><button class="btn primary" type="submit">Save profile</button><span class="error"></span></div>
      </form>
    </div>`;
  const form = $("form", view);
  if (me.demo) $$("input, select, textarea, button", form).forEach((x) => (x.disabled = true));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    f.skills = f.skills.split(",").map((s) => s.trim()).filter(Boolean);
    const btn = $("[type=submit]", form);
    btn.disabled = true;
    try { me = await api("PUT", "/api/me", f); await refreshSidebar(); toast("Profile saved ✓"); $(".error", form).textContent = ""; }
    catch (x) { $(".error", form).textContent = x.message; } finally { btn.disabled = false; }
  };
}

// ---------------- ✨ Catch me up (Amazon Bedrock) ----------------
function catchUpModal(c) {
  const windows = [["last_visit", "Since my last visit"], ["24h", "Last 24 hours"], ["7d", "Last 7 days"], ["30d", "Last 30 days"]];
  const body = openModal(`<div class="modal-head"><h2>✨ Catch me up</h2><button class="icon-btn" data-action="close-modal">✕</button></div>
    <p class="muted small">AI reads the posts, comments and group chat in <b>${esc(c.name)}</b> and tells you what matters.</p>
    <div class="cmu-windows">${windows.map(([k, l]) => `<button class="chip" data-w="${k}">${l}</button>`).join("")}</div><div id="cmu-out"></div>`);
  const out = $("#cmu-out", body);
  const list = (items, fn) => `<ul>${items.map(fn).join("")}</ul>`;
  const run = async (w, note = "") => {
    $$("[data-w]", body).forEach((b) => b.classList.toggle("on", b.dataset.w === w));
    out.innerHTML = `<p class="muted small">Reading posts and messages…</p><div class="shimmer"></div><div class="shimmer" style="width:85%"></div><div class="shimmer" style="width:65%"></div>`;
    try {
      const r = await api("POST", `/api/communities/${c.cid}/catchup`, { window: w });
      if (r.empty) {
        if (w === "last_visit") return run("7d", "Nothing new since your last visit, so here's the last 7 days.");
        out.innerHTML = `<div class="empty">🎉 You're all caught up. Nothing was posted in this period.</div>`;
        return;
      }
      const s = r.summary, n = r.counts;
      out.innerHTML = `<div class="cmu">
        ${note ? `<p class="hint">${esc(note)}</p>` : ""}
        <div class="cmu-counts">Read ${n.posts} posts, ${n.messages} chat messages and ${n.files} files since ${new Date(r.since).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</div>
        <div class="cmu-tldr">${esc(s.tldr)}</div>
        ${s.highlights.length ? `<h3>Highlights</h3>${list(s.highlights, (h) => `<li><b>${esc(h.title)}</b>: ${esc(h.detail)}${h.who ? ` <span class="muted small">(${esc(h.who)})</span>` : ""}</li>`)}` : ""}
        ${s.deadlines.length ? `<h3>Deadlines & dates</h3>${list(s.deadlines, (d) => `<li>📅 <b>${esc(d.when)}</b>: ${esc(d.what)}</li>`)}` : ""}
        ${s.openQuestions.length ? `<h3>Unanswered questions (help out!)</h3>${list(s.openQuestions, (q) => `<li>❓ ${esc(q.question)} <span class="muted small">asked by ${esc(q.askedBy)}</span></li>`)}` : ""}
        ${s.files.length ? `<h3>Files worth opening</h3>${list(s.files, (f) => `<li>📄 <b>${esc(f.name)}</b> from ${esc(f.sharedBy)}: ${esc(f.why)}</li>`)}` : ""}
        ${s.mood ? `<p class="mood">Group vibe: ${esc(s.mood)}</p>` : ""}
        <p class="hint small" style="margin-top:14px">Written by Amazon Bedrock (${esc(r.model)}). AI can make mistakes, so check the original posts for anything important.</p></div>`;
    } catch (e) { out.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  };
  $(".cmu-windows", body).onclick = (e) => { const b = e.target.closest("[data-w]"); if (b) run(b.dataset.w); };
  run("last_visit");
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
  logout: () => logout(),
  "logout-signup": () => { logout(); authModal("signup"); },
  "open-menu": () => document.body.classList.add("menu-open"),
  "close-menu": () => document.body.classList.remove("menu-open"),
  "close-modal": () => closeModal(),
};

async function boot() {
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (el && ACTIONS[el.dataset.action]) { e.preventDefault(); ACTIONS[el.dataset.action](el, e); }
  });
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
  window.addEventListener("hashchange", route);
  try {
    cfg = await fetch("config.json", { cache: "no-store" }).then((r) => r.json());
  } catch {
    toast("Couldn't load app settings. Please refresh.", true);
    return;
  }
  loadStats();
  session = store.get();
  if (session) await enterApp();
}
boot();
