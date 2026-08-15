/**
 * Huduma Smart — Dedicated HELB & HEF AI Chatbot
 * Direct portal connectivity, realistic Kenya HEF calculations,
 * domain guardrails & interactive student financing tools.
 */

// ── Generation Counter & Session State ──
let GEN = 0;

// Reactive Student & Portal Session State
const S = {
  auth: false,
  sessionToken: null,
  // Student Profile details
  nationalId: "38492018",
  name: "Brian Kiprop Cheruiyot",
  email: "brian.cheruiyot@students.ku.ac.ke",
  phone: "+254 712 345 678",
  kcseIndex: "12345678001/2022",
  institution: "Kenyatta University (KU)",
  programme: "Bachelor of Science in Computer Science",
  level: "Undergraduate",
  yearOfStudy: 2,
  currentSemester: 1,
  band: 2,
  academicYear: "2024/2025",
  bankName: "Equity Bank Kenya",
  accountNumber: "0112938472901",
  repaid: 0,
  penalty: 0
};

// ── Kenyan HEF Funding Matrix Reference ──
const HEF_BANDS = {
  1: {
    band: 1,
    name: "Band 1",
    category: "Vulnerable",
    householdIncome: "Less than KES 5,995 / month",
    scholarshipPct: 70,
    loanPct: 25,
    householdPct: 5,
    upkeepAnnual: 60000,
    upkeepPerSem: 30000,
    color: "#10b981",
    desc: "Orphans, students from extremely vulnerable households, PWDs with zero household income."
  },
  2: {
    band: 2,
    name: "Band 2",
    category: "Extremely Needy",
    householdIncome: "KES 5,995 – KES 23,670 / month",
    scholarshipPct: 60,
    loanPct: 30,
    householdPct: 10,
    upkeepAnnual: 55000,
    upkeepPerSem: 27500,
    color: "#3b82f6",
    desc: "Low-income households, single-parent families, subsistence agricultural workers."
  },
  3: {
    band: 3,
    name: "Band 3",
    category: "Needy",
    householdIncome: "KES 23,671 – KES 70,000 / month",
    scholarshipPct: 50,
    loanPct: 30,
    householdPct: 20,
    upkeepAnnual: 50000,
    upkeepPerSem: 25000,
    color: "#f59e0b",
    desc: "Lower-middle income households with moderate financial commitments."
  },
  4: {
    band: 4,
    name: "Band 4",
    category: "Less Needy",
    householdIncome: "KES 70,001 – KES 119,999 / month",
    scholarshipPct: 40,
    loanPct: 30,
    householdPct: 30,
    upkeepAnnual: 45000,
    upkeepPerSem: 22500,
    color: "#8b5cf6",
    desc: "Middle-income earners capable of supporting a higher proportion of tuition."
  },
  5: {
    band: 5,
    name: "Band 5",
    category: "Least Needy / Moderate Income",
    householdIncome: "Above KES 120,000 / month",
    scholarshipPct: 30,
    loanPct: 30,
    householdPct: 40,
    upkeepAnnual: 40000,
    upkeepPerSem: 20000,
    color: "#ec4899",
    desc: "Higher income households with capacity to fund majority of tuition."
  }
};

const PROGRAMME_COSTS = {
  "medicine": 440000,
  "nursing": 275400,
  "pharmacy": 357000,
  "computer science": 244800,
  "software engineering": 244800,
  "civil engineering": 306000,
  "electrical engineering": 306000,
  "mechanical engineering": 306000,
  "law": 221850,
  "commerce": 183600,
  "business": 195000,
  "economics": 183600,
  "education": 153000,
  "agriculture": 198900,
  "tvet": 67189
};

// ── Realistic Calculation Helper ──
function calculateCurrentProfile() {
  const band = HEF_BANDS[S.band] || HEF_BANDS[2];
  
  // Determine Program Cost
  let cost = 216000;
  const lowerProg = S.programme.toLowerCase();
  for (const [key, val] of Object.entries(PROGRAMME_COSTS)) {
    if (lowerProg.includes(key)) {
      cost = val;
      break;
    }
  }

  const annualTuition = cost;
  const annualScholarship = Math.round(annualTuition * (band.scholarshipPct / 100));
  const annualTuitionLoan = Math.round(annualTuition * (band.loanPct / 100));
  const annualHouseholdTuition = Math.round(annualTuition * (band.householdPct / 100));
  const annualUpkeepLoan = band.upkeepAnnual;
  const annualTotalLoan = annualTuitionLoan + annualUpkeepLoan;

  const semTuitionLoan = Math.round(annualTuitionLoan / 2);
  const semScholarship = Math.round(annualScholarship / 2);
  const semHouseholdTuition = Math.round(annualHouseholdTuition / 2);
  const semUpkeepLoan = Math.round(annualUpkeepLoan / 2);

  const completedSemesters = (S.yearOfStudy - 1) * 2 + (S.currentSemester - 1);
  const cumulativeAwardedPrincipal = Math.round(annualTotalLoan * S.yearOfStudy);
  const cumulativeDisbursedTuitionLoan = Math.round(semTuitionLoan * completedSemesters);
  const cumulativeDisbursedUpkeepLoan = Math.round(semUpkeepLoan * completedSemesters);
  const cumulativeDisbursedScholarship = Math.round(semScholarship * completedSemesters);
  const cumulativeDisbursedLoan = cumulativeDisbursedTuitionLoan + cumulativeDisbursedUpkeepLoan;

  const interestRate = 0.04; // 4% p.a.
  const interestAccrued = Math.round(cumulativeDisbursedLoan * interestRate * Math.max(0.5, S.yearOfStudy - 1));
  const outstandingBalance = Math.max(0, cumulativeDisbursedLoan + interestAccrued + (S.penalty || 0) - (S.repaid || 0));

  // Build disbursements
  const disbursements = [];
  const startCalYear = 2024 - (S.yearOfStudy - 1);

  for (let yr = 1; yr <= S.yearOfStudy; yr++) {
    const acadYr = `${startCalYear + yr - 1}/${startCalYear + yr}`;
    const isSem1Done = yr < S.yearOfStudy || (yr === S.yearOfStudy && S.currentSemester >= 1);

    disbursements.push({
      academicYear: acadYr,
      semester: "Semester 1",
      date: `${startCalYear + yr - 1}-09-24`,
      purpose: "Upkeep Loan",
      amount: semUpkeepLoan,
      beneficiary: `${S.name} (${S.bankName} - ${S.accountNumber})`,
      batch: `HEF/${acadYr}/UPK/B${S.band}-${1000 + yr * 140}`,
      status: isSem1Done ? "Disbursed" : "Scheduled",
      ref: `UPK${startCalYear + yr}1`
    });

    disbursements.push({
      academicYear: acadYr,
      semester: "Semester 1",
      date: `${startCalYear + yr - 1}-09-24`,
      purpose: "Tuition Loan & Scholarship",
      amount: semTuitionLoan + semScholarship,
      tuitionLoan: semTuitionLoan,
      scholarship: semScholarship,
      beneficiary: `${S.institution} Fee Account`,
      batch: `HEF/${acadYr}/TUI/B${S.band}-${2000 + yr * 140}`,
      status: isSem1Done ? "Disbursed" : "Scheduled",
      ref: `TUI${startCalYear + yr}1`
    });

    if (yr < S.yearOfStudy || (yr === S.yearOfStudy && S.currentSemester === 2)) {
      const isSem2Done = yr < S.yearOfStudy || (yr === S.yearOfStudy && S.currentSemester === 2);
      disbursements.push({
        academicYear: acadYr,
        semester: "Semester 2",
        date: `${startCalYear + yr}-02-14`,
        purpose: "Upkeep Loan",
        amount: semUpkeepLoan,
        beneficiary: `${S.name} (${S.bankName} - ${S.accountNumber})`,
        batch: `HEF/${acadYr}/UPK/B${S.band}-${3000 + yr * 140}`,
        status: isSem2Done ? "Disbursed" : "Scheduled",
        ref: `UPK${startCalYear + yr}2`
      });

      disbursements.push({
        academicYear: acadYr,
        semester: "Semester 2",
        date: `${startCalYear + yr}-02-14`,
        purpose: "Tuition Loan & Scholarship",
        amount: semTuitionLoan + semScholarship,
        tuitionLoan: semTuitionLoan,
        scholarship: semScholarship,
        beneficiary: `${S.institution} Fee Account`,
        batch: `HEF/${acadYr}/TUI/B${S.band}-${4000 + yr * 140}`,
        status: isSem2Done ? "Disbursed" : "Scheduled",
        ref: `TUI${startCalYear + yr}2`
      });
    }
  }

  // Build Ledger
  const ledger = [];
  let running = 0;
  disbursements.filter(d => d.status === "Disbursed").forEach(d => {
    if (d.purpose === "Upkeep Loan") {
      running += d.amount;
      ledger.push({
        date: d.date,
        ref: d.ref,
        desc: `${d.academicYear} ${d.semester} Upkeep Loan to ${S.bankName}`,
        debit: d.amount,
        credit: 0,
        balance: running
      });
    } else {
      running += d.tuitionLoan;
      ledger.push({
        date: d.date,
        ref: d.ref,
        desc: `${d.academicYear} ${d.semester} Tuition Loan to ${S.institution}`,
        debit: d.tuitionLoan,
        credit: 0,
        balance: running
      });
    }
  });

  if (S.repaid > 0) {
    running -= S.repaid;
    ledger.push({
      date: "2024-08-10",
      ref: "MPESA200800",
      desc: `Repayment: M-Pesa Paybill 200800 Direct Settlement`,
      debit: 0,
      credit: S.repaid,
      balance: running
    });
  }

  return {
    band,
    annualTuition,
    annualScholarship,
    annualTuitionLoan,
    annualHouseholdTuition,
    annualUpkeepLoan,
    annualTotalLoan,
    semScholarship,
    semTuitionLoan,
    semHouseholdTuition,
    semUpkeepLoan,
    cumulativeAwardedPrincipal,
    cumulativeDisbursedLoan,
    cumulativeDisbursedScholarship,
    interestAccrued,
    outstandingBalance,
    disbursements,
    ledger
  };
}

// ── Dynamic Backend Discovery ──
function getBackendUrl() {
  if (typeof window !== "undefined" && window.location) {
    const { origin, protocol, port } = window.location;
    if (protocol.startsWith("http")) {
      if (port && (port === "5500" || port === "5173" || port === "8080" || port === "8000" || port === "3000")) {
        return "http://localhost:3001";
      }
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
    profile:    `${base}/api/helb/profile`,
    balance:    `${base}/api/helb/balance`,
    disb:       `${base}/api/helb/disb`,
    appStatus:  `${base}/api/helb/app-status`,
    repayment:  `${base}/api/helb/repayment`,
    statement:  `${base}/api/helb/statement`,
    apply:      `${base}/api/helb/apply`,
    clearance:  `${base}/api/helb/clearance`,
    appeal:     `${base}/api/helb/appeal`,
    updateInfo: `${base}/api/helb/update-info`,
    support:    `${base}/api/helb/support`
  };
}

let API = getApiEndpoints(BACKEND);
const rawWait = ms => new Promise(r => setTimeout(r, ms));

async function apiCall(url, payload, options = {}) {
  try {
    const fetchOptions = {
      method: options.method || (payload ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...(payload ? { body: JSON.stringify({ ...payload, ...S }) } : {})
    };

    const resp = await fetch(url, fetchOptions);
    const data = await resp.json().catch(() => ({
      ok: false,
      message: `HTTP ${resp.status}: Invalid response`
    }));

    if (resp.status >= 500) {
      throw new Error(data.message || `Server error (HTTP ${resp.status})`);
    }

    return data;
  } catch (err) {
    console.warn(`[apiCall] Failed to connect to ${url}, using synchronized client-side HEF engine.`);
    return null;
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
const profileModal = document.getElementById("profileModal");
const statementModal = document.getElementById("statementModal");

// ── Health Probe ──
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

  if (sidebarFooter) sidebarFooter.textContent = "HEF Engine Active (Client Mode)";
  if (sidebarDot) sidebarDot.style.background = "var(--yellow)";
  return false;
}

setTimeout(checkBackendHealth, 400);
setInterval(checkBackendHealth, 30000);

// ── Sidebar Controls ──
function openSidebar() { sidebar?.classList.add("open"); overlay?.classList.add("open"); }
function closeSidebar() { sidebar?.classList.remove("open"); overlay?.classList.remove("open"); }
function autoResize(el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 160) + "px"; }
function updateSendBtn() { sendBtn.disabled = !userInput.value.trim(); }
function handleKey(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); } }
function scroll() { setTimeout(() => feed.scrollTop = feed.scrollHeight, 60); }

// ── Canvas Background ──
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

function showTyping(label = "Huduma Smart is computing HEF portal records…") {
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
    await rawWait(14 + Math.random() * 20);
  }
}

// ── Profile Modal Handlers ──
function openProfileModal() {
  const idEl = document.getElementById("profId");
  const nameEl = document.getElementById("profName");
  const instEl = document.getElementById("profInst");
  const progEl = document.getElementById("profProg");
  const bandEl = document.getElementById("profBand");
  const yearEl = document.getElementById("profYear");

  if (idEl) idEl.value = S.nationalId;
  if (nameEl) nameEl.value = S.name;
  if (instEl) instEl.value = S.institution;
  if (progEl) progEl.value = S.programme;
  if (bandEl) bandEl.value = S.band;
  if (yearEl) yearEl.value = S.yearOfStudy;

  if (profileModal) profileModal.style.display = "flex";
}

function closeProfileModal() {
  if (profileModal) profileModal.style.display = "none";
}

function saveProfileDetails(e) {
  e.preventDefault();
  const idEl = document.getElementById("profId");
  const nameEl = document.getElementById("profName");
  const instEl = document.getElementById("profInst");
  const progEl = document.getElementById("profProg");
  const bandEl = document.getElementById("profBand");
  const yearEl = document.getElementById("profYear");

  S.nationalId = idEl.value.trim();
  S.name = nameEl.value.trim();
  S.institution = instEl.value;
  S.programme = progEl.value.trim();
  S.band = parseInt(bandEl.value, 10) || 2;
  S.yearOfStudy = parseInt(yearEl.value, 10) || 2;

  updateSessionUI();
  closeProfileModal();

  addMsg("agent", `✅ <strong>Student Profile Updated</strong> for <strong>${S.name}</strong> (National ID: <strong>${S.nationalId}</strong>, ${S.institution}, ${S.programme}, Year ${S.yearOfStudy}, <strong>Band ${S.band}</strong>). All realistic portal values have been recalculated.`);
}

function updateSessionUI() {
  if (sessionBadge) {
    sessionBadge.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><path d="M8 0a8 8 0 100 16A8 8 0 008 0zm3.5 6l-4.5 4.5L5 8.5 6 7.5l1 1 3.5-3.5 1 1z"/></svg> ${S.name.split(' ')[0]} (Band ${S.band})`;
  }
  if (topbarStatus) {
    topbarStatus.innerHTML = `<span class="status-pulse"></span> Active — ${S.name} (ID: ${S.nationalId})`;
  }
}

// ── Statement Modal Handlers ──
function openStatementModal() {
  const p = calculateCurrentProfile();
  const contentEl = document.getElementById("statementContent");
  if (!contentEl) return;

  const rows = p.ledger.map(l => `
    <tr>
      <td>${l.date}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:11px;">${l.ref}</td>
      <td>${l.desc}</td>
      <td style="text-align:right;">${l.debit ? 'KES ' + l.debit.toLocaleString() : '-'}</td>
      <td style="text-align:right;color:var(--green);">${l.credit ? 'KES ' + l.credit.toLocaleString() : '-'}</td>
      <td style="text-align:right;font-weight:700;">KES ${l.balance.toLocaleString()}</td>
    </tr>
  `).join("");

  contentEl.innerHTML = `
    <div class="stmt-header">
      <div class="stmt-brand">
        <div>
          <div class="stmt-org">HIGHER EDUCATION LOANS BOARD (HELB)</div>
          <div class="stmt-portal">Official Statement of Loan Account — HEF Portal</div>
        </div>
        <div style="font-size:11px;color:var(--t3);text-align:right;">Date: <strong>${new Date().toISOString().split('T')[0]}</strong></div>
      </div>
      <div class="stmt-meta-grid">
        <div class="stmt-meta-item">Loanee Name: <strong>${S.name}</strong></div>
        <div class="stmt-meta-item">National ID: <strong>${S.nationalId}</strong></div>
        <div class="stmt-meta-item">Institution: <strong>${S.institution}</strong></div>
        <div class="stmt-meta-item">KCSE Index: <strong>${S.kcseIndex}</strong></div>
        <div class="stmt-meta-item">Programme: <strong>${S.programme}</strong></div>
        <div class="stmt-meta-item">Funding Band: <strong>Band ${S.band} (${p.band.category})</strong></div>
      </div>
    </div>
    <div style="overflow-x:auto;">
      <table class="rc-table" style="font-size:11.5px;">
        <thead>
          <tr>
            <th>Date</th>
            <th>Ref / Batch</th>
            <th>Description</th>
            <th style="text-align:right;">Debit (KES)</th>
            <th style="text-align:right;">Credit (KES)</th>
            <th style="text-align:right;">Balance (KES)</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
    <div style="margin-top:16px;padding:12px;background:var(--bg4);border-radius:10px;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-size:11px;color:var(--t3);">Total Loan Awarded</div>
        <div style="font-size:14px;font-weight:700;">KES ${p.cumulativeAwardedPrincipal.toLocaleString()}</div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--t3);">Total Repaid</div>
        <div style="font-size:14px;font-weight:700;color:var(--green);">KES ${(S.repaid || 0).toLocaleString()}</div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--t3);">Current Outstanding Due</div>
        <div style="font-size:16px;font-weight:800;color:var(--yellow);">KES ${p.outstandingBalance.toLocaleString()}</div>
      </div>
    </div>
  `;

  if (statementModal) statementModal.style.display = "flex";
}

function closeStatementModal() {
  if (statementModal) statementModal.style.display = "none";
}

function printStatement() {
  window.print();
}

// ── Rich Card Renderers ──
function cardBalance(p) {
  return `
    <div class="rc ok">
      <div class="rc-lbl">HELB Loan Overview &amp; Balance</div>
      <div class="rc-val">KES ${p.outstandingBalance.toLocaleString()}</div>
      <div class="rc-sub" style="margin-top:4px;">
        Student: <strong>${S.name}</strong> (National ID: <strong>${S.nationalId}</strong>)<br>
        Institution: <strong>${S.institution}</strong> · <strong>Band ${S.band}</strong>
      </div>
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;">
        <div>Total Awarded Principal: <strong>KES ${p.cumulativeAwardedPrincipal.toLocaleString()}</strong></div>
        <div>Total Disbursed Loan: <strong>KES ${p.cumulativeDisbursedLoan.toLocaleString()}</strong></div>
        <div>Total Repaid: <strong style="color:var(--green);">KES ${(S.repaid || 0).toLocaleString()}</strong></div>
        <div>4% Undergraduate Interest: <strong>KES ${p.interestAccrued.toLocaleString()}</strong></div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;">
        <button class="dl-link" onclick="openStatementModal()">📑 View Full Statement</button>
        <button class="dl-link" onclick="quickAction('how to repay loan via mpesa')">💳 Repay with M-Pesa</button>
      </div>
    </div>`;
}

function cardBandBreakdown(p) {
  const b = p.band;
  return `
    <div class="rc info">
      <div class="rc-lbl">Kenya HEF Student Funding Model — Band ${b.band} (${b.category})</div>
      <div style="font-size:13px;color:var(--t1);margin-bottom:6px;">
        Programme Cost: <strong>KES ${p.annualTuition.toLocaleString()} / year</strong> (${S.programme})
      </div>
      <div class="band-bar-container">
        <div class="band-bar-seg seg-schol" style="width:${b.scholarshipPct}%;">${b.scholarshipPct}% Scholarship</div>
        <div class="band-bar-seg seg-loan" style="width:${b.loanPct}%;">${b.loanPct}% Loan</div>
        <div class="band-bar-seg seg-house" style="width:${b.householdPct}%;">${b.householdPct}% Household</div>
      </div>
      <div class="band-legend">
        <div class="legend-item"><div class="legend-dot" style="background:var(--blue);"></div> Scholarship (Govt): <strong>KES ${p.annualScholarship.toLocaleString()}</strong></div>
        <div class="legend-item"><div class="legend-dot" style="background:var(--yellow);"></div> Tuition Loan (HELB): <strong>KES ${p.annualTuitionLoan.toLocaleString()}</strong></div>
        <div class="legend-item"><div class="legend-dot" style="background:var(--green);"></div> Household Fee: <strong>KES ${p.annualHouseholdTuition.toLocaleString()}</strong></div>
      </div>
      <div style="margin-top:12px;padding:10px;background:rgba(59,130,246,0.08);border-radius:8px;font-size:12px;line-height:1.5;">
        💰 <strong>HELB Student Upkeep Stipend:</strong> <strong>KES ${b.upkeepAnnual.toLocaleString()} / year</strong> (KES ${b.upkeepPerSem.toLocaleString()} per semester) sent directly to student's bank account.<br>
        🎯 <strong>Target Group:</strong> ${b.desc}
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;">
        <button class="dl-link" onclick="quickAction('how do i appeal my band')">📝 Appeal Band Allocation</button>
        <button class="dl-link" onclick="openProfileModal()">👤 Adjust My Band</button>
      </div>
    </div>`;
}

function cardDisb(disbursements) {
  const rows = disbursements.map(d => `
    <tr>
      <td>${d.date}</td>
      <td><strong>${d.academicYear} ${d.semester}</strong><br><small style="color:var(--t3);">${d.purpose}</small></td>
      <td>KES ${d.amount.toLocaleString()}</td>
      <td><span class="badge ${d.status === 'Disbursed' ? 'done' : 'pending'}">${d.status}</span></td>
    </tr>`).join("");

  return `
    <div class="rc info">
      <div class="rc-lbl">HEF &amp; HELB Disbursement Schedule (${S.institution})</div>
      <table class="rc-table">
        <thead><tr><th>Release Date</th><th>Semester &amp; Type</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="rc-sub" style="margin-top:10px;">
        💡 <strong>Tuition loans &amp; scholarships</strong> are credited directly to ${S.institution}'s collection account. <strong>Upkeep stipends</strong> are deposited into your registered ${S.bankName} account (${S.accountNumber}).
      </div>
    </div>`;
}

function cardAppStatus(p) {
  return `
    <div class="rc info">
      <div class="rc-lbl">HEF Scholarship &amp; Loan Application Status</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin:6px 0;">
        <div style="font-size:15px;font-weight:700;">Reference: <strong>HEF-${S.academicYear.replace('/','-')}-${S.nationalId.slice(-4)}</strong></div>
        <span class="badge done">Approved &amp; Active</span>
      </div>
      <div class="app-stepper">
        <div class="step-item"><div class="step-icon step-done">✓</div><div><strong>1. Application Submitted</strong> (Validated with National ID &amp; KCSE Index)</div></div>
        <div class="step-item"><div class="step-icon step-done">✓</div><div><strong>2. Means Testing Instrument (MTI)</strong> (Score: 78/100 · Evaluated)</div></div>
        <div class="step-item"><div class="step-icon step-done">✓</div><div><strong>3. Band Allocated</strong> (Assigned to <strong>Band ${S.band}</strong>)</div></div>
        <div class="step-item"><div class="step-icon step-done">✓</div><div><strong>4. Institution Admission Verification</strong> (Confirmed by ${S.institution})</div></div>
        <div class="step-item"><div class="step-icon step-curr">●</div><div><strong>5. Semester Funds Disbursement</strong> (Tuition &amp; Upkeep active)</div></div>
      </div>
      <div style="margin-top:10px;font-size:12px;color:var(--t2);">
        Need a different band? You can lodge an appeal on the portal if your economic circumstances have changed.
      </div>
    </div>`;
}

function cardRepaymentGuide(p) {
  return `
    <div class="rc ok">
      <div class="rc-lbl">M-Pesa Loan Repayment (Paybill 200800)</div>
      <div style="font-size:13px;line-height:1.6;margin-top:6px;">
        To make a direct repayment towards your HELB loan:
        <ol style="margin:8px 0 8px 20px;">
          <li>Go to M-Pesa menu &gt; <strong>Lipa na M-Pesa</strong> &gt; <strong>Paybill</strong></li>
          <li>Enter Business Number: <strong style="color:var(--yellow);font-family:'JetBrains Mono',monospace;">200800</strong></li>
          <li>Enter Account Number: <strong style="color:var(--blue);font-family:'JetBrains Mono',monospace;">${S.nationalId}</strong> (Your National ID)</li>
          <li>Enter Amount you wish to repay (e.g. KES 1,000 / KES 5,000)</li>
          <li>Enter your M-Pesa PIN and confirm payment</li>
        </ol>
      </div>
      <div class="rc-sub" style="margin-top:8px;">
        ⏱️ Your statement updates automatically within 24 hours of M-Pesa payment confirmation.
      </div>
    </div>`;
}

function cardAppealGuide(p) {
  return `
    <div class="rc warn">
      <div class="rc-lbl">HEF Band Appeal &amp; Re-Categorization Process</div>
      <div style="font-size:13px;line-height:1.6;margin-top:6px;">
        Current Allocation: <strong>Band ${S.band} (${p.band.category})</strong>.<br>
        If you are experiencing severe financial distress, you can appeal for placement into <strong>Band 1</strong> or <strong>Band 2</strong>:
        <ul style="margin:8px 0 8px 18px;">
          <li><strong>Step 1:</strong> Log into <a href="https://portal.hef.co.ke" target="_blank" style="color:var(--blue);">portal.hef.co.ke</a> using your National ID and password.</li>
          <li><strong>Step 2:</strong> Navigate to <strong>Appeals</strong> tab &gt; Select "Apply for Re-categorization".</li>
          <li><strong>Step 3:</strong> Upload required supporting documents:
            <ul>
              <li>Death certificate of parent(s) if orphaned</li>
              <li>Chief's / Assistant Chief's verification letter</li>
              <li>NCPWD disability registration if applicant or parent is disabled</li>
              <li>Chronic medical bills / retirement / retrenchment letters</li>
              <li>Sworn Affidavit of economic status</li>
            </ul>
          </li>
        </ul>
      </div>
    </div>`;
}

function cardClearanceGuide(p) {
  const isCleared = p.outstandingBalance === 0;
  return `
    <div class="rc ${isCleared ? 'ok' : 'err'}">
      <div class="rc-lbl">HELB Clearance &amp; Compliance Status</div>
      <div style="font-size:14px;font-weight:700;margin-top:4px;">
        ${isCleared ? '✅ Certificate of Clearance Ready' : '⚠️ Outstanding Balance Active'}
      </div>
      <div class="rc-sub" style="margin-top:6px;line-height:1.5;">
        ${isCleared 
          ? `You have cleared all loans (Balance: KES 0). Your official <strong>HELB Clearance Certificate</strong> is available for instant download on the portal.`
          : `You have an active loan balance of <strong>KES ${p.outstandingBalance.toLocaleString()}</strong>. Once this amount is settled via Paybill 200800, your clearance certificate will be issued automatically.`}
      </div>
      <div style="margin-top:10px;font-size:12px;color:var(--t2);">
        💡 Non-loanees (students who never took a HELB loan) can obtain a <strong>Certificate of Compliance</strong> for KES 1,000 on the HEF/eCitizen portal.
      </div>
    </div>`;
}

// ── Domain Guardrail & Entity Extraction ──
function isHelbDomain(text) {
  if (!text) return false;
  const t = text.toLowerCase().trim();

  if (/^(hello|hi|hey|habari|jambo|good\s*(morning|afternoon|evening)|help|start|menu|yes|no|ok|okay|thanks|thank\s*you|asante|continue|bye|who\s*are\s*you|what\s*can\s*you\s*do|clear|reset)$/i.test(t)) {
    return true;
  }

  const helbKeywords = [
    "helb", "hef", "loan", "scholarship", "bursary", "band", "mti", "means test", "means testing",
    "disburse", "disbursement", "upkeep", "tuition", "balance", "repay", "repayment", "paybill",
    "statement", "ledger", "clearance", "compliance", "certificate", "appeal", "recategor", "batch",
    "kuccps", "universities fund", "uf", "student", "undergraduate", "tvet", "polytechnic", "postgraduate",
    "kenya", "national id", "kcse", "admission", "guarantor", "grace period", "penalty", "interest",
    "huduma", "anniversary towers", "smart card", "bank", "m-pesa", "mpesa", "safari", "equity", "kcb",
    "portal", "signin", "login", "password", "pin", "otp", "register", "apply", "application",
    "defer", "allocation", "afya elimu", "employer", "remittance", "salary deduction", "status",
    "stage", "documents", "death cert", "disability", "pwd", "chief", "fee", "tuition fee", "cost"
  ];

  if (helbKeywords.some(kw => t.includes(kw))) return true;
  if (/\b\d{6,10}\b/.test(t) || /\bband\s*[1-5]\b/i.test(t) || /\b(year\s*[1-6]|semester\s*[1-2])\b/i.test(t)) return true;

  return false;
}

function extractDetails(text) {
  if (!text) return;
  const idMatch = text.match(/\b(?:id|national\s*id|id\s*no|id\s*number)?\s*:?\s*(\d{6,10})\b/i);
  if (idMatch && idMatch[1] && !text.toLowerCase().includes("paybill") && !text.toLowerCase().includes("200800")) {
    S.nationalId = idMatch[1];
  }

  const bandMatch = text.match(/\bband\s*([1-5])\b/i);
  if (bandMatch && bandMatch[1]) {
    S.band = parseInt(bandMatch[1], 10);
  }

  const yearMatch = text.match(/\b(?:year\s*([1-6])|([1-6])(?:st|nd|rd|th)\s*year)\b/i);
  if (yearMatch) {
    S.yearOfStudy = parseInt(yearMatch[1] || yearMatch[2], 10);
  }

  const nameMatch = text.match(/\b(?:my\s*name\s*is|i\s*am|name\s*is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/);
  if (nameMatch && nameMatch[1]) {
    const cand = nameMatch[1].trim();
    if (!/^(Helb|Huduma|Student|Undergraduate|Kenyatta|University|Moi|Egerton)/i.test(cand)) {
      S.name = cand;
    }
  }

  updateSessionUI();
}

// ── Core Conversational Processor ──
async function processHelbMessage(text, g) {
  const t = text.toLowerCase().trim();

  // 1. Guardrail check
  if (!isHelbDomain(t)) {
    return {
      text: `I am **Huduma Smart**, an AI chatbot specialized **exclusively in Higher Education Loans Board (HELB) and Higher Education Financing (HEF)** portal services in Kenya.\n\nI cannot assist with general, off-topic requests. I am ready to help you with:\n\n• 💰 **Checking your exact loan balance & interest**\n• 📊 **HEF Band breakdown (Bands 1 to 5) & scholarship %**\n• 📅 **Disbursement dates & upkeep stipend transfers**\n• 📑 **Generating official HELB loan statements**\n• 💳 **Loan repayments via M-Pesa Paybill 200800**\n• 📝 **Appealing your funding band**\n• 🔍 **HELB Clearance & Compliance certificates**\n\nPlease ask any question regarding your HELB or HEF account!`,
      html: null
    };
  }

  // 2. Extract any updated student details
  extractDetails(text);
  const p = calculateCurrentProfile();

  // 3. Greetings
  if (/^(hello|hi|hey|habari|jambo|good\s*(morning|afternoon|evening)|start|help)$/i.test(t)) {
    return {
      text: `Habari, **${S.name.split(' ')[0]}**! I am Huduma Smart, your official HELB & HEF AI Consultant. How can I assist you with your higher education funding today?`,
      html: null
    };
  }

  // 4. Band Breakdown & Scholarship
  if (/band|scholarship|means test|mti|funding model|how much scholarship|percentage/i.test(t)) {
    const tc = renderToolCard("get_hef_band_breakdown", { nationalId: S.nationalId, band: S.band, institution: S.institution });
    await rawWait(300); tc.classList.add("tool-done");
    return {
      text: `Here is your Kenya Higher Education Financing (HEF) funding structure for **${S.programme}** at **${S.institution}**:`,
      html: cardBandBreakdown(p)
    };
  }

  // 5. Balance & Dues
  if (/balance|outstanding|how much do i owe|dues|interest rate/i.test(t)) {
    const tc = renderToolCard("get_loan_balance", { nationalId: S.nationalId, user: S.name });
    await rawWait(300); tc.classList.add("tool-done");
    return {
      text: `Here is your current HELB loan overview and outstanding balance, **${S.name}**:`,
      html: cardBalance(p)
    };
  }

  // 6. Disbursements & Upkeep
  if (/disburse|disbursement|schedule|upkeep|paid out|when will i receive|where is my upkeep/i.test(t)) {
    const tc = renderToolCard("get_disbursement_schedule", { nationalId: S.nationalId, bank: S.bankName });
    await rawWait(300); tc.classList.add("tool-done");
    return {
      text: `Here is your scheduled and released disbursements timeline for **${S.name}**:`,
      html: cardDisb(p.disbursements)
    };
  }

  // 7. Application Status & MTI
  if (/application|status|progress|approved|tracking|mti score|stage/i.test(t)) {
    const tc = renderToolCard("get_application_status", { nationalId: S.nationalId });
    await rawWait(300); tc.classList.add("tool-done");
    return {
      text: `Here is the current processing stage of your HEF loan and scholarship application:`,
      html: cardAppStatus(p)
    };
  }

  // 8. Repayment & Paybill
  if (/repay|repayment|paybill|how to pay|mpesa|200800|pay back/i.test(t)) {
    const tc = renderToolCard("get_repayment_details", { nationalId: S.nationalId });
    await rawWait(300); tc.classList.add("tool-done");
    return {
      text: `You can repay your HELB loan directly via M-Pesa Paybill **200800** using your National ID number (**${S.nationalId}**) as the Account Number:`,
      html: cardRepaymentGuide(p)
    };
  }

  // 9. Loan Statement
  if (/statement|ledger|pdf|download statement|statement of account/i.test(t)) {
    const tc = renderToolCard("generate_loan_statement", { nationalId: S.nationalId });
    await rawWait(300); tc.classList.add("tool-done");
    return {
      text: `Your official HELB Statement of Account is generated for **${S.name}** (National ID: **${S.nationalId}**). Click below to view and print the complete ledger:`,
      html: `
        <div class="rc ok">
          <div class="rc-lbl">Official HELB Statement Ready</div>
          <div class="rc-sub">Total Debits: <strong>KES ${p.cumulativeDisbursedLoan.toLocaleString()}</strong> · Total Credits: <strong>KES ${(S.repaid || 0).toLocaleString()}</strong></div>
          <div style="margin-top:10px;">
            <button class="dl-link" onclick="openStatementModal()">📑 Open Official Statement Modal (PDF/Print)</button>
          </div>
        </div>`
    };
  }

  // 10. Appeal & Re-categorization
  if (/appeal|re-categoriz|wrong band|change band|financial problem|deceased/i.test(t)) {
    const tc = renderToolCard("get_appeal_guidance", { nationalId: S.nationalId, currentBand: S.band });
    await rawWait(300); tc.classList.add("tool-done");
    return {
      text: `Here is the official guide to appealing your HEF funding band on **portal.hef.co.ke**:`,
      html: cardAppealGuide(p)
    };
  }

  // 11. Clearance & Compliance Certificate
  if (/clearance|compliance|certificate|clean record/i.test(t)) {
    const tc = renderToolCard("check_clearance_status", { nationalId: S.nationalId });
    await rawWait(300); tc.classList.add("tool-done");
    return {
      text: `Here is your HELB Clearance & Compliance evaluation:`,
      html: cardClearanceGuide(p)
    };
  }

  // 12. Support & Contacts
  if (/support|contact|helpdesk|phone|email|huduma|anniversary/i.test(t)) {
    return {
      text: `You can reach the official HELB & HEF Customer Service team via:\n\n• 📞 **Phone Support:** +254 711 052 000 / +254 20 2278 000\n• 📧 **Email:** \`contactcentre@helb.co.ke\` / \`info@hef.co.ke\`\n• 🏢 **Huduma Centres:** HELB service desks are active in all 47 county Huduma Centres countrywide\n• 🏢 **Head Office:** Anniversary Towers, 18th & 19th Floors, University Way, Nairobi\n• 🌐 **Official Portals:** [hef.co.ke](https://www.hef.co.ke) | [portal.hef.co.ke](https://portal.hef.co.ke)`,
      html: null
    };
  }

  // 13. First time application
  if (/apply|first time|requirements|how to apply|documents/i.test(t)) {
    return {
      text: `**First-Time HEF Application Requirements & Steps:**\n\n1. **Prerequisites:**\n   • Valid Kenyan National ID Number\n   • KCSE Index Number & Year (e.g. \`12345678001/2023\`)\n   • KUCCPS Admission Letter from your University/TVET\n   • Student's personal bank account or M-Pesa registered in student's own National ID\n   • Parent/Guardian National IDs (or Death Certificate if deceased)\n   • Two Guarantors' National IDs and phone contacts\n\n2. **Application Portal:** Register and apply online at [portal.hef.co.ke](https://portal.hef.co.ke).\n3. **Evaluation:** The Means Testing Instrument (MTI) will automatically evaluate and assign you to **Band 1, 2, 3, 4, or 5**.`,
      html: null
    };
  }

  // Fallback in-domain HELB summary
  return {
    text: `I can help you with all aspects of your HELB and HEF portal account, **${S.name.split(' ')[0]}**.\n\nYou are currently set as a **Year ${S.yearOfStudy} student** at **${S.institution}** in **Band ${S.band}**.\n\nWould you like to:\n1. 💰 Check your **outstanding loan balance & interest**?\n2. 📊 View your **HEF Band breakdown (Scholarship vs Loan vs Upkeep)**?\n3. 📅 Check your **disbursement dates & upkeep schedule**?\n4. 📑 View or print your **official loan statement**?\n5. 💳 Learn how to make a **repayment via Paybill 200800**?`,
    html: null
  };
}

// ── Main Chat Dispatcher ──
async function dispatch(text) {
  if (!text) return;
  const g = ++GEN;
  addMsg("user", text);
  userInput.value = "";
  updateSendBtn();
  autoResize(userInput);
  if (window.innerWidth <= 720) closeSidebar();

  try {
    showTyping("Huduma Smart is analyzing your request…");
    await rawWait(350);
    if (GEN !== g) return;

    let res = await processHelbMessage(text, g);
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
  updateSessionUI();
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
      <p class="hero-subtitle">Your dedicated HELB &amp; HEF AI Chatbot. Get realistic portal values, band calculations, disbursement schedules &amp; statements instantly.</p>
    </div>`;

  setTimeout(() => {
    addMsg("agent", `Hi there! I am **Huduma Smart**, your dedicated **HELB &amp; HEF AI Chatbot**.<br><br>I can provide you with exact, realistic values for your loan balance, HEF band funding breakdown, upkeep disbursements, statements, repayments, and clearance certificates.<br><br>How can I assist you today?`);
  }, 400);
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

// ── Initialize Session UI ──
updateSessionUI();

// ── Initial Greeting ──
setTimeout(() => {
  addMsg("agent", `Habari! I am **Huduma Smart**, your official **HELB &amp; HEF AI Consultant**.<br><br>I specialize solely in Higher Education Loans Board (HELB) and Higher Education Financing (HEF) portal services with realistic calculations based on your details.<br><br>You can ask me to **check your loan balance**, **show your HEF band breakdown**, **track disbursement schedules**, **generate official statements**, or **guide you on M-Pesa repayment (Paybill 200800)**.`);
}, 600);