// ── Generation Counter & Session State ──
let GEN = 0;
const S = { auth: false, email: null, name: null, id: null, sessionToken: null };

// ── Dynamic Backend Discovery ──
function getBackendUrl() {
  if (typeof window !== "undefined" && window.location) {
    const { origin, protocol, port } = window.location;
    if (protocol.startsWith("http")) {
      // If served by a frontend dev server (e.g. Live Server on 5500, Vite on 5173, etc.)
      // redirect API calls to the Express backend on port 3001
      if (port && (port === "5500" || port === "5173" || port === "8080" || port === "8000" || port === "3000")) {
        return "http://localhost:3001";
      }
      // When served directly by the Express server (or Vercel / Render), use same origin
      return origin;
    }
  }
  return "http://localhost:3001";
}

let BACKEND = getBackendUrl();

function getApiEndpoints(base) {
  return {
    health:     `${base}/api/health`,
    auth:       `${base}/api/helb/login`,
    otp:        `${base}/api/helb/otp`,
    balance:    `${base}/api/helb/balance`,
    disb:       `${base}/api/helb/disb`,
    appStatus:  `${base}/api/helb/app-status`,
    repayment:  `${base}/api/helb/repayment`,
    statement:  `${base}/api/helb/statement`,
    apply:      `${base}/api/helb/apply`,
    clearance:  `${base}/api/helb/clearance`,
    appeal:     `${base}/api/helb/appeal`,
    updateInfo: `${base}/api/helb/update-info`,
    saveCreds:  `${base}/api/helb/save-creds`,
    support:    `${base}/api/helb/support`
  };
}

let API = getApiEndpoints(BACKEND);

const rawWait = ms => new Promise(r => setTimeout(r, ms));

/**
 * apiCall — POST/GET to the automation backend and return JSON response.
 */
async function apiCall(url, payload, options = {}) {
  try {
    const fetchOptions = {
      method: options.method || (payload ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {})
    };

    const resp = await fetch(url, fetchOptions);
    const data = await resp.json().catch(() => ({
      ok: false,
      message: `HTTP ${resp.status}: ${resp.statusText || "Invalid server response"}`
    }));

    if (resp.status >= 500) {
      throw new Error(data.message || `Server error (HTTP ${resp.status})`);
    }

    return data;
  } catch (err) {
    if (err.name === "TypeError" && err.message.includes("fetch")) {
      throw new Error(`Cannot connect to backend server at ${BACKEND}. Make sure the server is running (run 'npm start' in the server folder).`);
    }
    throw err;
  }
}

async function apiAuth(credential, pw) {
  return await apiCall(API.auth, { credential, email: credential, nationalId: credential, password: pw });
}

async function apiAction(url, payload) {
  try {
    return await apiCall(url, { ...payload, sessionToken: S.sessionToken });
  } catch (e) {
    return { error: e.message };
  }
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
const sidebarFooter = document.querySelector(".sidebar-footer span");
const sidebarDot = document.querySelector(".sidebar-footer .status-dot");

// ── Live Backend Health Probe ──
async function checkBackendHealth() {
  try {
    const res = await fetch(API.health, { method: "GET" });
    if (res.ok) {
      const data = await res.json();
      if (sidebarFooter) sidebarFooter.textContent = `Backend Online (${data.service || "Playwright"})`;
      if (sidebarDot) sidebarDot.style.background = "var(--green)";
      return true;
    }
  } catch (_) {
    // If current origin failed and not localhost:3001, try probing localhost:3001
    if (BACKEND !== "http://localhost:3001") {
      try {
        const fallbackRes = await fetch("http://localhost:3001/api/health", { method: "GET" });
        if (fallbackRes.ok) {
          BACKEND = "http://localhost:3001";
          API = getApiEndpoints(BACKEND);
          if (sidebarFooter) sidebarFooter.textContent = "Backend Online (localhost:3001)";
          if (sidebarDot) sidebarDot.style.background = "var(--green)";
          return true;
        }
      } catch (_) {}
    }
  }

  if (sidebarFooter) sidebarFooter.textContent = "Backend Offline (Click to start)";
  if (sidebarDot) sidebarDot.style.background = "var(--red)";
  return false;
}

// Check health on load and periodically
setTimeout(checkBackendHealth, 400);
setInterval(checkBackendHealth, 30000);

// ── Sidebar Controls ──
function openSidebar() { sidebar.classList.add("open"); overlay.classList.add("open"); }
function closeSidebar() { sidebar.classList.remove("open"); overlay.classList.remove("open"); }
function autoResize(el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 160) + "px"; }
function updateSendBtn() { sendBtn.disabled = !userInput.value.trim(); }
function handleKey(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); } }
function scroll() { setTimeout(() => feed.scrollTop = feed.scrollHeight, 60); }

// ── Background Particle Canvas ──
const canvasEl = document.getElementById("bgCanvas");
if (canvasEl) {
  const ctx = canvasEl.getContext("2d");
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
}

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
  c.innerHTML = `<div class="tool-card-head"><div class="tool-spinner"></div><svg class="tool-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="14" height="14"><path d="M20 6L9 17l-5-5"/></svg> HEF Portal → ${name}</div><div class="tool-params">${JSON.stringify(params, null, 2)}</div>`;
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

// ── Validation Helpers ──
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_RE = /^\d{5,10}$/;

function validateAuthInput(val) {
  if (!val) return "Please enter your registered Email address or National ID number.";
  const trimmed = val.trim();
  if (!EMAIL_RE.test(trimmed) && !ID_RE.test(trimmed)) {
    return "Please enter a valid Email address (e.g. name@gmail.com) or Kenyan National ID (5–10 digits).";
  }
  return null;
}

// ── Auth Card ──
function askAuth(g) {
  return new Promise(resolve => {
    window.doLogin = async (e) => {
      e.preventDefault();
      const credInput = document.getElementById("authCred");
      const pwInput = document.getElementById("authPw");
      const errEl = document.getElementById("authErr");
      const btn = document.getElementById("authBtn");

      const cred = credInput.value.trim();
      const pw = pwInput.value;

      const validationError = validateAuthInput(cred);
      if (validationError) {
        errEl.textContent = validationError;
        credInput.focus();
        return;
      }

      if (!pw) {
        errEl.textContent = "Please enter your password / PIN.";
        pwInput.focus();
        return;
      }

      errEl.textContent = "";
      btn.innerHTML = `<span class="tool-spinner" style="display:inline-block;width:12px;height:12px;margin-right:6px;vertical-align:middle;"></span> Connecting to portal…`;
      btn.disabled = true;

      let res;
      try {
        res = await apiAuth(cred, pw);
      } catch (error) {
        btn.textContent = "Login to Portal";
        btn.disabled = false;
        errEl.innerHTML = `⚠️ ${error.message}<br><small style="color:var(--t2);margin-top:4px;display:block;">Tip: Open your terminal and run <code>cd server && npm start</code> to launch the automation backend.</small>`;
        return;
      }

      if (GEN !== g) return resolve(false);

      if (res && (res.ok || res.success)) {
        const displayName = res.name || res.pageTitle?.split(" ")[0] || cred.split("@")[0];
        Object.assign(S, {
          auth: true,
          email: cred,
          name: displayName,
          id: res.id || cred,
          sessionToken: res.sessionToken || null
        });

        sessionBadge.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><path d="M8 0a8 8 0 100 16A8 8 0 008 0zm3.5 6l-4.5 4.5L5 8.5 6 7.5l1 1 3.5-3.5 1 1z"/></svg> ${displayName}`;
        topbarStatus.innerHTML = `<span class="status-pulse"></span> Authenticated — ${displayName}`;

        const authCardEl = document.getElementById("authCard");
        if (authCardEl) {
          authCardEl.innerHTML = `
            <div class="rc ok">
              <div class="rc-lbl">✅ Portal Access Granted</div>
              <div class="rc-sub">Authenticated on <strong>portal.hef.co.ke</strong> as <strong>${cred}</strong>. Direct session is active.</div>
            </div>`;
        }
        resolve(true);
      } else if (res && res.otp_required) {
        const authCardEl = document.getElementById("authCard");
        if (authCardEl) {
          authCardEl.innerHTML = `
            <div class="rc warn">
              <div class="rc-lbl">📱 OTP Verification Required</div>
              <div class="rc-sub">The HEF portal sent a one-time verification code to your registered mobile number.</div>
            </div>`;
        }
        resolve("otp");
      } else {
        btn.textContent = "Login to Portal";
        btn.disabled = false;
        const portalMsg = res?.message || "Invalid credentials. Please verify your details and try again.";
        errEl.textContent = `❌ ${portalMsg}`;
      }
    };

    window.cancelLogin = () => {
      GEN++;
      resolve(false);
      document.getElementById("authCard")?.remove();
    };

    const row = document.createElement("div");
    row.className = "msg-row agent-row";
    row.innerHTML = `
      <div class="msg-avatar agent-msg-avatar"><div class="inner">HS</div></div>
      <div class="auth-card" id="authCard">
        <div class="auth-card-title">🔐 HELB / HEF Portal Login</div>
        <div class="auth-card-sub">Securely log into <strong>portal.hef.co.ke</strong> using your registered credentials.</div>
        <form onsubmit="doLogin(event)">
          <div class="auth-field">
            <label for="authCred">Registered Email or National ID Number</label>
            <input type="text" id="authCred" placeholder="e.g. name@gmail.com or 12345678" autocomplete="username" required>
          </div>
          <div class="auth-field">
            <label for="authPw">Portal Password / PIN</label>
            <input type="password" id="authPw" placeholder="Your HELB portal password" autocomplete="current-password" required>
          </div>
          <div style="font-size:12px;color:var(--red);margin-bottom:12px;line-height:1.4;" id="authErr"></div>
          <div class="auth-row">
            <button type="button" class="auth-btn-cancel" onclick="cancelLogin()">Cancel</button>
            <button type="submit" class="auth-btn" id="authBtn">Login to Portal</button>
          </div>
        </form>
        <div style="font-size:10px;color:var(--t3);margin-top:12px;">🔒 Credentials are authenticated directly against portal.hef.co.ke with end-to-end encryption.</div>
      </div>`;
    feed.appendChild(row);
    scroll();

    // Auto focus credential input
    setTimeout(() => document.getElementById("authCred")?.focus(), 100);
  });
}

// ── OTP Card ──
function askOTP(g) {
  return new Promise(resolve => {
    window.submitOTP = async () => {
      const code = document.getElementById("otpInput").value.trim();
      if (!code) return;
      const btn = document.getElementById("otpBtn");
      btn.textContent = "Verifying…";
      btn.disabled = true;
      let res = { ok: false };
      try {
        res = await apiCall(API.otp, { otp: code, sessionToken: S.sessionToken });
      } catch {}
      if (GEN !== g) return resolve(false);
      if (res && (res.ok || res.success)) {
        resolve(true);
      } else {
        btn.textContent = "Verify OTP";
        btn.disabled = false;
        document.getElementById("otpErr").textContent = "Invalid OTP code. Please check and try again.";
      }
    };

    const row = document.createElement("div");
    row.className = "msg-row agent-row";
    row.innerHTML = `
      <div class="msg-avatar agent-msg-avatar"><div class="inner">HS</div></div>
      <div class="auth-card" id="otpCard">
        <div class="auth-card-title">📱 OTP Verification</div>
        <div class="auth-card-sub">The HEF portal sent a one-time code to your phone. Please enter it below.</div>
        <div class="auth-field">
          <label for="otpInput">One-Time Password (OTP)</label>
          <input type="text" id="otpInput" placeholder="e.g. 123456" maxlength="8" autocomplete="one-time-code">
        </div>
        <div style="font-size:12px;color:var(--red);margin-bottom:10px;" id="otpErr"></div>
        <button class="auth-btn" id="otpBtn" onclick="submitOTP()" style="width:100%">Verify OTP</button>
      </div>`;
    feed.appendChild(row);
    scroll();
  });
}

// ── Result Card Renderers ──
function cardBalance(u) {
  const pen = u.penalty ? `<div class="rc-sub" style="color:var(--red);font-weight:600;margin-top:4px;">⚠️ Penalty: KES ${u.penalty.toLocaleString()}</div>` : "";
  return `
    <div class="rc ok">
      <div class="rc-lbl">Outstanding Loan Balance</div>
      <div class="rc-val">KES ${(u.out || 0).toLocaleString()}</div>
      <div class="rc-sub">Principal Awarded: KES ${(u.bal || 0).toLocaleString()}</div>
      <div class="rc-sub">Total Repaid: KES ${(u.repaid || 0).toLocaleString()}</div>
      ${pen}
    </div>`;
}

function cardDisb(disb) {
  if (!disb || !disb.length) {
    return `<div class="rc warn"><div class="rc-lbl">Disbursements</div><div class="rc-sub">No disbursement records found on your account.</div></div>`;
  }
  const rows = disb.map(d => `
    <tr>
      <td>${d.d}</td>
      <td>KES ${d.a.toLocaleString()}</td>
      <td><span class="badge ${d.s === "Disbursed" ? "done" : "pending"}">${d.s}</span></td>
    </tr>`).join("");
  return `
    <div class="rc info">
      <div class="rc-lbl">HEF / HELB Disbursement Schedule</div>
      <table class="rc-table">
        <thead><tr><th>Date</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function cardAppStatus(u) {
  const cls = u.appStatus === "Approved" ? "done" : u.appStatus === "Under Review" ? "review" : "pending";
  return `
    <div class="rc info">
      <div class="rc-lbl">Application Status</div>
      <div style="margin-top:6px;"><span class="badge ${cls}">${u.appStatus || "Submitted"}</span></div>
      <div class="rc-sub" style="margin-top:8px;">Batch: <strong>${u.batch || "HEF-2024/2025"}</strong> · Stage: <strong>${u.stage || "Document Verification"}</strong></div>
    </div>`;
}

function cardError(msg) {
  return `
    <div class="rc err">
      <div class="rc-lbl">⚠️ Portal Notice</div>
      <div class="rc-sub">${msg}</div>
    </div>`;
}

// ── Intent Detection ──
function matchIntent(t) {
  if (/\b(hello|hi|hey|start|habari|jambo)\b/i.test(t)) return "greet";
  if (/balance|outstanding|owe|how much|dues|loan statement/i.test(t)) return "balance";
  if (/disburse|disbursement|schedule|paid out|when will i receive/i.test(t)) return "disb";
  if (/application|status|progress|approved|approval|tracking|batch/i.test(t)) return "appStatus";
  if (/repay|repayment|history|paid back|paybill|how to pay/i.test(t)) return "repayment";
  if (/statement|download|pdf|records/i.test(t)) return "statement";
  if (/apply|application form|new loan|undergraduate|tvet|postgrad|scholarship|bursary/i.test(t)) return "apply";
  if (/clearance|certificate|complian/i.test(t)) return "clearance";
  if (/appeal|recon|rejected|unsuccessful|review/i.test(t)) return "appeal";
  if (/update|change|password|contact|phone|email|personal info/i.test(t)) return "updateInfo";
  if (/support|complain|faq|help|contact helb|customer care/i.test(t)) return "support";
  return "unknown";
}

// ── Ensure Auth Helper ──
async function ensureAuth(g, reason) {
  if (S.auth) return true;
  addMsg("agent", `To <strong>${reason}</strong>, I need to log into the HELB / HEF portal on your behalf.`);
  const res = await askAuth(g);
  if (res === "otp") return await askOTP(g);
  return res;
}

// ── Core Intent Processor ──
async function processIntent(text, g) {
  const t = text.toLowerCase().trim();
  const intent = matchIntent(t);

  if (intent === "greet") {
    return "Hi there! I am Huduma Smart, your official HELB & HEF AI Consultant. How can I assist you with your student portal today?";
  }

  if (intent === "balance") {
    if (!await ensureAuth(g, "check your loan balance")) return null;
    const tc = renderToolCard("get_balance", { portal: "portal.hef.co.ke", action: "retrieve_balance", user: S.email });
    showTyping("Fetching balance from HELB portal…");
    const r = await apiAction(API.balance, { email: S.email });
    hideTyping(); tc.classList.add("tool-done");
    if (r.error) return { text: "There was an issue fetching your balance from the portal.", html: cardError(r.error) };
    return { text: `Here is your current HELB loan overview, ${S.name}:`, html: cardBalance(r) };
  }

  if (intent === "disb") {
    if (!await ensureAuth(g, "view your disbursement schedule")) return null;
    const tc = renderToolCard("get_disbursements", { portal: "portal.hef.co.ke", action: "retrieve_disbursements", user: S.email });
    showTyping("Retrieving disbursement schedule from portal…");
    const r = await apiAction(API.disb, { email: S.email });
    hideTyping(); tc.classList.add("tool-done");
    if (r.error) return { text: "Could not retrieve disbursements.", html: cardError(r.error) };
    return { text: `Here is your HEF disbursement timeline:`, html: cardDisb(r.disb) };
  }

  if (intent === "appStatus") {
    if (!await ensureAuth(g, "track your application status")) return null;
    const tc = renderToolCard("get_app_status", { portal: "portal.hef.co.ke", action: "check_application", user: S.email });
    showTyping("Checking application status on HEF portal…");
    const r = await apiAction(API.appStatus, { email: S.email });
    hideTyping(); tc.classList.add("tool-done");
    if (r.error) return { text: "Could not retrieve application status.", html: cardError(r.error) };
    return { text: `Here is the current state of your scholarship/loan application:`, html: cardAppStatus(r) };
  }

  if (intent === "repayment") {
    if (!await ensureAuth(g, "view your repayment history")) return null;
    const tc = renderToolCard("get_repayment", { action: "retrieve_repayment_ledger", user: S.email });
    showTyping("Fetching repayment details…");
    const r = await apiAction(API.repayment, { email: S.email });
    hideTyping(); tc.classList.add("tool-done");
    if (r.error) return { text: "Could not fetch repayment data.", html: cardError(r.error) };
    return {
      text: `Your total repayments recorded: <strong>KES ${(r.repaid || 0).toLocaleString()}</strong>. Remaining balance: <strong>KES ${(r.out || 0).toLocaleString()}</strong>.<br><br>💡 To make a payment, use M-Pesa <strong>Paybill 200800</strong> with your National ID number as the Account Number.`
    };
  }

  if (intent === "statement") {
    if (!await ensureAuth(g, "generate your loan statement")) return null;
    const tc = renderToolCard("generate_statement", { action: "export_pdf", user: S.email });
    showTyping("Generating your statement PDF…");
    const r = await apiAction(API.statement, { email: S.email });
    hideTyping(); tc.classList.add("tool-done");
    const link = r.pdfUrl || "https://portal.hef.co.ke/";
    return {
      text: "Your official HELB statement is ready for download.",
      html: `<a class="dl-link" href="${link}" target="_blank" rel="noopener">📄 Download Official Statement (PDF)</a>`
    };
  }

  if (intent === "apply") {
    if (!await ensureAuth(g, "initiate a loan or scholarship application")) return null;
    const tc = renderToolCard("start_application", { action: "launch_application", user: S.email });
    showTyping("Preparing application forms…");
    const r = await apiAction(API.apply, { email: S.email });
    hideTyping(); tc.classList.add("tool-done");
    return {
      text: `Your loan application sequence has been initialized (Reference: <strong>${r.ref || "HEF-NEW"}</strong>).\n\nPlease let me know:\n1. Your program level (Undergraduate / TVET / Post-Graduate)\n2. Name of your university / college\n3. Whether you need tuition financing, upkeep, or both.`
    };
  }

  if (intent === "clearance") {
    if (!await ensureAuth(g, "check clearance certificate eligibility")) return null;
    const tc = renderToolCard("apply_clearance", { action: "check_clearance_status", user: S.email });
    showTyping("Checking compliance and clearance status…");
    const r = await apiAction(API.clearance, { email: S.email });
    hideTyping(); tc.classList.add("tool-done");
    if (r.eligible) {
      return { text: `🎉 Congratulations! You have no outstanding loan balance. You can download your official <strong>HELB Clearance Certificate</strong> on the portal.` };
    }
    return { text: `Clearance Certificate Notice:\n\n${r.reason || "You have an active loan balance. Once the balance is cleared in full, your certificate will generate automatically."}` };
  }

  if (intent === "appeal") {
    if (!await ensureAuth(g, "submit a loan appeal")) return null;
    const tc = renderToolCard("submit_appeal", { action: "create_appeal_ticket", user: S.email });
    showTyping("Creating appeal record on HEF portal…");
    const r = await apiAction(API.appeal, { email: S.email });
    hideTyping(); tc.classList.add("tool-done");
    return { text: `Your appeal has been logged under Reference: <strong>${r.ref || "APPEAL-" + Date.now()}</strong>. You can upload additional supporting documents on the portal.` };
  }

  if (intent === "updateInfo") {
    if (!await ensureAuth(g, "update your profile details")) return null;
    return { text: `I can help update your profile information:\n\n• 📧 Registered Email\n• 📱 Phone number for OTP / SMS alerts\n• 🏦 Disbursement Bank Account / M-Pesa Number\n• 🔑 Password change\n\nWhich field would you like to update?` };
  }

  if (intent === "support") {
    return {
      text: `You can reach the official HELB / HEF Helpdesk via:\n\n• 📧 Email: <strong>contactcentre@helb.co.ke</strong> / <strong>info@hef.co.ke</strong>\n• 📞 Phone: <strong>+254 711 052 000</strong> / <strong>+254 20 2278 000</strong>\n• 🏢 Huduma Centres: Available countrywide at all HELB desks\n• 🌐 Official Website: <a href="https://www.hef.co.ke" target="_blank" style="color:var(--blue)">hef.co.ke</a>`
    };
  }

  return "I'm here to assist with your HELB & HEF needs. You can ask me to check your loan balance, view disbursement dates, track your scholarship status, download statements, or apply for a loan.";
}

// ── Main Dispatcher ──
async function dispatch(text) {
  if (!text) return;
  const g = ++GEN;
  addMsg("user", text);
  userInput.value = "";
  updateSendBtn();
  autoResize(userInput);
  if (window.innerWidth <= 720) closeSidebar();

  try {
    showTyping("Analyzing your request…");
    await rawWait(400);
    if (GEN !== g) return;

    let res = await processIntent(text, g);
    if (GEN !== g) return;
    if (!res) return hideTyping();
    hideTyping();

    const row = document.createElement("div");
    row.className = "msg-row agent-row";
    row.innerHTML = `<div class="msg-avatar agent-msg-avatar"><div class="inner">HS</div></div><div class="msg-bubble agent-bubble" id="rb${g}"></div>`;
    feed.appendChild(row);
    scroll();

    const bubble = document.getElementById(`rb${g}`);
    const txt = typeof res === "string" ? res : res.text;
    await stream(txt, bubble, g);
    if (typeof res === "object" && res.html) bubble.innerHTML += "<br><br>" + res.html;
    scroll();
  } catch (e) {
    if (e !== "stale") console.error(e);
  } finally {
    hideTyping();
  }
}

function doSend() {
  dispatch(userInput.value.trim());
}

window.quickAction = (t) => dispatch(t);

window.newChat = () => {
  GEN++;
  Object.assign(S, { auth: false, email: null, name: null, id: null, sessionToken: null });
  sessionBadge.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><circle cx="8" cy="5" r="3"/><path d="M2 13c0-3.3 2.7-6 6-6s6 2.7 6 6"/></svg> Guest`;
  topbarStatus.innerHTML = `<span class="status-pulse"></span> Online — Ready to assist`;
  feed.innerHTML = `
    <div class="hero" id="hero">
      <div class="hero-logo">
        <div class="hero-ring">
          <svg viewBox="0 0 32 32" fill="none" width="36" height="36">
            <path d="M16 2L4 8v8c0 7.4 5.2 14.3 12 16 6.8-1.7 12-8.6 12-16V8L16 2z" fill="url(#s2)"/>
            <path d="M11 16l3.5 3.5L21 12" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
            <defs>
              <linearGradient id="s2" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
                <stop stop-color="#3b82f6"/>
                <stop offset="0.5" stop-color="#ef4444"/>
                <stop offset="1" stop-color="#f59e0b"/>
              </linearGradient>
            </defs>
          </svg>
        </div>
      </div>
      <h1 class="hero-title">Huduma Smart</h1>
      <p class="hero-subtitle">Your official HELB AI consultant. Powered by direct HEF portal connectivity.</p>
    </div>`;

  setTimeout(() => {
    addMsg("agent", "Hi there! I am Huduma Smart. How may I help you with your HELB or HEF account today?");
  }, 500);
};

// ── Voice Input ──
let rec = null;
function toggleMic() {
  if (!rec && window.webkitSpeechRecognition) {
    rec = new webkitSpeechRecognition();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-KE";
    rec.onstart = () => micBtn.classList.add("active");
    rec.onend = () => { micBtn.classList.remove("active"); rec = null; };
    rec.onresult = (e) => {
      userInput.value = e.results[0][0].transcript;
      updateSendBtn();
      if (e.results[0].isFinal) doSend();
    };
    rec.start();
  } else if (rec) {
    rec.stop();
  }
}

// ── Initial Greeting ──
setTimeout(() => {
  addMsg("agent", "Hi there! I am Huduma Smart, your official HELB & HEF AI Consultant. How can I assist you today?");
}, 700);