// ── Generation Counter & Session State ──
let GEN = 0;
const S = { auth: false, email: null, name: null, id: null, sessionToken: null };

// ── Playwright Microservice Config ──
// Set RENDER_URL to your deployed Render service URL.
// Falls back to localhost:3001 for local development.
const RENDER_URL = "https://huduma-smart-server.onrender.com"; // ← your Render URL
const IS_LOCAL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const MICROSERVICE_URL = IS_LOCAL ? "http://localhost:3001" : RENDER_URL;

const N8N = {
  enabled: true,  // live — real emails go directly to the HELB portal
  auth: `${MICROSERVICE_URL}/api/helb/login`,
  otp: `${MICROSERVICE_URL}/api/helb/otp`,
  balance: `${MICROSERVICE_URL}/api/helb/balance`,
  disb: `${MICROSERVICE_URL}/api/helb/disb`,
  appStatus: `${MICROSERVICE_URL}/api/helb/app-status`,
  repayment: `${MICROSERVICE_URL}/api/helb/repayment`,
  statement: `${MICROSERVICE_URL}/api/helb/statement`,
  apply: `${MICROSERVICE_URL}/api/helb/apply`,
  clearance: `${MICROSERVICE_URL}/api/helb/clearance`,
  appeal: `${MICROSERVICE_URL}/api/helb/appeal`,
  updateInfo: `${MICROSERVICE_URL}/api/helb/update-info`,
  saveCreds: `${MICROSERVICE_URL}/api/helb/save-creds`,
  support: `${MICROSERVICE_URL}/api/helb/support`
};

// ── Mock DB (fallback when n8n disabled) ──
const DB = {
  "john@test.com": { pw: "pass1234", name: "John Doe", id: "123456783", bal: 45000, out: 50000, penalty: 0, disb: [{ d: "2024-01-10", a: 15000, s: "Disbursed" }, { d: "2024-08-15", a: 15000, s: "Pending" }], appStatus: "Under Review", repaid: 12000 },
  "jane@test.com": { pw: "pass1234", name: "Jane Smith", id: "876543211", bal: 120000, out: 145000, penalty: 5000, disb: [{ d: "2023-01-15", a: 40000, s: "Disbursed" }, { d: "2023-09-15", a: 40000, s: "Disbursed" }], appStatus: "Approved", repaid: 30000 },
  "new@test.com": { pw: "pass1234", name: "New Student", id: "112233446", bal: 0, out: 0, penalty: 0, disb: [], appStatus: "Not Applied", repaid: 0 }
};

const rawWait = ms => new Promise(r => setTimeout(r, ms));

async function n8nCall(url, payload) {
  const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!resp.ok) throw new Error(`n8n error: ${resp.status}`);
  return resp.json();
}

async function apiAuth(email, pw) {
  // Always call the live Playwright microservice — no mock fallback
  try {
    return await n8nCall(N8N.auth, { email, password: pw });
  } catch (error) {
    console.error("[apiAuth] Microservice call failed:", error);
    throw error;
  }
}

async function apiAction(url, payload) {
  // Live: forward to n8n webhook with session token attached
  try { return await n8nCall(url, { ...payload, sessionToken: S.sessionToken }); }
  catch (e) { return { error: e.message }; }
}

// ── DOM Refs ──
const feed = document.getElementById("feed");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const micBtn = document.getElementById("micBtn");
const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("overlay");
const sessionBadge = document.getElementById("sessionBadge");
const topbarStatus = document.getElementById("topbarStatus");

// ── Sidebar ──
function openSidebar() { sidebar.classList.add("open"); overlay.classList.add("open"); }
function closeSidebar() { sidebar.classList.remove("open"); overlay.classList.remove("open"); }
function autoResize(el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 160) + "px"; }
function updateSendBtn() { sendBtn.disabled = !userInput.value.trim(); }
function handleKey(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); } }
function scroll() { setTimeout(() => feed.scrollTop = feed.scrollHeight, 60); }

// ── Background Particle Canvas ──
const ctx = document.getElementById("bgCanvas").getContext("2d");
let w, h, dots = [];
function resizeCb() { w = ctx.canvas.width = window.innerWidth; h = ctx.canvas.height = window.innerHeight; }
window.addEventListener("resize", resizeCb); resizeCb();
for (let i = 0; i < 45; i++) dots.push({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * .4, vy: (Math.random() - .5) * .4 });
function drawCanvas() {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(59,130,246,0.25)"; ctx.strokeStyle = "rgba(59,130,246,0.06)";
  for (let i = 0; i < dots.length; i++) {
    let d = dots[i]; d.x += d.vx; d.y += d.vy;
    if (d.x < 0 || d.x > w) d.vx *= -1; if (d.y < 0 || d.y > h) d.vy *= -1;
    ctx.beginPath(); ctx.arc(d.x, d.y, 1.5, 0, Math.PI * 2); ctx.fill();
    for (let j = i + 1; j < dots.length; j++) {
      let d2 = dots[j], dist = Math.hypot(d.x - d2.x, d.y - d2.y);
      if (dist < 140) { ctx.globalAlpha = 1 - (dist / 140); ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d2.x, d2.y); ctx.stroke(); ctx.globalAlpha = 1; }
    }
  }
  requestAnimationFrame(drawCanvas);
}
drawCanvas();

// ── Message Rendering ──
function addMsg(type, html) {
  document.getElementById("hero")?.remove();
  const row = document.createElement("div"); row.className = `msg-row ${type}-row`;
  const av = type === "agent"
    ? `<div class="msg-avatar agent-msg-avatar"><div class="inner">HS</div></div>`
    : `<div class="msg-avatar user-msg-avatar">Me</div>`;
  row.innerHTML = `${av}<div class="msg-bubble ${type}-bubble">${html}</div>`;
  feed.appendChild(row); scroll(); return row;
}

function showTyping(label = "Huduma Smart is processing…") {
  document.getElementById("hero")?.remove();
  let row = document.createElement("div"); row.className = "typing-row"; row.id = "typingRow";
  row.innerHTML = `<div class="msg-avatar agent-msg-avatar"><div class="inner">HS</div></div><div class="typing-bubble"><div class="typing-label">${label}</div><div class="typing-dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>`;
  feed.appendChild(row); scroll();
}
function hideTyping() { document.getElementById("typingRow")?.remove(); }

function renderToolCard(name, params) {
  const c = document.createElement("div"); c.className = "tool-card";
  c.innerHTML = `<div class="tool-card-head"><div class="tool-spinner"></div><svg class="tool-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="14" height="14"><path d="M20 6L9 17l-5-5"/></svg> Playwright → ${name}</div><div class="tool-params">${JSON.stringify(params, null, 2)}</div>`;
  feed.appendChild(c); scroll(); return c;
}

async function stream(text, el, g) {
  let words = text.split(" "); el.innerHTML = "";
  for (let i = 0; i < words.length; i++) {
    if (GEN !== g) throw "stale";
    el.innerHTML += (i > 0 ? " " : "") + words[i];
    await rawWait(18 + Math.random() * 25);
  }
}

// ── Auth Card ──
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function askAuth(g) {
  return new Promise(resolve => {
    window.doLogin = async (e) => {
      e.preventDefault();
      const em = document.getElementById("authEm").value.trim();
      const pw = document.getElementById("authPw").value;
      const errEl = document.getElementById("authErr");
      // Layer 1 validation — email required, National IDs rejected
      if (!EMAIL_RE.test(em)) {
        errEl.textContent = "The HEF portal requires a valid email address. National IDs are not accepted here.";
        return;
      }
      errEl.textContent = "";
      const btn = document.getElementById("authBtn");
      btn.textContent = "Logging in to HELB portal…"; btn.disabled = true;
      let res;
      try {
        res = await apiAuth(em, pw);
      } catch (err) {
        btn.textContent = "Login to Portal"; btn.disabled = false;
        errEl.textContent = "⚠️ Could not reach the automation service. Make sure the server is running on port 3001.";
        return;
      }
      if (GEN !== g) return resolve(false);
      if (res.ok) {
        // Extract name from page title or fall back to email prefix
        const displayName = res.name || res.pageTitle?.split(" ")[0] || em.split("@")[0];
        Object.assign(S, { auth: true, email: em, name: displayName, id: res.id || null, sessionToken: res.sessionToken || null });
        sessionBadge.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><path d="M8 0a8 8 0 100 16A8 8 0 008 0zm3.5 6l-4.5 4.5L5 8.5 6 7.5l1 1 3.5-3.5 1 1z"/></svg> ${displayName}`;
        topbarStatus.innerHTML = `<span class="status-pulse"></span> Authenticated — ${displayName}`;
        document.getElementById("authCard").innerHTML = `<div class="rc ok"><div class="rc-lbl">✅ Portal Access Granted</div><div class="rc-sub">Logged in as <strong>${em}</strong>. Session is active for this conversation.</div></div>`;
        resolve(true);
      } else if (res.otp_required) {
        document.getElementById("authCard").innerHTML = `<div class="rc warn"><div class="rc-lbl">📱 OTP Required</div><div class="rc-sub">The portal sent a one-time code to your registered phone. Please type it below.</div></div>`;
        resolve("otp");
      } else {
        btn.textContent = "Login to Portal"; btn.disabled = false;
        // Show the real portal error (wrong password, account locked, etc.)
        const portalMsg = res.message || "Invalid credentials. Please check and try again.";
        document.getElementById("authErr").textContent = `❌ ${portalMsg}`;
      }
    };
    window.cancelLogin = () => { GEN++; resolve(false); document.getElementById("authCard")?.remove(); };

    const row = document.createElement("div"); row.className = "msg-row agent-row";
    row.innerHTML = `
      <div class="msg-avatar agent-msg-avatar"><div class="inner">HS</div></div>
      <div class="auth-card" id="authCard">
        <div class="auth-card-title">🔐 HELB Portal Login</div>
        <div class="auth-card-sub">I'll securely log in to <strong>portal.hef.co.ke</strong> on your behalf via the automation service.</div>
        <form onsubmit="doLogin(event)">
          <div class="auth-field"><label for="authEm">Registered Email Address</label><input type="email" id="authEm" placeholder="e.g. yourname@gmail.com" autocomplete="email" required></div>
          <div class="auth-field"><label for="authPw">Password / PIN</label><input type="password" id="authPw" placeholder="Your HELB password" required></div>
          <div style="font-size:11px;color:var(--red);margin-bottom:10px;" id="authErr"></div>
          <div class="auth-row"><button type="button" class="auth-btn-cancel" onclick="cancelLogin()">Cancel</button><button type="submit" class="auth-btn" id="authBtn">Login to Portal</button></div>
        </form>
        <div style="font-size:10px;color:var(--t3);margin-top:10px;">🔒 Your credentials are sent directly to the Playwright microservice and are never stored in plain text.</div>
      </div>`;
    feed.appendChild(row); scroll();
  });
}

// ── OTP Card ──
function askOTP(g) {
  return new Promise(resolve => {
    window.submitOTP = async () => {
      const code = document.getElementById("otpInput").value.trim();
      if (!code) return;
      const btn = document.getElementById("otpBtn"); btn.textContent = "Verifying…"; btn.disabled = true;
      let res = { ok: false };
      try { res = await n8nCall(N8N.otp, { otp: code, sessionToken: S.sessionToken }); } catch { }
      if (GEN !== g) return resolve(false);
      if (res.ok) resolve(true); else { btn.textContent = "Verify"; btn.disabled = false; document.getElementById("otpErr").textContent = "Invalid OTP. Try again."; }
    };
    const row = document.createElement("div"); row.className = "msg-row agent-row";
    row.innerHTML = `
      <div class="msg-avatar agent-msg-avatar"><div class="inner">HS</div></div>
      <div class="auth-card" id="otpCard">
        <div class="auth-card-title">📱 OTP Verification</div>
        <div class="auth-card-sub">The portal sent a one-time code to your registered phone number. Please enter it below.</div>
        <div class="auth-field"><label for="otpInput">OTP Code</label><input type="text" id="otpInput" placeholder="e.g. 123456" maxlength="8"></div>
        <div style="font-size:11px;color:var(--red);margin-bottom:10px;" id="otpErr"></div>
        <button class="auth-btn" id="otpBtn" onclick="submitOTP()" style="width:100%">Verify OTP</button>
      </div>`;
    feed.appendChild(row); scroll();
  });
}

// ── Result Card Renderers ──
function cardBalance(u) {
  const pen = u.penalty ? `<div class="rc-sub" style="color:var(--red);font-weight:600;margin-top:4px;">⚠️ Penalty: KES ${u.penalty.toLocaleString()}</div>` : "";
  return `<div class="rc ok"><div class="rc-lbl">Loan Balance</div><div class="rc-val">KES ${(u.out || 0).toLocaleString()}</div><div class="rc-sub">Principal Awarded: KES ${(u.bal || 0).toLocaleString()}</div><div class="rc-sub">Total Repaid: KES ${(u.repaid || 0).toLocaleString()}</div>${pen}</div>`;
}
function cardDisb(disb) {
  if (!disb || !disb.length) return `<div class="rc warn"><div class="rc-lbl">Disbursements</div><div class="rc-sub">No disbursement records found.</div></div>`;
  const rows = disb.map(d => `<tr><td>${d.d}</td><td>KES ${d.a.toLocaleString()}</td><td><span class="badge ${d.s === "Disbursed" ? "done" : "pending"}">${d.s}</span></td></tr>`).join("");
  return `<div class="rc info"><div class="rc-lbl">Disbursement Schedule</div><table class="rc-table"><tr><th>Date</th><th>Amount</th><th>Status</th></tr>${rows}</table></div>`;
}
function cardAppStatus(u) {
  const cls = u.appStatus === "Approved" ? "done" : u.appStatus === "Under Review" ? "review" : "pending";
  return `<div class="rc info"><div class="rc-lbl">Application Status</div><div style="margin-top:6px;"><span class="badge ${cls}">${u.appStatus || "Unknown"}</span></div><div class="rc-sub" style="margin-top:8px;">For detailed breakdown visit the portal or ask me to check specific documents.</div></div>`;
}
function cardError(msg) {
  return `<div class="rc err"><div class="rc-lbl">⚠️ Automation Error</div><div class="rc-sub">${msg}</div></div>`;
}

// ── Intent Detection ──
function matchIntent(t) {
  if (/\b(hello|hi|hey|start)\b/.test(t)) return "greet";
  if (/balance|outstanding|owe|how much/.test(t)) return "balance";
  if (/disburse|disbursement|schedule|paid out/.test(t)) return "disb";
  if (/application|status|progress|approved|approval|tracking/.test(t)) return "appStatus";
  if (/repay|repayment|history|paid back/.test(t)) return "repayment";
  if (/statement|download|pdf/.test(t)) return "statement";
  if (/apply|application form|new loan|undergraduate|tvet|postgrad|scholarship|bursary/.test(t)) return "apply";
  if (/clearance|certificate|complian/.test(t)) return "clearance";
  if (/appeal|recon|rejected|unsuccessful/.test(t)) return "appeal";
  if (/update|change|password|contact|phone|email|personal info/.test(t)) return "updateInfo";
  if (/support|complain|faq|help|contact helb/.test(t)) return "support";
  return "unknown";
}

// ── Ensure Auth Helper ──
async function ensureAuth(g, reason) {
  if (S.auth) return true;
  addMsg("agent", `To <strong>${reason}</strong>, I need to log in to the HELB portal on your behalf.`);
  const res = await askAuth(g);
  if (res === "otp") return await askOTP(g);
  return res;
}

// ── Core Intent Processor ──
async function processIntent(text, g) {
  const t = text.toLowerCase().trim();
  const intent = matchIntent(t);

  if (intent === "greet") return "Hi there, I am Huduma Smart. How may I help you with your HELB account today?";

  if (intent === "balance") {
    if (!await ensureAuth(g, "check your loan balance")) return null;
    const tc = renderToolCard("get_balance", { portal: "portal.hef.co.ke", action: "scrape_balance", email: S.email });
    showTyping("Fetching balance from HELB portal…");
    const r = await apiAction(N8N.balance, { email: S.email });
    hideTyping(); tc.classList.add("tool-done");
    if (r.error) return { text: "There was an issue reaching the portal.", html: cardError(r.error) };
    return { text: `Here is your current HELB loan balance, ${S.name}.`, html: cardBalance(r) };
  }

  if (intent === "disb") {
    if (!await ensureAuth(g, "view your disbursement schedule")) return null;
    const tc = renderToolCard("get_disbursements", { portal: "portal.hef.co.ke", action: "scrape_disbursements", email: S.email });
    showTyping("Retrieving disbursements from portal…");
    const r = await apiAction(N8N.disb, { email: S.email });
    hideTyping(); tc.classList.add("tool-done");
    if (r.error) return { text: "Could not retrieve disbursements.", html: cardError(r.error) };
    return { text: `Here is your disbursement schedule:`, html: cardDisb(r.disb) };
  }

  if (intent === "appStatus") {
    if (!await ensureAuth(g, "track your application status")) return null;
    const tc = renderToolCard("get_app_status", { portal: "portal.hef.co.ke", action: "scrape_app_status", email: S.email });
    showTyping("Checking application status on portal…");
    const r = await apiAction(N8N.appStatus, { email: S.email });
    hideTyping(); tc.classList.add("tool-done");
    if (r.error) return { text: "Could not retrieve application status.", html: cardError(r.error) };
    return { text: `Here is your current application status:`, html: cardAppStatus(r) };
  }

  if (intent === "repayment") {
    if (!await ensureAuth(g, "view your repayment history")) return null;
    const tc = renderToolCard("get_repayment", { action: "scrape_repayment", email: S.email });
    showTyping("Fetching repayment data…");
    const r = await apiAction(N8N.repayment, { email: S.email });
    hideTyping(); tc.classList.add("tool-done");
    if (r.error) return { text: "Could not fetch repayment data.", html: cardError(r.error) };
    return { text: `Your total amount repaid so far is <strong>KES ${(r.repaid || 0).toLocaleString()}</strong>. Your outstanding balance is <strong>KES ${(r.out || 0).toLocaleString()}</strong>.` };
  }

  if (intent === "statement") {
    if (!await ensureAuth(g, "download your loan statement")) return null;
    const tc = renderToolCard("download_statement", { action: "generate_pdf", email: S.email });
    showTyping("Generating your loan statement PDF…");
    const r = await apiAction(N8N.statement, { email: S.email });
    hideTyping(); tc.classList.add("tool-done");
    const link = r.pdfUrl || "#";
    return { text: "Your loan statement is ready.", html: `<a class="dl-link" href="${link}" target="_blank">📄 Download Loan Statement (PDF)</a>` };
  }

  if (intent === "apply") {
    if (!await ensureAuth(g, "start a loan application")) return null;
    const tc = renderToolCard("start_application", { action: "navigate_apply", email: S.email });
    showTyping("Opening application form on portal…");
    const r = await apiAction(N8N.apply, { email: S.email });
    hideTyping(); tc.classList.add("tool-done");
    if (r.error) return { text: "Unable to open the application at this time.", html: cardError(r.error) };
    return { text: `Your loan application has been initiated on the portal. Here's what I need from you next:\n\n• Which type of loan? (Undergraduate / TVET / Postgraduate / Scholarship)\n• Your institution and course details\n\nPlease reply and I'll complete the form.` };
  }

  if (intent === "clearance") {
    if (!await ensureAuth(g, "apply for a clearance certificate")) return null;
    const tc = renderToolCard("apply_clearance", { action: "navigate_clearance", email: S.email });
    showTyping("Navigating to clearance section…");
    const r = await apiAction(N8N.clearance, { email: S.email });
    hideTyping(); tc.classList.add("tool-done");
    if (r.error) return { text: "Could not initiate clearance.", html: cardError(r.error) };
    return { text: `Clearance certificate application initiated. Based on your repayment status, your eligibility will be confirmed within 3–5 working days.` };
  }

  if (intent === "appeal") {
    if (!await ensureAuth(g, "submit an appeal")) return null;
    const tc = renderToolCard("submit_appeal", { action: "navigate_appeal", email: S.email });
    showTyping("Accessing appeals section…");
    const r = await apiAction(N8N.appeal, { email: S.email });
    hideTyping(); tc.classList.add("tool-done");
    return { text: `Your appeal has been submitted. Please provide any supporting documents as prompted by the portal. Reference: <strong>${r.ref || "APPEAL-" + Date.now()}</strong>` };
  }

  if (intent === "updateInfo") {
    if (!await ensureAuth(g, "update your account information")) return null;
    return { text: `I can update the following:\n\n• 📧 Email address\n• 📞 Phone number\n• 🏦 Bank / M-Pesa details\n• 🔑 Password\n\nWhat would you like to change?` };
  }

  if (intent === "support") {
    return { text: `You can reach HELB support via:\n\n• 📧 Email: <strong>info@helb.co.ke</strong>\n• 📞 Phone: <strong>+254 20 2429 272</strong>\n• 🌐 Portal: <a href="https://www.helb.co.ke" target="_blank" style="color:var(--blue)">helb.co.ke</a>\n\nWould you like me to submit a support ticket on your behalf?` };
  }

  return "I'm here to help with your HELB account. You can ask me to check your balance, track your application, view disbursements, download statements, or apply for a loan.";
}

// ── Main Dispatcher ──
async function dispatch(text) {
  if (!text) return;
  const g = ++GEN;
  addMsg("user", text);
  userInput.value = ""; updateSendBtn(); autoResize(userInput);
  if (window.innerWidth <= 720) closeSidebar();

  try {
    showTyping("Analyzing your request…");
    await rawWait(500); if (GEN !== g) return;
    let res = await processIntent(text, g);
    if (GEN !== g) return;
    if (!res) return hideTyping();
    hideTyping();

    const row = document.createElement("div"); row.className = "msg-row agent-row";
    row.innerHTML = `<div class="msg-avatar agent-msg-avatar"><div class="inner">HS</div></div><div class="msg-bubble agent-bubble" id="rb${g}"></div>`;
    feed.appendChild(row); scroll();

    const bubble = document.getElementById(`rb${g}`);
    const txt = typeof res === "string" ? res : res.text;
    await stream(txt, bubble, g);
    if (typeof res === "object" && res.html) bubble.innerHTML += "<br><br>" + res.html;
    scroll();
  } catch (e) { if (e !== "stale") console.error(e); }
  finally { hideTyping(); }
}

function doSend() { dispatch(userInput.value.trim()); }
window.quickAction = (t) => dispatch(t);
window.newChat = () => { GEN++; Object.assign(S, { auth: false, email: null, name: null, id: null, sessionToken: null }); sessionBadge.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><circle cx="8" cy="5" r="3"/><path d="M2 13c0-3.3 2.7-6 6-6s6 2.7 6 6"/></svg> Guest`; topbarStatus.innerHTML = `<span class="status-pulse"></span> Online — Ready to assist`; feed.innerHTML = `<div class="hero" id="hero"><div class="hero-logo"><div class="hero-ring"><svg viewBox="0 0 32 32" fill="none" width="36" height="36"><path d="M16 2L4 8v8c0 7.4 5.2 14.3 12 16 6.8-1.7 12-8.6 12-16V8L16 2z" fill="url(#s2)"/><path d="M11 16l3.5 3.5L21 12" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><defs><linearGradient id="s2" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse"><stop stop-color="#3b82f6"/><stop offset="0.5" stop-color="#ef4444"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs></svg></div></div><h1 class="hero-title">Huduma Smart</h1><p class="hero-subtitle">Your official HELB AI consultant. Powered by n8n Playwright automation.</p></div>`; setTimeout(() => { addMsg("agent", "Hi there, I am Huduma Smart. How may I help you with your HELB account today?"); }, 600); };

// ── Voice Input ──
let rec = null;
function toggleMic() {
  if (!rec && window.webkitSpeechRecognition) {
    rec = new webkitSpeechRecognition(); rec.continuous = false; rec.interimResults = true; rec.lang = "en-KE";
    rec.onstart = () => micBtn.classList.add("active");
    rec.onend = () => { micBtn.classList.remove("active"); rec = null; };
    rec.onresult = (e) => { userInput.value = e.results[0][0].transcript; updateSendBtn(); if (e.results[0].isFinal) doSend(); };
    rec.start();
  } else if (rec) rec.stop();
}

// ── Boot Greeting ──
setTimeout(() => addMsg("agent", "Hi there, I am Huduma Smart. How may I help you with your HELB account today?"), 800);