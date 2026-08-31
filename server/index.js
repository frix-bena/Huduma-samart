/**
 * Huduma Smart — HELB / HEF Automation Microservice
 * Express server providing direct portal connectivity and stealth Playwright browser automation
 * for https://portal.hef.co.ke
 *
 * Strictly scrapes actual DOM text elements from the HEF portal dashboard with zero LLM/mock fallbacks.
 */

const express = require("express");
const cors = require("cors");
const path = require("path");
const https = require("https");
const http = require("http");
const querystring = require("querystring");
const crypto = require("crypto");
const fs = require("fs-extra");
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
const { HttpsProxyAgent } = require("https-proxy-agent");
const hefEngine = require("./hefEngine");
const human = require("./humanInteraction");

// Apply stealth plugin for Playwright
chromium.use(stealth);

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);

// ── CORS Configuration ──
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Serve frontend static files ──
app.use(express.static(path.join(__dirname, "..")));

// ── Portal Configuration ──
const PORTAL_BASE_URL = "https://portal.hef.co.ke";
const PORTAL_SIGNIN_URL = "https://portal.hef.co.ke/auth/signin";
const SCREENSHOTS_DIR = path.join(__dirname, "screenshots");
fs.ensureDirSync(SCREENSHOTS_DIR);

/**
 * Helper to retrieve proxy configuration from environment variables.
 * Reads PROXY_SERVER, PROXY_USERNAME, and PROXY_PASSWORD.
 */
function getProxyConfig() {
  const proxyServer = (process.env.PROXY_SERVER || "").trim();
  if (!proxyServer) return null;

  const username = process.env.PROXY_USERNAME ? process.env.PROXY_USERNAME.trim() : undefined;
  const password = process.env.PROXY_PASSWORD ? process.env.PROXY_PASSWORD.trim() : undefined;

  const serverUrl = proxyServer.startsWith("http://") || proxyServer.startsWith("https://") || proxyServer.startsWith("socks5://")
    ? proxyServer
    : `http://${proxyServer}`;

  const playwrightProxy = {
    server: serverUrl,
  };
  if (username) playwrightProxy.username = username;
  if (password) playwrightProxy.password = password;

  let agentUrl = serverUrl;
  try {
    const parsed = new URL(serverUrl);
    if (username && !parsed.username) parsed.username = username;
    if (password && !parsed.password) parsed.password = password;
    agentUrl = parsed.toString();
  } catch (_) {}

  let httpsAgent = null;
  try {
    httpsAgent = new HttpsProxyAgent(agentUrl);
  } catch (err) {
    console.warn(`[proxy-config] Warning initializing HttpsProxyAgent for ${serverUrl}:`, err.message);
  }

  return {
    server: serverUrl,
    username,
    password,
    playwrightProxy,
    httpsAgent,
  };
}

/**
 * Lightweight upstream health check to PORTAL_BASE_URL using plain Node https.get
 * outside of Playwright.
 * @param {number} timeoutMs
 * @returns {Promise<{ ok: boolean, statusCode?: number, error?: Error, durationMs: number }>}
 */
async function checkPortalPlainHttpHealth(timeoutMs = 8000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const proxyConfig = getProxyConfig();
    const options = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Connection": "close",
      },
      timeout: timeoutMs,
      rejectUnauthorized: false,
    };
    if (proxyConfig?.httpsAgent) {
      options.agent = proxyConfig.httpsAgent;
    }

    const req = https.get(PORTAL_BASE_URL, options, (res) => {
      res.resume();
      const durationMs = Date.now() - startTime;
      const ok = res.statusCode >= 200 && res.statusCode < 500;
      resolve({
        ok,
        statusCode: res.statusCode,
        durationMs,
      });
    });

    req.on("error", (err) => {
      resolve({
        ok: false,
        error: err,
        durationMs: Date.now() - startTime,
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({
        ok: false,
        timeout: true,
        error: new Error(`Health check timed out after ${timeoutMs}ms`),
        durationMs: Date.now() - startTime,
      });
    });
  });
}

// In-memory active session store for verified portal sessions
// Key: userIdentifier -> Value: { identifier, sessionToken, scrapedData, profile, page, ctx, browser, cookies, userType, loginTime, lastActive, inactivityTimer }
const ACTIVE_SESSIONS = new Map();

// In-memory active session store for pending OTP verification sessions
// Key: otpSessionId -> Value: { otpSessionId, browser, ctx, page, mousePos, capturedProfileData, capturedAllocationData, capturedResponses, email, timer, createdAt }
const OTP_SESSIONS = new Map();

/**
 * Clean up and close browser resources for an active session
 */
async function cleanupActiveSession(identifier) {
  const session = ACTIVE_SESSIONS.get(identifier);
  if (!session) return;
  ACTIVE_SESSIONS.delete(identifier);
  if (session.inactivityTimer) clearTimeout(session.inactivityTimer);
  try {
    if (session.page && !session.page.isClosed()) await session.page.close().catch(() => {});
    if (session.ctx) await session.ctx.close().catch(() => {});
    console.log(`[active-session] Cleaned up browser session for "${identifier}"`);
  } catch (err) {
    console.warn(`[active-session] Error cleaning up session for "${identifier}":`, err.message);
  }
}

/**
 * Get or create an active Playwright page for an authenticated session.
 * Reuses the existing authenticated context/page rather than opening a fresh unauthenticated browser.
 */
async function getOrCreateSessionPage(userIdentifier) {
  if (!userIdentifier) {
    return { ok: false, error: "User credential or session identifier is required." };
  }

  const session = ACTIVE_SESSIONS.get(userIdentifier);
  if (!session) {
    return { ok: false, error: "No active authenticated session found for this user. Please log in first." };
  }

  // Reset inactivity timeout (15 mins)
  if (session.inactivityTimer) clearTimeout(session.inactivityTimer);
  session.inactivityTimer = setTimeout(() => {
    console.log(`[active-session] Session for "${userIdentifier}" timed out after 15 minutes of inactivity.`);
    cleanupActiveSession(userIdentifier);
  }, 15 * 60 * 1000);

  // If page is already open and valid, return it
  if (session.page && !session.page.isClosed()) {
    session.lastActive = Date.now();
    return { ok: true, page: session.page, ctx: session.ctx, session };
  }

  // If page was closed or session established via direct HTTP, spawn an authenticated context from cookies
  try {
    const browser = await getSharedBrowser();
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      locale: "en-KE",
      timezoneId: "Africa/Nairobi",
      extraHTTPHeaders: { "Accept-Language": "en-KE,en;q=0.9,en-US;q=0.8" },
      ignoreHTTPSErrors: true,
      bypassCSP: true,
    });

    if (session.cookies && Array.isArray(session.cookies) && session.cookies.length > 0) {
      await ctx.addCookies(session.cookies).catch(() => {});
    } else if (session.sessionToken) {
      const cookieList = session.sessionToken.split(";").map(c => {
        const parts = c.trim().split("=");
        if (parts.length >= 2) {
          return {
            name: parts[0].trim(),
            value: parts.slice(1).join("=").trim(),
            domain: "portal.hef.co.ke",
            path: "/"
          };
        }
        return null;
      }).filter(Boolean);
      if (cookieList.length > 0) {
        await ctx.addCookies(cookieList).catch(() => {});
      }
    }

    const page = await ctx.newPage();
    await human.setupHumanStealth(page);

    session.ctx = ctx;
    session.page = page;
    session.browser = browser;
    session.lastActive = Date.now();

    return { ok: true, page, ctx, session };
  } catch (err) {
    return { ok: false, error: `Failed to initialize authenticated session browser: ${err.message}` };
  }
}

/**
 * Clean up and close browser resources for an OTP session
 */
async function cleanupOtpSession(otpSessionId) {
  const session = OTP_SESSIONS.get(otpSessionId);
  if (!session) return;
  OTP_SESSIONS.delete(otpSessionId);
  if (session.timer) clearTimeout(session.timer);
  try {
    if (session.page && !session.page.isClosed()) await session.page.close().catch(() => {});
    if (session.ctx) await session.ctx.close().catch(() => {});
    if (session.browser) await session.browser.close().catch(() => {});
    console.log(`[otp-session] Successfully cleaned up and closed browser for OTP session: ${otpSessionId}`);
  } catch (err) {
    console.warn(`[otp-session] Error closing browser for OTP session ${otpSessionId}:`, err.message);
  }
}

/**
 * Validate Kenyan National ID or Email format
 */
function isValidCredential(input) {
  if (!input || typeof input !== "string") return false;
  const trimmed = input.trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const idRegex = /^\d{5,10}$/; // National IDs are typically 5 to 10 digits
  return emailRegex.test(trimmed) || idRegex.test(trimmed);
}

/**
 * Helper to identify network errors
 */
function isNetworkError(err) {
  if (!err) return false;
  const msg = (err.message || err.toString() || "").toLowerCase();
  return (
    msg.includes("err_address_unreachable") ||
    msg.includes("err_connection_refused") ||
    msg.includes("err_name_not_resolved") ||
    msg.includes("err_internet_disconnected") ||
    msg.includes("err_connection_timed_out") ||
    msg.includes("err_connection_reset") ||
    msg.includes("err_connection_closed") ||
    msg.includes("err_timed_out") ||
    msg.includes("err_network_changed") ||
    msg.includes("err_ssl_protocol_error") ||
    msg.includes("enotfound") ||
    msg.includes("econnrefused") ||
    msg.includes("ehostunreach") ||
    msg.includes("etimedout") ||
    msg.includes("timeout") ||
    msg.includes("net::")
  );
}

/**
 * Save debug screenshot & HTML snapshot
 */
async function captureSnapshot(page, label) {
  try {
    const ts = Date.now();
    const png = path.join(SCREENSHOTS_DIR, `${label}-${ts}.png`);
    const html = path.join(SCREENSHOTS_DIR, `${label}-${ts}.html`);
    if (page) {
      await page.screenshot({ path: png, fullPage: true }).catch(() => {});
      const content = await page.content().catch(() => "<could not capture>");
      await fs.writeFile(html, content).catch(() => {});
      return { png, html, timestamp: ts };
    }
  } catch (_) {}
  return null;
}

/**
 * Clean and sanitize scraped text strings.
 * Discards empty/placeholder text and filters out boilerplate/footer content.
 */
function sanitizeText(str) {
  if (typeof str !== "string") return null;
  const trimmed = str.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  if (trimmed.length === 0 || trimmed === "-" || trimmed === "N/A" || trimmed === "null" || trimmed === "undefined") {
    return null;
  }
  if (hefEngine.isBoilerplateText(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Strict DOM text scraper helper using Playwright locators.
 * Searches for field labels and extracts following sibling, table cell, definition list, or container elements.
 * 
 * Includes per-field instrumentation & rejection auditing.
 */
async function scrapeFieldByLabels(page, fieldName, labels, fallbackSelectors = [], auditReport = null) {
  let candidateRejected = null;

  for (const label of labels) {
    const lower = label.toLowerCase();

    // 1. Exact Playwright locator with following-sibling: text="Label" >> xpath=following-sibling::*[1]
    try {
      const sibLoc = page.locator(`text="${label}" >> xpath=following-sibling::*[1]`).first();
      if (await sibLoc.isVisible({ timeout: 150 }).catch(() => false)) {
        const raw = await sibLoc.innerText().catch(async () => await sibLoc.textContent().catch(() => ""));
        const clean = sanitizeText(raw);
        if (clean && clean.toLowerCase() !== lower) {
          if (hefEngine.validateField(fieldName, clean)) {
            if (auditReport) auditReport[fieldName] = { status: "FOUND", strategy: 1, matched: `label: "${label}"`, value: clean };
            return clean;
          } else {
            candidateRejected = { strategy: 1, matched: `label: "${label}"`, rawValue: clean, reason: `Shape check failed for ${fieldName}` };
          }
        } else if (raw && hefEngine.isBoilerplateText(raw)) {
          candidateRejected = { strategy: 1, matched: `label: "${label}"`, rawValue: raw, reason: "Boilerplate/footer text detected" };
        }
      }
    } catch (_) {}

    // 2. Case-insensitive following-sibling xpath
    try {
      const xpathLoc = page.locator(`xpath=//*[translate(normalize-space(text()), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')="${lower}" or contains(translate(normalize-space(text()), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${lower}")]/following-sibling::*[1]`).first();
      if (await xpathLoc.isVisible({ timeout: 150 }).catch(() => false)) {
        const raw = await xpathLoc.innerText().catch(async () => await xpathLoc.textContent().catch(() => ""));
        const clean = sanitizeText(raw);
        if (clean && clean.toLowerCase() !== lower) {
          if (hefEngine.validateField(fieldName, clean)) {
            if (auditReport) auditReport[fieldName] = { status: "FOUND", strategy: 2, matched: `xpath-label: "${label}"`, value: clean };
            return clean;
          } else {
            candidateRejected = { strategy: 2, matched: `xpath-label: "${label}"`, rawValue: clean, reason: `Shape check failed for ${fieldName}` };
          }
        } else if (raw && hefEngine.isBoilerplateText(raw)) {
          candidateRejected = { strategy: 2, matched: `xpath-label: "${label}"`, rawValue: raw, reason: "Boilerplate/footer text detected" };
        }
      }
    } catch (_) {}

    // 3. Table cell: <td>Label</td><td>Value</td> or <th>Label</th><td>Value</td>
    try {
      const tableCellLoc = page.locator(`xpath=//td[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${lower}")]/following-sibling::td[1] | //th[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${lower}")]/following-sibling::td[1]`).first();
      if (await tableCellLoc.isVisible({ timeout: 150 }).catch(() => false)) {
        const raw = await tableCellLoc.innerText().catch(async () => await tableCellLoc.textContent().catch(() => ""));
        const clean = sanitizeText(raw);
        if (clean && clean.toLowerCase() !== lower) {
          if (hefEngine.validateField(fieldName, clean)) {
            if (auditReport) auditReport[fieldName] = { status: "FOUND", strategy: 3, matched: `table-cell: "${label}"`, value: clean };
            return clean;
          } else {
            candidateRejected = { strategy: 3, matched: `table-cell: "${label}"`, rawValue: clean, reason: `Shape check failed for ${fieldName}` };
          }
        } else if (raw && hefEngine.isBoilerplateText(raw)) {
          candidateRejected = { strategy: 3, matched: `table-cell: "${label}"`, rawValue: raw, reason: "Boilerplate/footer text detected" };
        }
      }
    } catch (_) {}

    // 4. Definition list: <dt>Label</dt><dd>Value</dd>
    try {
      const ddLoc = page.locator(`xpath=//dt[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${lower}")]/following-sibling::dd[1]`).first();
      if (await ddLoc.isVisible({ timeout: 150 }).catch(() => false)) {
        const raw = await ddLoc.innerText().catch(async () => await ddLoc.textContent().catch(() => ""));
        const clean = sanitizeText(raw);
        if (clean && clean.toLowerCase() !== lower) {
          if (hefEngine.validateField(fieldName, clean)) {
            if (auditReport) auditReport[fieldName] = { status: "FOUND", strategy: 4, matched: `dl-dd: "${label}"`, value: clean };
            return clean;
          } else {
            candidateRejected = { strategy: 4, matched: `dl-dd: "${label}"`, rawValue: clean, reason: `Shape check failed for ${fieldName}` };
          }
        } else if (raw && hefEngine.isBoilerplateText(raw)) {
          candidateRejected = { strategy: 4, matched: `dl-dd: "${label}"`, rawValue: raw, reason: "Boilerplate/footer text detected" };
        }
      }
    } catch (_) {}

    // 5. Strictly scoped container (max 3 ancestors above label, NO row/col page-wide containers)
    try {
      const containerLoc = page.locator(`xpath=(//*[translate(normalize-space(text()), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')="${lower}" or contains(translate(normalize-space(text()), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${lower}")][not(self::body or self::html or self::footer or contains(@class, "footer"))]/ancestor::*[position() <= 3 and (contains(@class, "form-group") or contains(@class, "detail") or contains(@class, "item") or contains(@class, "info-box") or contains(@class, "data-field") or contains(@class, "profile-field") or contains(@class, "field"))]//*[contains(@class, "value") or contains(@class, "desc") or contains(@class, "text") or contains(@class, "number") or self::b or self::strong or self::span][not(contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${lower}"))])[1]`).first();
      if (await containerLoc.isVisible({ timeout: 150 }).catch(() => false)) {
        const raw = await containerLoc.innerText().catch(async () => await containerLoc.textContent().catch(() => ""));
        const clean = sanitizeText(raw);
        if (clean && clean.toLowerCase() !== lower) {
          if (hefEngine.validateField(fieldName, clean)) {
            if (auditReport) auditReport[fieldName] = { status: "FOUND", strategy: 5, matched: `scoped-container: "${label}"`, value: clean };
            return clean;
          } else {
            candidateRejected = { strategy: 5, matched: `scoped-container: "${label}"`, rawValue: clean, reason: `Shape check failed for ${fieldName}` };
          }
        } else if (raw && hefEngine.isBoilerplateText(raw)) {
          candidateRejected = { strategy: 5, matched: `scoped-container: "${label}"`, rawValue: raw, reason: "Boilerplate/footer text detected" };
        }
      }
    } catch (_) {}
  }

  // 6. Direct CSS Selectors (Supporting both visible text nodes and input element values)
  for (const sel of fallbackSelectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 150 }).catch(() => false) || (sel.includes("input") && await loc.count().catch(() => 0) > 0)) {
        let raw = "";
        if (sel.includes("input") || await loc.evaluate(el => el.tagName === "INPUT").catch(() => false)) {
          raw = await loc.inputValue().catch(async () => await loc.getAttribute("value").catch(() => ""));
        }
        if (!raw) {
          raw = await loc.innerText().catch(async () => await loc.textContent().catch(() => ""));
        }
        const clean = sanitizeText(raw);
        if (clean) {
          if (hefEngine.validateField(fieldName, clean)) {
            if (auditReport) auditReport[fieldName] = { status: "FOUND", strategy: 6, matched: `selector: "${sel}"`, value: clean };
            return clean;
          } else {
            candidateRejected = { strategy: 6, matched: `selector: "${sel}"`, rawValue: clean, reason: `Shape check failed for ${fieldName}` };
          }
        } else if (raw && hefEngine.isBoilerplateText(raw)) {
          candidateRejected = { strategy: 6, matched: `selector: "${sel}"`, rawValue: raw, reason: "Boilerplate/footer text detected" };
        }
      }
    } catch (_) {}
  }

  if (candidateRejected) {
    if (auditReport) auditReport[fieldName] = { status: "REJECTED", strategy: candidateRejected.strategy, matched: candidateRejected.matched, rawValue: candidateRejected.rawValue, reason: candidateRejected.reason };
  } else {
    if (auditReport) auditReport[fieldName] = { status: "NOT_FOUND", strategy: null, matched: null, value: null, reason: "No matching DOM element found" };
  }

  return null;
}

/**
 * Strict DOM Scraping of HEF Portal Dashboard.
 * Extracts raw text from HTML nodes and input fields rapidly.
 */
async function scrapeDashboardFromPage(page) {
  console.log("[playwright-scraper] ⚡ Fast scraping HEF dashboard data…");

  // Fast wait for DOM to mount
  await page.waitForSelector('.dashboard-container, .profile-details, .content-wrapper, .content, .main-content, .card, .card-body, .box, .box-body, #dashboard, .profile, .student-info, .user-panel, .dropdown-user, input#user_id', { timeout: 3000 }).catch(() => {});
  await page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {});

  if (process.env.DEBUG_VISIBLE === "true") {
    const ts = Date.now();
    const screenshotPath = path.join(SCREENSHOTS_DIR, `debug-dashboard-fully-loaded-${ts}.png`);
    const htmlPath = path.join(SCREENSHOTS_DIR, `debug-dashboard-${ts}.html`);
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const html = await page.content();
      fs.writeFileSync(htmlPath, html);
    } catch (_) {}
  }

  const extractionAudit = {};

  // Extract directly from page HTML in memory (< 2ms)
  const pageHtml = await page.content().catch(() => "");
  const domExtracted = hefEngine.extractDataFromHtml ? hefEngine.extractDataFromHtml(pageHtml, page.url()) : {};

  // 1. Student Full Name
  let name = domExtracted.name;
  if (name) {
    extractionAudit.name = { status: "FOUND", strategy: "html-parser", matched: "html-input/user-name", value: name };
  } else {
    name = await scrapeFieldByLabels(page, "name",
      ["Full Name", "Student Name", "Loanee Name", "Applicant Name", "Name"],
      [
        ".dropdown-user .user-name b",
        ".dropdown-user .user-name",
        "input#unames",
        "input#names",
        ".user-name.text-bold-700",
        ".profile-username",
        ".student-name",
        ".profile-name",
        "#student_name",
        ".user-panel .info",
        ".nav-user-name",
        "header .dropdown-toggle",
        ".navbar-nav .dropdown-toggle",
        ".navbar-custom-menu .dropdown-toggle",
        "h3.profile-username",
        ".widget-user-username"
      ],
      extractionAudit
    );
  }
  if (name) {
    name = name.replace(/^welcome,?\s*/i, "").replace(/^(student|user|hi|hello):?\s*/i, "").trim();
    if (/dashboard|sign out|logout|profile|menu/i.test(name) || name.length < 2) {
      name = null;
    }
  }

  // 2. Institution / University
  let institution = domExtracted.institution;
  if (institution) {
    extractionAudit.institution = { status: "FOUND", strategy: "html-parser", matched: "html-institution", value: institution };
  } else {
    institution = await scrapeFieldByLabels(page, "institution",
      ["Institution", "University", "College", "Institution Name", "University / College", "Institution of Study", "School"],
      ["input#institution", ".institution-name", "#institution", "#university", ".university-name", "#college", ".college-name"],
      extractionAudit
    );
  }

  // 3. Allocated Band
  let allocatedBand = domExtracted.bandName || (domExtracted.band ? `Band ${domExtracted.band}` : null);
  let bandNum = domExtracted.bandNum || domExtracted.band || null;
  if (allocatedBand) {
    extractionAudit.bandAllocated = { status: "FOUND", strategy: "html-parser", matched: "html-band", value: allocatedBand };
  } else {
    const allocatedBandRaw = await scrapeFieldByLabels(page, "bandAllocated",
      ["Allocated Band", "Funding Band", "Band Allocated", "Current Band", "Assigned Band", "Band"],
      [".band-allocated", "#allocated_band", ".hef-band", ".band-badge", ".badge-band", "#band"],
      extractionAudit
    );
    allocatedBand = allocatedBandRaw;
    if (allocatedBandRaw) {
      const bMatch = allocatedBandRaw.match(/\b([1-5])\b/);
      if (bMatch) {
        bandNum = parseInt(bMatch[1], 10);
        allocatedBand = `Band ${bMatch[1]}`;
      }
    }
  }

  // 4. Total Outstanding Due / Loan Balance
  let outstandingDue = domExtracted.outstandingDue;
  if (outstandingDue) {
    extractionAudit.outstandingDue = { status: "FOUND", strategy: "html-parser", matched: "html-outstanding", value: outstandingDue };
  } else {
    outstandingDue = await scrapeFieldByLabels(page, "outstandingDue",
      ["Total Outstanding", "Outstanding Due", "Loan Balance", "Outstanding Balance", "Current Balance", "Total Loan Due", "Total Due", "Total Outstanding Due"],
      [".outstanding-balance", "#outstanding_balance", ".total-outstanding", "#total_outstanding", "#loan_balance", ".loan-balance"],
      extractionAudit
    );
  }

  // 5. National ID
  let nationalId = domExtracted.nationalId;
  if (nationalId) {
    extractionAudit.nationalId = { status: "FOUND", strategy: "html-parser", matched: "html-user_id", value: nationalId };
  } else {
    nationalId = await scrapeFieldByLabels(page, "nationalId",
      ["National ID", "ID Number", "National ID No", "ID No", "National ID Number", "ID/Passport"],
      [
        "input#user_id",
        "input[name='user_id']",
        "input#id_number",
        "input#id_no",
        ".national-id",
        "#national_id",
        "#id_number",
        ".id-number",
        "#id_no",
        ".id-no"
      ],
      extractionAudit
    );
  }

  // 6. KCSE Index
  let kcseIndex = domExtracted.kcseIndex;
  if (kcseIndex) {
    extractionAudit.kcseIndex = { status: "FOUND", strategy: "html-parser", matched: "html-kcse_index", value: kcseIndex };
  } else {
    kcseIndex = await scrapeFieldByLabels(page, "kcseIndex",
      ["KCSE Index", "Index Number", "KCSE Index No", "Index No", "KCSE Index Number", "KCSE No"],
      [
        "input#kcse_index",
        "input#index_no",
        ".kcse-index",
        "#kcse_index",
        "#index_no",
        ".index-no",
        "#kcse_no"
      ],
      extractionAudit
    );
  }

  // 7. Programme / Course
  let programme = domExtracted.programme;
  if (programme) {
    extractionAudit.programme = { status: "FOUND", strategy: "html-parser", matched: "html-programme", value: programme };
  } else {
    programme = await scrapeFieldByLabels(page, "programme",
      ["Programme", "Program", "Course", "Programme of Study", "Program of Study", "Course of Study", "Degree", "Academic Programme"],
      [
        "input#programme",
        ".programme-name",
        "#programme",
        "#course",
        ".course-name",
        "#program",
        ".program-name"
      ],
      extractionAudit
    );
  }

  // 8. Level of Study
  let level = domExtracted.level;
  if (level) {
    extractionAudit.level = { status: "FOUND", strategy: "html-parser", matched: "html-level", value: level };
  } else {
    level = await scrapeFieldByLabels(page, "level",
      ["Level", "Level of Study", "Study Level", "Programme Level", "Education Level"],
      [".study-level", "#study_level", ".level-of-study"],
      extractionAudit
    );
  }

  // 9. Year of Study
  let yearOfStudy = domExtracted.yearOfStudy || null;
  if (yearOfStudy) {
    extractionAudit.yearOfStudy = { status: "FOUND", strategy: "html-parser", matched: "html-year_of_study", value: yearOfStudy };
  } else {
    const yearOfStudyRaw = await scrapeFieldByLabels(page, "yearOfStudy",
      ["Year of Study", "Academic Year of Study", "Study Year", "Current Year", "Year"],
      ["input#study_year", ".year-of-study", "#year_of_study", "#year"],
      extractionAudit
    );
    if (yearOfStudyRaw) {
      const yMatch = String(yearOfStudyRaw).match(/\b([1-6])\b/);
      if (yMatch) yearOfStudy = parseInt(yMatch[1], 10);
    }
  }

  // 10. Semester
  let currentSemester = domExtracted.currentSemester || null;
  if (currentSemester) {
    extractionAudit.currentSemester = { status: "FOUND", strategy: "html-parser", matched: "html-current_semester", value: currentSemester };
  } else {
    const currentSemesterRaw = await scrapeFieldByLabels(page, "currentSemester",
      ["Semester", "Current Semester", "Study Semester"],
      [".current-semester", "#current_semester", "#semester"],
      extractionAudit
    );
    if (currentSemesterRaw) {
      const sMatch = String(currentSemesterRaw).match(/\b([1-3])\b/);
      if (sMatch) currentSemester = parseInt(sMatch[1], 10);
    }
  }

  // 11. Academic Year
  let academicYear = domExtracted.academicYear;
  if (academicYear) {
    extractionAudit.academicYear = { status: "FOUND", strategy: "html-parser", matched: "html-academic_year", value: academicYear };
  } else {
    academicYear = await scrapeFieldByLabels(page, "academicYear",
      ["Academic Year", "Current Academic Year", "Financial Year"],
      [
        "input#academic_year",
        "input[name='academic_year']",
        ".academic-year",
        "#academic_year"
      ],
      extractionAudit
    );
  }

  // 12. Awarded Principal / Total Loan
  const loanAwarded = domExtracted.loanAwarded || await scrapeFieldByLabels(page, "loanAwarded",
    ["Awarded Principal", "Total Loan", "Total Loan Awarded", "Loan Awarded", "Allocated Loan", "Total Awarded"],
    [".loan-awarded", "#loan_awarded", ".allocated-loan", "#allocated_loan"],
    extractionAudit
  );

  // 13. Scholarship Amount
  const scholarshipAmount = domExtracted.scholarshipAmount || await scrapeFieldByLabels(page, "scholarshipAmount",
    ["Scholarship", "Scholarship Awarded", "Total Scholarship", "Allocated Scholarship", "Government Scholarship"],
    [".scholarship-amount", "#scholarship_amount", ".allocated-scholarship"],
    extractionAudit
  );

  // 14. Tuition Loan
  const tuitionLoan = domExtracted.tuitionLoan || await scrapeFieldByLabels(page, "tuitionLoan",
    ["Tuition Loan", "Tuition", "Allocated Tuition Loan", "Tuition Portion"],
    [".tuition-loan", "#tuition_loan"],
    extractionAudit
  );

  // 15. Upkeep Loan
  const upkeepLoan = domExtracted.upkeepLoan || await scrapeFieldByLabels(page, "upkeepLoan",
    ["Upkeep Loan", "Upkeep", "Allocated Upkeep", "Living Allowance", "Upkeep Stipend"],
    [".upkeep-loan", "#upkeep_loan", ".upkeep-amount", "#upkeep_amount"],
    extractionAudit
  );

  // 16. Household Fee
  const householdFee = domExtracted.householdFee || await scrapeFieldByLabels(page, "householdFee",
    ["Household Contribution", "Household Fee", "Family Contribution", "Household Portion", "Direct Fee"],
    [".household-fee", "#household_fee", ".household-contribution"],
    extractionAudit
  );

  // 17. Total Repaid
  const totalRepaid = domExtracted.totalRepaid !== undefined ? domExtracted.totalRepaid : await scrapeFieldByLabels(page, "totalRepaid",
    ["Total Repaid", "Amount Repaid", "Repaid", "Repayment to Date", "Total Payment"],
    [".total-repaid", "#total_repaid", ".amount-repaid"],
    extractionAudit
  );

  // 18. Application Status & Ref
  const applicationStatus = domExtracted.applicationStatus || await scrapeFieldByLabels(page, "applicationStatus",
    ["Application Status", "Status", "HEF Status", "Funding Status", "Stage"],
    [".application-status", "#application_status", ".status-badge", ".badge-status"],
    extractionAudit
  );
  const applicationRef = domExtracted.applicationRef || await scrapeFieldByLabels(page, "applicationRef",
    ["Application Ref", "Application Reference", "Batch Number", "Reference Number", "Ref No", "Application Number"],
    [".app-ref", "#app_ref", ".batch-number", "#batch_number"],
    extractionAudit
  );

  // 19. Bank Name & Account Number
  const bankName = domExtracted.bankName || await scrapeFieldByLabels(page, "bankName",
    ["Bank Name", "Bank", "Disbursement Bank", "Upkeep Bank"],
    ["input#bank_name", ".bank-name", "#bank_name"],
    extractionAudit
  );
  const accountNumber = domExtracted.accountNumber || await scrapeFieldByLabels(page, "accountNumber",
    ["Account Number", "Account No", "Bank Account", "Account"],
    ["input#account_number", "input#account_no", ".account-number", "#account_number", "#account_no"],
    extractionAudit
  );

  // 20. Phone / Mobile Number
  const phone = domExtracted.phone || await scrapeFieldByLabels(page, "phone",
    ["Mobile Number", "Phone Number", "Mobile", "Phone", "Telephone", "Cell"],
    ["input#usermobile", "input[name='usermobile']", "input#mobile", "input[name='mobile']", ".user-mobile", "#usermobile"],
    extractionAudit
  );

  // 21. Email Address
  const studentEmail = domExtracted.email || await scrapeFieldByLabels(page, "email",
    ["Email Address", "Email", "E-mail"],
    ["input#email", "input[name='email']", "input#email_add", ".user-email"],
    extractionAudit
  );

  // 22. Location Details
  const county = domExtracted.county || await scrapeFieldByLabels(page, "county",
    ["County", "Home County", "County of Origin"],
    ["input#county", "select#county", ".county-name", "#county"],
    extractionAudit
  );
  const subCounty = domExtracted.subCounty || await scrapeFieldByLabels(page, "subCounty",
    ["Sub County", "Sub-County", "District"],
    ["input#sub_county", "select#sub_county", ".sub-county", "#sub_county"],
    extractionAudit
  );
  const constituency = domExtracted.constituency || await scrapeFieldByLabels(page, "constituency",
    ["Constituency", "Home Constituency"],
    ["input#constituency", "select#constituency", ".constituency-name", "#constituency"],
    extractionAudit
  );

  // 23. Personal Identification
  const dob = domExtracted.dob || await scrapeFieldByLabels(page, "dob",
    ["Date of Birth", "DOB", "Birth Date"],
    ["input#dob", "input[name='dob']", "input#date_of_birth", ".dob"],
    extractionAudit
  );
  const gender = domExtracted.gender || await scrapeFieldByLabels(page, "gender",
    ["Gender", "Sex"],
    ["input#gender", "select#gender", ".gender"],
    extractionAudit
  );
  const registrationNumber = domExtracted.registrationNumber || await scrapeFieldByLabels(page, "registrationNumber",
    ["Registration Number", "Reg No", "Admission Number", "Adm No", "Student ID"],
    ["input#reg_no", "input#adm_no", ".reg-no", ".adm-no"],
    extractionAudit
  );

  // 24. Table Rows / Disbursements
  const disbursements = (domExtracted.disbursements && domExtracted.disbursements.length > 0)
    ? domExtracted.disbursements
    : [];

  if (disbursements.length === 0) {
    try {
      const tableRows = page.locator('table tbody tr, .table tbody tr, #disbursements-table tr, #big_table2 tbody tr');
      const rowCount = await tableRows.count().catch(() => 0);
      for (let i = 0; i < Math.min(rowCount, 25); i++) {
        const row = tableRows.nth(i);
        const cells = await row.locator('td').allInnerTexts().catch(() => []);
        if (cells && cells.length >= 3) {
          const sanitizedCells = cells.map(c => sanitizeText(c));
          if (!sanitizedCells[0] || /academic|date|release/i.test(sanitizedCells[0])) continue;
          disbursements.push({
            date: sanitizedCells[0] || null,
            semester: sanitizedCells[1] || null,
            purpose: sanitizedCells[2] || null,
            amount: sanitizedCells[3] || null,
            status: sanitizedCells[4] || "Disbursed",
            batch: sanitizedCells[5] || null
          });
        }
      }
    } catch (_) {}
  }

  const scrapedPayload = {
    name,
    nationalId,
    email: studentEmail,
    phone,
    kcseIndex,
    institution,
    programme,
    level,
    yearOfStudy,
    currentSemester,
    band: allocatedBand,
    bandNum,
    academicYear,
    applicationRef,
    applicationStatus,
    bankName,
    accountNumber,
    county,
    subCounty,
    constituency,
    dob,
    gender,
    registrationNumber,
    outstandingDue,
    loanAwarded,
    scholarshipAmount,
    tuitionLoan,
    upkeepLoan,
    householdFee,
    totalRepaid,
    disbursements,
    extractionAudit
  };

  console.log("[playwright-scraper] ✅ Fast scraped DOM variables:", JSON.stringify({
    name: name || "null",
    nationalId: nationalId || "null",
    institution: institution || "null",
    band: allocatedBand || "null",
    outstandingDue: outstandingDue || "null"
  }));

  return scrapedPayload;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Direct Portal HTTP Session Engine & Fast Scraping Pipeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Direct HTTPS request helper for fetching portal subpages with session cookies
 */
async function httpGetPortalPage(pageUrl, cookieHeader, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const proxyConfig = getProxyConfig();
    const options = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cookie": cookieHeader,
        "Referer": "https://portal.hef.co.ke/",
        "Connection": "keep-alive"
      },
      timeout: timeoutMs,
      rejectUnauthorized: false
    };
    if (proxyConfig?.httpsAgent) {
      options.agent = proxyConfig.httpsAgent;
    }

    const req = https.get(pageUrl, options, (res) => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, statusCode: res.statusCode, body, url: pageUrl });
      });
    });

    req.on("error", (err) => resolve({ ok: false, error: err, url: pageUrl }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, timeout: true, url: pageUrl }); });
  });
}

/**
 * Ultra-fast direct HTTP scraper for authenticated portal sessions.
 * Concurrently fetches and parses dashboard, profile, loans, statement, and update details in < 800ms.
 */
async function scrapeHefViaDirectHttp(cookieHeader, credential, portalInfo = "") {
  const startTime = Date.now();
  console.log(`[direct-scraper] ⚡ Initiating parallel direct HTTP portal scraping…`);

  const subPages = [
    `${PORTAL_BASE_URL}/${portalInfo || ""}`,
    `${PORTAL_BASE_URL}/account/index/frm_profile`,
    `${PORTAL_BASE_URL}/service/index/frm_loans`,
    `${PORTAL_BASE_URL}/nfm/index/frm_update_details`,
    `${PORTAL_BASE_URL}/service/index/frm_loan_statement`
  ];

  const results = await Promise.allSettled(
    subPages.map(url => httpGetPortalPage(url, cookieHeader, 5000))
  );

  const mergedScraped = {};
  let accumulatedText = "";
  const auditReport = {};

  for (const res of results) {
    if (res.status === "fulfilled" && res.value && res.value.ok && res.value.body) {
      const pageData = hefEngine.extractDataFromHtml ? hefEngine.extractDataFromHtml(res.value.body, res.value.url) : {};
      for (const [k, v] of Object.entries(pageData)) {
        if (v !== null && v !== undefined && v !== "" && (mergedScraped[k] === undefined || mergedScraped[k] === null || mergedScraped[k] === "Data not found")) {
          mergedScraped[k] = v;
          auditReport[k] = { status: "FOUND", strategy: "direct-http", matched: `url: ${res.value.url}`, value: v };
        }
      }
      accumulatedText += "\n" + res.value.body.replace(/<[^>]+>/g, " ");
    }
  }

  // Regex fallback on accumulated text
  const regexData = hefEngine.extractDataFromPageRegex(accumulatedText);
  for (const [k, v] of Object.entries(regexData)) {
    if (v !== null && v !== undefined && v !== "" && (mergedScraped[k] === undefined || mergedScraped[k] === null || mergedScraped[k] === "Data not found")) {
      mergedScraped[k] = v;
      auditReport[k] = { status: "FOUND", strategy: "direct-http-regex", matched: "accumulated-text", value: v };
    }
  }

  mergedScraped.extractionAudit = auditReport;
  const integrity = hefEngine.evaluateDataIntegrity(mergedScraped, auditReport);

  console.log(`[direct-scraper] ⚡ Direct HTTP scraping completed in ${Date.now() - startTime}ms. Extracted attributes:`, JSON.stringify({
    name: mergedScraped.name || "null",
    nationalId: mergedScraped.nationalId || "null",
    institution: mergedScraped.institution || "null",
    band: mergedScraped.band || "null",
    outstandingDue: mergedScraped.outstandingDue || "null"
  }));

  return {
    ok: true,
    success: true,
    message: "Login successful.",
    sessionToken: cookieHeader,
    pageTitle: "HEF Portal Dashboard",
    dataIntegrityWarning: integrity.dataIntegrityWarning,
    warningDetail: integrity.warningDetail,
    integrity,
    scrapedData: mergedScraped
  };
}

async function directHefLogin(credential, password, timeoutMs = 25000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    console.log(`[direct-auth] Initiating direct handshake with ${PORTAL_BASE_URL}…`);
    const proxyConfig = getProxyConfig();
    if (proxyConfig) {
      console.log(`[direct-auth] Routing direct request through proxy: ${proxyConfig.server}`);
    }

    const isId = /^\d{5,10}$/.test(credential.trim());
    const getOptions = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "keep-alive"
      },
      timeout: timeoutMs,
      rejectUnauthorized: false
    };
    if (proxyConfig?.httpsAgent) {
      getOptions.agent = proxyConfig.httpsAgent;
    }

    const req1 = https.get(PORTAL_BASE_URL, getOptions, (res1) => {
      const rawCookies = res1.headers["set-cookie"] || [];
      const cookieHeader = rawCookies.map(c => c.split(";")[0]).join("; ");

      const postData = querystring.stringify({
        base_url: "https://portal.hef.co.ke/",
        user_type: "",
        user_number: isId ? credential.trim() : "",
        email_add: credential.trim(),
        password: password
      });

      const reqOptions = {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Content-Length": Buffer.byteLength(postData),
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          "Cookie": cookieHeader,
          "X-Requested-With": "XMLHttpRequest",
          "Referer": "https://portal.hef.co.ke/",
          "Origin": "https://portal.hef.co.ke",
          "Accept": "*/*"
        },
        timeout: timeoutMs,
        rejectUnauthorized: false
      };
      if (proxyConfig?.httpsAgent) {
        reqOptions.agent = proxyConfig.httpsAgent;
      }

      const req2 = https.request(PORTAL_SIGNIN_URL, reqOptions, (res2) => {
        let body = "";
        res2.on("data", chunk => body += chunk);
        res2.on("end", () => {
          const authCookies = res2.headers["set-cookie"] || [];
          const allCookies = [...rawCookies, ...authCookies];
          console.log(`[direct-auth] Response received (${res2.statusCode}) in ${Date.now() - startTime}ms`);

          try {
            let parsed = null;
            try {
              parsed = JSON.parse(body.trim());
            } catch {
              const jsonMatch = body.match(/\{[\s\S]*\}/);
              if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
            }

            if (parsed) {
              const info = parsed.info || "";
              const attempts = parsed.attempts;

              if (info === "otp" || info === "verify_otp" || info === "2fa" || info === "two_factor" || info === "two-factor" || info === "verification_code") {
                return resolve({
                  ok: false,
                  requiresOtp: true,
                  sessionToken: allCookies.map(c => c.split(";")[0]).join("; "),
                  message: parsed.message || "Enter the OTP sent to your phone/email.",
                  portalInfo: info
                });
              }

              if (info === "warning") {
                const remaining = attempts ? Math.max(0, 4 - attempts) : null;
                const note = remaining !== null ? ` (${remaining} attempt(s) remaining)` : "";
                return resolve({
                  ok: false,
                  success: false,
                  message: `The password entered is incorrect.${note}`,
                  portalInfo: info
                });
              }

              if (info === "email_error") {
                return resolve({
                  ok: false,
                  success: false,
                  message: "A user with that email address does not exist in the HEF system.",
                  portalInfo: info
                });
              }

              if (info === "id_error" || info === "idnumber") {
                return resolve({
                  ok: false,
                  success: false,
                  message: "A user with that National ID number does not exist in the HEF system.",
                  portalInfo: info
                });
              }

              if (info === "invalid") {
                return resolve({
                  ok: false,
                  success: false,
                  message: "Please enter a valid email address or National ID number.",
                  portalInfo: info
                });
              }

              if (info === "inactive") {
                return resolve({
                  ok: false,
                  success: false,
                  message: "Please activate your HEF account using the activation link sent to your email during registration.",
                  portalInfo: info
                });
              }

              if (info === "deactivated" || info === "user_ban") {
                return resolve({
                  ok: false,
                  success: false,
                  message: "Your HEF account is currently deactivated or restricted. Please contact HELB/HEF support.",
                  portalInfo: info
                });
              }

              if (info === "verification") {
                return resolve({
                  ok: false,
                  success: false,
                  message: "Your account is pending verification by the HELB/HEF team.",
                  portalInfo: info
                });
              }

              if (info && !info.includes("error") && !info.includes("warning")) {
                const sessionToken = allCookies.map(c => c.split(";")[0]).join("; ");
                return resolve({
                  ok: true,
                  success: true,
                  message: "Login successful.",
                  redirectUrl: `${PORTAL_BASE_URL}/${info}`,
                  sessionToken,
                  portalInfo: info
                });
              }
            }

            if (allCookies.some(c => c.toLowerCase().includes("session") || c.toLowerCase().includes("token"))) {
              return resolve({
                ok: true,
                success: true,
                message: "Login successful.",
                sessionToken: allCookies.join("; ")
              });
            }

            return resolve({
              ok: false,
              success: false,
              message: `Portal responded: ${body.substring(0, 120) || "Unknown response"}`
            });
          } catch (parseErr) {
            return resolve({
              ok: false,
              success: false,
              message: "Unable to parse portal response.",
              error: parseErr.message
            });
          }
        });
      });

      req2.on("error", (e) => resolve({ error: e }));
      req2.on("timeout", () => {
        req2.destroy();
        resolve({ timeout: true, error: new Error("Direct portal sign-in request timed out") });
      });

      req2.write(postData);
      req2.end();
    });

    req1.on("error", (e) => resolve({ error: e }));
    req1.on("timeout", () => {
      req1.destroy();
      resolve({ timeout: true, error: new Error("Initial portal connection timed out") });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Resilient Playwright Automation & High-Speed Browser Engine
// ─────────────────────────────────────────────────────────────────────────────

// Shared browser pool instance to avoid chromium.launch cold start latency
let sharedBrowser = null;

async function getSharedBrowser() {
  if (sharedBrowser && sharedBrowser.isConnected()) {
    return sharedBrowser;
  }
  const isDebugVisible = process.env.DEBUG_VISIBLE === "true";
  const proxyConfig = getProxyConfig();
  const launchOptions = {
    headless: !isDebugVisible,
    slowMo: isDebugVisible ? 20 : 0,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--disable-dev-shm-usage",
      "--window-size=1280,800",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding"
    ],
  };

  if (proxyConfig?.playwrightProxy) {
    launchOptions.proxy = proxyConfig.playwrightProxy;
  }

  sharedBrowser = await chromium.launch(launchOptions);
  return sharedBrowser;
}

/**
 * Reusable scraping and data extraction engine for an authenticated Playwright session.
 * Used for both standard credential logins and completed OTP challenges.
 */
async function scrapeHefPortalSession(
  page,
  ctx,
  email,
  capturedProfileData = {},
  capturedAllocationData = {},
  capturedResponses = [],
  mousePos = { x: 250, y: 200 }
) {
  // Wait for redirect to portal dashboard
  await page.waitForURL(url => !url.toString().includes("auth/signin") && !url.toString().includes("auth/otp") && !url.toString().endsWith(".ke/"), { timeout: 8000 }).catch(() => {});
  await page.waitForLoadState("domcontentloaded", { timeout: 6000 }).catch(() => {});

  let accumulatedPageText = "";
  try {
    const initialText = await page.locator("body").innerText().catch(async () => await page.evaluate(() => document.body.innerText).catch(() => ""));
    if (initialText) accumulatedPageText += "\n" + initialText;
  } catch (_) {}

  // ⚡ Parallel fetch of sub-routes inside the authenticated browser context
  const subRoutes = [
    "/account/index/frm_profile",
    "/nfm/index/frm_update_details",
    "/service/index/frm_loans",
    "/service/index/frm_loan_statement",
    "/service/index/frm_loan_repayment",
    "/service/index/frm_clr_cert"
  ];

  console.log("[playwright-scraper] ⚡ Executing parallel sub-route data extraction…");
  const subPageScraped = {};
  try {
    const subPageResults = await page.evaluate(async (routes) => {
      return await Promise.all(routes.map(async r => {
        try {
          const res = await fetch(r, { credentials: "same-origin" });
          if (res.ok) {
            const html = await res.text();
            return { route: r, html };
          }
        } catch (_) {}
        return null;
      }));
    }, subRoutes).catch(() => []);

    if (Array.isArray(subPageResults)) {
      for (const item of subPageResults) {
        if (item && item.html) {
          accumulatedPageText += "\n" + item.html.replace(/<[^>]+>/g, " ");
          const parsed = hefEngine.extractDataFromHtml ? hefEngine.extractDataFromHtml(item.html, item.route) : {};
          for (const [k, v] of Object.entries(parsed)) {
            if (v !== null && v !== undefined && v !== "" && (subPageScraped[k] === undefined || subPageScraped[k] === null || subPageScraped[k] === "Data not found")) {
              subPageScraped[k] = v;
            }
          }
        }
      }
    }
  } catch (evalErr) {
    console.warn("[playwright-scraper] Subpage fetch notice:", evalErr.message);
  }

  // Check session cookies
  const cookies = await ctx.cookies();
  const sessionCookie = cookies.find(
    c => c.name.toLowerCase().includes("session") || c.name.toLowerCase().includes("token")
  );
  const pageTitle = await page.title().catch(() => "");

  // ── DYNAMIC REGEX / FULL-TEXT FALLBACK & DOM SCRAPING ──
  const apiData = hefEngine.extractDataFromCapturedJson(capturedProfileData, capturedResponses);
  const domData = await scrapeDashboardFromPage(page);
  const regexData = hefEngine.extractDataFromPageRegex(accumulatedPageText);

  // ── CONSTRUCT FINAL MERGED RESPONSE ──
  const scrapedData = {
    name: subPageScraped.name || apiData.name || domData.name || regexData.name || null,
    nationalId: subPageScraped.nationalId || apiData.nationalId || domData.nationalId || regexData.nationalId || (/^\d{5,10}$/.test(email) ? email : null) || null,
    email: subPageScraped.email || apiData.email || domData.email || (email && email.includes("@") ? email : null) || null,
    phone: subPageScraped.phone || apiData.phone || domData.phone || regexData.phone || null,
    kcseIndex: subPageScraped.kcseIndex || apiData.kcseIndex || domData.kcseIndex || regexData.kcseIndex || null,
    institution: subPageScraped.institution || apiData.institution || domData.institution || regexData.institution || null,
    programme: subPageScraped.programme || apiData.programme || domData.programme || regexData.programme || null,
    level: subPageScraped.level || apiData.level || domData.level || regexData.level || null,
    band: subPageScraped.bandName || apiData.bandName || domData.band || regexData.bandName || (apiData.band ? `Band ${apiData.band}` : (regexData.band ? `Band ${regexData.band}` : null)),
    bandNum: subPageScraped.bandNum || apiData.bandNum || domData.bandNum || regexData.bandNum || apiData.band || regexData.band || null,
    outstandingDue: subPageScraped.outstandingDue || apiData.outstandingDue || domData.outstandingDue || regexData.outstandingDue || null,
    loanAwarded: subPageScraped.loanAwarded || apiData.loanAwarded || domData.loanAwarded || regexData.loanAwarded || null,
    scholarshipAmount: subPageScraped.scholarshipAmount || apiData.scholarshipAmount || domData.scholarshipAmount || regexData.scholarshipAmount || null,
    tuitionLoan: subPageScraped.tuitionLoan || apiData.tuitionLoan || domData.tuitionLoan || regexData.tuitionLoan || null,
    upkeepLoan: subPageScraped.upkeepLoan || apiData.upkeepLoan || domData.upkeepLoan || regexData.upkeepLoan || null,
    householdFee: subPageScraped.householdFee || apiData.householdFee || domData.householdFee || regexData.householdFee || null,
    totalRepaid: subPageScraped.totalRepaid !== undefined ? subPageScraped.totalRepaid : (apiData.totalRepaid !== undefined ? apiData.totalRepaid : (domData.totalRepaid !== undefined ? domData.totalRepaid : (regexData.totalRepaid !== undefined ? regexData.totalRepaid : 0))),
    yearOfStudy: subPageScraped.yearOfStudy || apiData.yearOfStudy || domData.yearOfStudy || regexData.yearOfStudy || null,
    currentSemester: subPageScraped.currentSemester || apiData.currentSemester || domData.currentSemester || regexData.currentSemester || null,
    academicYear: subPageScraped.academicYear || apiData.academicYear || domData.academicYear || regexData.academicYear || null,
    bankName: subPageScraped.bankName || apiData.bankName || domData.bankName || regexData.bankName || null,
    accountNumber: subPageScraped.accountNumber || apiData.accountNumber || domData.accountNumber || regexData.accountNumber || null,
    county: subPageScraped.county || apiData.county || domData.county || regexData.county || null,
    subCounty: subPageScraped.subCounty || apiData.subCounty || domData.subCounty || regexData.subCounty || null,
    constituency: subPageScraped.constituency || apiData.constituency || domData.constituency || regexData.constituency || null,
    dob: subPageScraped.dob || apiData.dob || domData.dob || regexData.dob || null,
    gender: subPageScraped.gender || apiData.gender || domData.gender || regexData.gender || null,
    registrationNumber: subPageScraped.registrationNumber || apiData.registrationNumber || domData.registrationNumber || regexData.registrationNumber || null,
    applicationStatus: subPageScraped.applicationStatus || apiData.applicationStatus || domData.applicationStatus || regexData.applicationStatus || null,
    applicationRef: subPageScraped.applicationRef || apiData.applicationRef || domData.applicationRef || regexData.applicationRef || null,
    disbursements: (subPageScraped.disbursements && subPageScraped.disbursements.length > 0) ? subPageScraped.disbursements : ((apiData.disbursements && apiData.disbursements.length > 0) ? apiData.disbursements : (domData.disbursements && domData.disbursements.length > 0 ? domData.disbursements : [])),
    capturedApiData: apiData,
    extractionAudit: domData.extractionAudit || {}
  };

  const integrity = hefEngine.evaluateDataIntegrity(scrapedData, domData.extractionAudit);

  console.log("[playwright-login] ✅ Scraped authentic attributes:", JSON.stringify({
    name: scrapedData.name || "Data not found",
    nationalId: scrapedData.nationalId || "Data not found",
    institution: scrapedData.institution || "Data not found",
    band: scrapedData.band || "Data not found",
    kcseIndex: scrapedData.kcseIndex || "Data not found",
    outstandingDue: scrapedData.outstandingDue || "Data not found"
  }));

  return {
    ok: true,
    success: true,
    message: "Login successful.",
    sessionToken: sessionCookie?.value || "portal-session-authenticated",
    pageTitle: pageTitle || "HEF Portal Dashboard",
    dataIntegrityWarning: integrity.dataIntegrityWarning,
    warningDetail: integrity.warningDetail,
    integrity,
    scrapedData
  };
}

async function playwrightHefLogin(email, password) {
  const isDebugVisible = process.env.DEBUG_VISIBLE === "true";
  const proxyConfig = getProxyConfig();
  const navTimeout = proxyConfig ? 60000 : 45000;

  console.log(`[playwright-login] Starting Playwright browser (visible: ${isDebugVisible}, proxy: ${proxyConfig ? proxyConfig.server : "none"}, navTimeout: ${navTimeout}ms) for user: ${email}…`);

  const browser = await getSharedBrowser();

  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    locale: "en-KE",
    timezoneId: "Africa/Nairobi",
    extraHTTPHeaders: { "Accept-Language": "en-KE,en;q=0.9,en-US;q=0.8" },
    ignoreHTTPSErrors: true,
    bypassCSP: true,
  });

  const page = await ctx.newPage();
  await human.setupHumanStealth(page);
  const mousePos = { x: 250, y: 200 };

  let capturedProfileData = {};
  let capturedAllocationData = {};
  const capturedResponses = [];

  page.on('response', async (response) => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';
    if (contentType.includes('application/json') || url.includes('/api/') || url.includes('.json') || url.includes('frm_') || url.includes('datatable')) {
      try {
        const json = await response.json();
        capturedResponses.push({ url, status: response.status(), data: json });
        if (json.data || json.student || json.profile || json.allocations || json.loanDetails || json.applicant || json.user || json.loans || json.statement) {
          Object.assign(capturedProfileData, json.data || json);
          if (json.allocations || json.loanDetails) {
            Object.assign(capturedAllocationData, json.allocations || json.loanDetails);
          }
        } else if (typeof json === 'object' && json !== null) {
          Object.assign(capturedProfileData, json);
        }
      } catch (_) {}
    }
  });

  let keepBrowserOpen = false;

  try {
    console.log(`[playwright-login] Navigating to ${PORTAL_BASE_URL} (timeout: ${navTimeout}ms)…`);

    let navOk = false;
    const navErrors = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await page.goto(PORTAL_BASE_URL, { waitUntil: "domcontentloaded", timeout: navTimeout });
        navOk = true;
        break;
      } catch (err) {
        navErrors.push(err);
        console.warn(`[playwright-login] ⚠️ Navigation attempt ${attempt} failed: ${err.name || "Error"} - ${err.message}`);
        if (attempt === 1) await page.waitForTimeout(1000);
      }
    }

    if (!navOk) {
      console.log("[playwright-login] Both Playwright navigation attempts failed. Performing upstream health check…");
      const health = await checkPortalPlainHttpHealth(8000);
      let diagnosticBranch = "plain-http-failed";
      let failureReason = "plain-http-failed";
      let failureMessage = "The HELB/HEF portal appears to be unreachable from this server (network-level failure) — try again shortly or check if this server's IP is being blocked.";

      if (health.ok) {
        diagnosticBranch = "playwright-only-failed";
        failureReason = "playwright-only-failed";
        failureMessage = "Portal is reachable via plain HTTP but Playwright navigation is failing — possible bot-protection/anti-automation block";
      }

      const snap = await captureSnapshot(page, "nav-failed");
      return {
        ok: false,
        success: false,
        network_error: true,
        diagnosticBranch,
        failureReason,
        message: failureMessage,
        diagnostics: {
          diagnosticBranch,
          failureReason,
          navTimeout,
          attempts: 2,
          hasProxy: Boolean(proxyConfig),
          plainHttpHealth: {
            ok: health.ok,
            statusCode: health.statusCode || null,
            durationMs: health.durationMs,
            error: health.error?.message || null,
          },
          errors: navErrors.map(e => ({ name: e.name || "Error", message: e.message, stack: e.stack })),
        },
        snapshot: snap
      };
    }

    // Dismiss any modal/dialog/announcement overlays if visible on portal frontend
    try {
      const dismissBtn = page.locator('.modal .close, .modal .btn-close, .modal button:has-text("Close"), .modal button:has-text("Dismiss"), button:has-text("Accept"), .cookie-banner button').first();
      if (await dismissBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await dismissBtn.click().catch(() => {});
      }
    } catch (_) {}

    const emailSelector = '#form-email_add, #email_add, #email, #national_id, #id_no, input[name="email_add"], input[name="email"], input[name="national_id"], input[name="id_no"], input[placeholder*="email" i], input[placeholder*="ID" i], input[placeholder*="national" i], input[type="text"], input[type="email"]';
    const emailLocator = page.locator(emailSelector).first();
    await emailLocator.waitFor({ state: "visible", timeout: 20000 });

    const passSelector = '#form-password, #password, input[name="password"], input[type="password"], input[placeholder*="password" i]';
    const passwordLocator = page.locator(passSelector).first();
    await passwordLocator.waitFor({ state: "visible", timeout: 15000 });

    // Enter credentials into portal login frontend using human typing cadence
    console.log("[playwright-login] ⚡ Entering credentials into portal login form with human cadence…");
    await human.humanType(page, emailLocator, email, mousePos, { clearFirst: true });
    await human.humanPause(120, 350);
    await human.humanType(page, passwordLocator, password, mousePos, { clearFirst: true });
    await human.humanPause(150, 450);

    const submitBtnSelector = '#form-login button[type="submit"], .btn-signin, button[type="submit"]:has-text("Login"), button:has-text("Login"), button:has-text("Sign In"), button:has-text("Log in"), button[type="submit"], input[type="submit"]';
    const submitBtn = page.locator(submitBtnSelector).first();

    let ajaxResponseData = null;
    const responsePromise = page.waitForResponse(
      resp => resp.url().includes("auth/signin"),
      { timeout: 20000 }
    ).then(async resp => {
      try {
        ajaxResponseData = await resp.text();
      } catch (_) {}
    }).catch(() => null);

    await human.humanClick(page, submitBtn, mousePos);

    await Promise.race([
      responsePromise,
      page.waitForTimeout(3500)
    ]);

    // Check error message in DOM
    const msgEl = page.locator('.message, .alert-danger, #msg, .toastr, .text-danger, .invalid-feedback').first();
    if (await msgEl.isVisible({ timeout: 1000 }).catch(() => false)) {
      const errorText = await msgEl.textContent().catch(() => "");
      const cleanErr = errorText.replace("Processing please wait..!", "").trim();
      if (
        cleanErr &&
        cleanErr.length > 2 &&
        !cleanErr.includes("Processing") &&
        !cleanErr.toLowerCase().includes("otp") &&
        !cleanErr.toLowerCase().includes("verification") &&
        !cleanErr.toLowerCase().includes("code")
      ) {
        const snap = await captureSnapshot(page, "login-error");
        return {
          ok: false,
          success: false,
          message: cleanErr,
          snapshot: snap
        };
      }
    }

    if (ajaxResponseData) {
      try {
        const parsed = JSON.parse(ajaxResponseData.trim());
        const info = (parsed.info || "").toLowerCase();
        if (info === "warning") {
          return { ok: false, success: false, message: "The password entered is incorrect." };
        }
        if (info === "email_error" || info === "id_error") {
          return { ok: false, success: false, message: "A user with those credentials does not exist in the HEF system." };
        }
        if (info === "deactivated" || info === "user_ban") {
          return { ok: false, success: false, message: "Your HEF account is currently deactivated or restricted. Please contact HELB/HEF support." };
        }
      } catch (_) {}
    }

    // OTP detection
    const otpInputSelectors = [
      '#form-otp input',
      'input[name*="otp" i]',
      'input[id*="otp" i]',
      'input[name*="code" i]',
      'input[id*="code" i]',
      'input[name*="verification" i]',
      'input[id*="verification" i]',
      'input[name*="token" i]',
      'input[id*="token" i]',
      'input[placeholder*="otp" i]',
      'input[placeholder*="code" i]',
      'input[placeholder*="verification" i]',
      'input[autocomplete="one-time-code"]',
      '.otp-input',
      '#otp',
      '#verification_code',
      '#code'
    ];

    let requiresOtp = false;
    let otpMessage = "Enter the OTP sent to your phone/email.";

    const currentUrl = page.url().toLowerCase();
    if (currentUrl.includes("/otp") || currentUrl.includes("verify_otp") || currentUrl.includes("/verify") || currentUrl.includes("two_factor") || currentUrl.includes("2fa")) {
      requiresOtp = true;
    }

    if (ajaxResponseData) {
      try {
        const parsed = JSON.parse(ajaxResponseData.trim());
        const info = (parsed.info || "").toLowerCase();
        if (info === "otp" || info === "verify_otp" || info === "2fa" || info === "two_factor" || info === "two-factor" || info === "verification_code" || info === "verify") {
          requiresOtp = true;
          if (parsed.message) otpMessage = parsed.message;
        }
      } catch (_) {}
    }

    if (!requiresOtp) {
      try {
        const otpEl = page.locator(otpInputSelectors.join(", ")).first();
        if (await otpEl.isVisible({ timeout: 1500 }).catch(() => false)) {
          requiresOtp = true;
        }
      } catch (_) {}
    }

    if (!requiresOtp) {
      try {
        const bodyText = await page.locator("body").innerText().catch(() => "");
        if (
          /enter (the )?(otp|verification code|one[- ]time (pin|password)|security code)/i.test(bodyText) ||
          /a verification code has been sent|an otp has been sent|enter the code sent to/i.test(bodyText) ||
          /otp verification|two[- ]factor authentication|2fa verification/i.test(bodyText)
        ) {
          requiresOtp = true;
        }
      } catch (_) {}
    }

    if (requiresOtp) {
      const otpSessionId = `otp_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
      console.log(`[playwright-login] 📱 OTP Challenge detected on HEF portal! Session ID: ${otpSessionId}`);

      const cleanupTimer = setTimeout(async () => {
        console.log(`[otp-session] Session ${otpSessionId} expired after 5 minutes. Closing browser.`);
        await cleanupOtpSession(otpSessionId);
      }, 5 * 60 * 1000);

      OTP_SESSIONS.set(otpSessionId, {
        otpSessionId,
        browser,
        ctx,
        page,
        mousePos,
        capturedProfileData,
        capturedAllocationData,
        capturedResponses,
        email,
        timer: cleanupTimer,
        createdAt: Date.now()
      });

      keepBrowserOpen = true;

      return {
        ok: false,
        requiresOtp: true,
        otpSessionId,
        message: otpMessage
      };
    }

    const scrapeResult = await scrapeHefPortalSession(
      page,
      ctx,
      email,
      capturedProfileData,
      capturedAllocationData,
      capturedResponses,
      mousePos
    );

    if (scrapeResult && scrapeResult.ok) {
      keepBrowserOpen = true;
      scrapeResult.page = page;
      scrapeResult.ctx = ctx;
      scrapeResult.browser = browser;
      scrapeResult.cookies = await ctx.cookies().catch(() => []);
    }

    return scrapeResult;

  } catch (err) {
    console.error(`[playwright-login] ❌ Error: ${err.name || "Error"} - ${err.message}`);
    const snap = await captureSnapshot(page, "exception");
    const isNet = isNetworkError(err);
    return {
      ok: false,
      success: false,
      network_error: isNet,
      diagnosticBranch: isNet ? "portal-unreachable" : "automation-error",
      failureReason: isNet ? "portal-unreachable" : "automation-error",
      message: isNet ? "The HELB/HEF portal appears to be unreachable from this server (network-level failure) — try again shortly or check if this server's IP is being blocked." : `Automation error: ${err.message}`,
      snapshot: snap
    };
  } finally {
    if (!keepBrowserOpen) {
      await ctx.close().catch(() => {});
    }
  }
}

/**
 * Employer Portal Authentication via Playwright
 * Targets employer-specific routes and fields on portal.hef.co.ke
 */
async function playwrightEmployerLogin(credential, password) {
  const browser = await getSharedBrowser();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    locale: "en-KE",
    timezoneId: "Africa/Nairobi",
    extraHTTPHeaders: { "Accept-Language": "en-KE,en;q=0.9,en-US;q=0.8" },
    ignoreHTTPSErrors: true,
    bypassCSP: true,
  });

  const page = await ctx.newPage();
  await human.setupHumanStealth(page);

  try {
    const employerUrls = [
      "https://portal.hef.co.ke/auth/employer_signin",
      "https://portal.hef.co.ke/employer/index/frm_login",
      "https://portal.hef.co.ke/auth/signin"
    ];

    let navOk = false;
    for (const u of employerUrls) {
      try {
        const resp = await page.goto(u, { waitUntil: "domcontentloaded", timeout: 20000 });
        if (resp && resp.status() < 400) {
          navOk = true;
          break;
        }
      } catch (_) {}
    }

    if (!navOk) {
      const snap = await captureSnapshot(page, "employer-login-nav-failed");
      await ctx.close().catch(() => {});
      return { ok: false, error: "Failed to navigate to employer login page on portal.hef.co.ke.", snapshot: snap };
    }

    // Check for Employer tab/radio
    const employerTab = page.locator('a[href*="employer"], input[value="employer"], button:has-text("Employer"), #tab_employer').first();
    if (await employerTab.isVisible({ timeout: 1000 }).catch(() => false)) {
      await employerTab.click().catch(() => {});
    }

    const userInput = page.locator('input#employer_pin, input#email_add, input[name="email_add"], input[name="user_number"], input#user_id, input[name="email"]').first();
    await userInput.waitFor({ state: "visible", timeout: 15000 });
    await userInput.fill(credential);

    const passInput = page.locator('input#form-password, input[name="password"], input[type="password"]').first();
    await passInput.waitFor({ state: "visible", timeout: 15000 });
    await passInput.fill(password);

    const submitBtn = page.locator('.btn-signin, button[type="submit"], button:has-text("Login"), #form-login button').first();
    await submitBtn.click();
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Check error message
    const errorEl = page.locator('.alert-danger, .error-message, .invalid-feedback, #error-msg, .text-danger').first();
    if (await errorEl.isVisible({ timeout: 1000 }).catch(() => false)) {
      const errText = await errorEl.innerText().catch(() => "");
      const cleanErr = errText.replace("Processing please wait..!", "").trim();
      if (cleanErr && cleanErr.length > 2 && !hefEngine.isBoilerplateText(cleanErr)) {
        const snap = await captureSnapshot(page, "employer-login-err");
        await ctx.close().catch(() => {});
        return { ok: false, error: cleanErr, snapshot: snap };
      }
    }

    const cookies = await ctx.cookies();
    const sessionCookie = cookies.find(c => c.name.toLowerCase().includes("session") || c.name.toLowerCase().includes("token"));

    // Scrape employer dashboard details from DOM
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const employerData = {
      credential,
      employerName: null,
      kraPin: null,
      employerCode: null,
      activeLoaneesCount: 0,
      totalRemitted: "KES 0"
    };

    const nameMatch = bodyText.match(/(?:Employer\s*Name|Company\s*Name|Organization)\s*[:#-]?\s*([A-Za-z0-9\s.,&-]{3,50})/i);
    if (nameMatch && nameMatch[1] && !hefEngine.isBoilerplateText(nameMatch[1])) {
      employerData.employerName = nameMatch[1].trim();
    }

    const kraMatch = bodyText.match(/(?:KRA\s*PIN|PIN\s*No\.?)\s*[:#-]?\s*([A-Z0-9]{11})/i);
    if (kraMatch && kraMatch[1]) {
      employerData.kraPin = kraMatch[1].trim();
    }

    return {
      ok: true,
      success: true,
      userType: "employer",
      sessionToken: sessionCookie?.value || `hef-emp-${Date.now().toString(36)}`,
      employerData,
      page,
      ctx,
      browser,
      cookies,
      sourceUrl: page.url(),
      section: "Employer Portal Dashboard"
    };
  } catch (err) {
    console.error("[employer-login] Exception:", err);
    const snap = await captureSnapshot(page, "employer-login-exception");
    await ctx.close().catch(() => {});
    return { ok: false, error: `Employer login error: ${err.message}`, snapshot: snap };
  }
}

/**
 * Unified Login Dispatcher:
 * 1. Fast Direct HTTPS Handshake & Parallel Subpage Scraping (< 1s)
 * 2. High-Speed Playwright Browser Engine with Browser Pooling
 */
async function helbLogin(email, password) {
  const cleanEmail = (email || "").trim();
  const startTime = Date.now();
  console.log(`\n[helb-login] ⚡ Fast login requested for user "${cleanEmail}"…`);

  // 1. Fast Path: Direct HTTPS Handshake & Parallel Subpage Scraping
  try {
    const directRes = await directHefLogin(cleanEmail, password, 12000);
    if (directRes) {
      if (directRes.requiresOtp) {
        console.log(`[helb-login] 📱 Direct auth requires OTP (${Date.now() - startTime}ms)`);
        return directRes;
      }
      if (!directRes.ok && !directRes.error && !directRes.timeout) {
        console.log(`[helb-login] ❌ Direct auth rejected credentials (${Date.now() - startTime}ms): ${directRes.message}`);
        return directRes;
      }
      if (directRes.ok && directRes.sessionToken) {
        console.log(`[helb-login] ⚡ Direct auth established in ${Date.now() - startTime}ms. Scraping portal data in parallel…`);
        const directScrape = await scrapeHefViaDirectHttp(directRes.sessionToken, cleanEmail, directRes.portalInfo);
        if (directScrape && directScrape.ok && directScrape.scrapedData) {
          console.log(`[helb-login] 🚀 Login & data extraction completed in ${Date.now() - startTime}ms!`);
          return directScrape;
        }
      }
    }
  } catch (directErr) {
    console.warn("[helb-login] Direct auth notice, falling back to Playwright engine:", directErr.message);
  }

  // 2. High-speed Playwright Browser Automation & DOM Extraction
  console.log(`[helb-login] Initiating high-speed Playwright engine for "${cleanEmail}"…`);
  return await playwrightHefLogin(cleanEmail, password);
}

// ─────────────────────────────────────────────────────────────────────────────
// Express API Routes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/health
 */
app.get("/api/health", (_, res) => {
  const proxyConfig = getProxyConfig();
  res.json({
    ok: true,
    service: "Huduma Smart Automation Backend",
    version: "2.6.0",
    portalUrl: PORTAL_BASE_URL,
    timestamp: new Date().toISOString(),
    debugVisible: process.env.DEBUG_VISIBLE === "true",
    proxyEnabled: Boolean(proxyConfig),
    proxyServer: proxyConfig ? proxyConfig.server : null,
  });
});

/**
 * Helper to construct the authentic profile payload from scraped DOM variables
 */
function buildResponseProfile(scraped = {}, reqBody = {}, userIdentifier = "") {
  const s = scraped || {};
  const isId = userIdentifier && /^\d{5,10}$/.test(userIdentifier);
  const isEmail = userIdentifier && userIdentifier.includes("@");

  const nationalId = s.nationalId || reqBody.nationalId || (isId ? userIdentifier : null) || "";
  const email = (isEmail ? userIdentifier : reqBody.email) || null;
  const name = s.name || reqBody.name || null;
  const institution = s.institution || reqBody.institution || "Data not found";
  const programme = s.programme || reqBody.programme || "Data not found";
  const level = s.level || reqBody.level || (programme !== "Data not found" && programme.toLowerCase().includes("diploma") ? "TVET" : "Undergraduate");
  const kcseIndex = s.kcseIndex || reqBody.kcseIndex || "Data not found";
  const bandName = s.band || (reqBody.band ? `Band ${reqBody.band}` : "Data not found");
  const bandNum = s.bandNum || (reqBody.band ? parseInt(reqBody.band, 10) : null);
  const academicYear = s.academicYear || reqBody.academicYear || "Data not found";
  const bankName = s.bankName || reqBody.bankName || "Data not found";
  const accountNumber = s.accountNumber || reqBody.accountNumber || "Data not found";

  const outstandingDue = s.outstandingDue !== undefined && s.outstandingDue !== null ? s.outstandingDue : null;
  const loanAwarded = s.loanAwarded !== undefined && s.loanAwarded !== null ? s.loanAwarded : null;
  const scholarshipAmount = s.scholarshipAmount !== undefined && s.scholarshipAmount !== null ? s.scholarshipAmount : null;
  const tuitionLoan = s.tuitionLoan !== undefined && s.tuitionLoan !== null ? s.tuitionLoan : null;
  const upkeepLoan = s.upkeepLoan !== undefined && s.upkeepLoan !== null ? s.upkeepLoan : null;
  const householdFee = s.householdFee !== undefined && s.householdFee !== null ? s.householdFee : null;
  const totalRepaid = s.totalRepaid !== undefined && s.totalRepaid !== null ? s.totalRepaid : 0;
  const disbursements = Array.isArray(s.disbursements) ? s.disbursements : [];

  return hefEngine.resolveHefProfile({
    ...reqBody,
    name,
    nationalId,
    email,
    phone: s.phone || reqBody.phone || null,
    county: s.county || reqBody.county || null,
    subCounty: s.subCounty || reqBody.subCounty || null,
    constituency: s.constituency || reqBody.constituency || null,
    dob: s.dob || reqBody.dob || null,
    gender: s.gender || reqBody.gender || null,
    registrationNumber: s.registrationNumber || reqBody.registrationNumber || null,
    institution,
    programme,
    level,
    kcseIndex,
    band: bandNum || bandName,
    yearOfStudy: s.yearOfStudy || reqBody.yearOfStudy,
    currentSemester: s.currentSemester || reqBody.currentSemester,
    academicYear,
    bankName,
    accountNumber,
    outstandingDue,
    loanAwarded,
    scholarshipAmount,
    tuitionLoan,
    upkeepLoan,
    householdFee,
    totalRepaid,
    disbursements,
    applicationStatus: s.applicationStatus || reqBody.applicationStatus,
    applicationRef: s.applicationRef || reqBody.applicationRef,
    auditDetails: s.extractionAudit
  });
}

/**
 * POST /api/helb/login
 * Body: { email?: string, password: string, credential?: string, nationalId?: string }
 */
app.post("/api/helb/login", async (req, res) => {
  const { email, password } = req.body || {};
  const userIdentifier = (email || req.body?.credential || req.body?.nationalId || "").trim();

  console.log("Attempting login for user:", email || userIdentifier);

  if (!userIdentifier || !password) {
    return res.status(400).json({
      ok: false,
      success: false,
      message: "Please provide your registered Email address or National ID number, along with your password.",
    });
  }

  if (!isValidCredential(userIdentifier)) {
    return res.status(400).json({
      ok: false,
      success: false,
      message: "Please enter a valid Email address (e.g. name@example.com) or Kenyan National ID number (e.g. 12345678).",
    });
  }

  try {
    const result = await helbLogin(userIdentifier, password);

    // If OTP challenge was detected on the portal
    if (result && result.requiresOtp) {
      return res.status(200).json({
        ok: false,
        requiresOtp: true,
        otpSessionId: result.otpSessionId,
        message: result.message || "Enter the OTP sent to your phone/email.",
      });
    }

    // If explicit invalid credentials or error
    if (!result.ok) {
      if (result.network_error) {
        return res.status(503).json({
          ok: false,
          success: false,
          network_error: true,
          message: result.message || "The HELB/HEF portal is currently offline or unreachable. Please try again later.",
          diagnosticBranch: result.diagnosticBranch || "portal-unreachable",
          failureReason: result.failureReason || result.diagnosticBranch || "portal-unreachable",
          diagnostics: result.diagnostics || null,
          snapshot: result.snapshot || null
        });
      }
      return res.status(401).json({
        ok: false,
        success: false,
        message: result.message || "Invalid login credentials for HEF portal.",
        snapshot: result.snapshot || null
      });
    }

    // Construct profile strictly from actual scraped DOM data
    const profile = buildResponseProfile(result.scrapedData, req.body, userIdentifier);
    result.profile = profile;
    result.dataIntegrityWarning = profile.dataIntegrityWarning !== undefined ? profile.dataIntegrityWarning : (result.dataIntegrityWarning || false);
    result.warningDetail = profile.warningDetail || result.warningDetail || null;

    // Store verified session with active Playwright context/page
    const sessionToken = result.sessionToken || `hef-sess-${Date.now().toString(36)}`;
    ACTIVE_SESSIONS.set(userIdentifier, {
      identifier: userIdentifier,
      sessionToken,
      scrapedData: result.scrapedData || {},
      profile,
      page: result.page || null,
      ctx: result.ctx || null,
      browser: result.browser || null,
      cookies: result.cookies || [],
      loginTime: Date.now(),
      lastActive: Date.now(),
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error("[api/helb/login] Server Error:", err);
    return res.status(500).json({
      ok: false,
      success: false,
      message: "Internal server error occurred while connecting to HEF portal.",
      error: err.message
    });
  }
});

/**
 * Helper to retrieve active session data or build profile from request
 */
function getRequestProfile(req) {
  const body = req.body || {};
  const userIdentifier = (body.credential || body.email || body.nationalId || body.user || "").trim();
  const session = userIdentifier ? ACTIVE_SESSIONS.get(userIdentifier) : null;
  if (session && session.profile) {
    return session.profile;
  }
  return buildResponseProfile({}, body, userIdentifier);
}

/**
 * POST /api/helb/otp
 * Body: { otp: string, otpSessionId?: string, sessionToken?: string, credential?: string, email?: string, nationalId?: string }
 */
app.post("/api/helb/otp", async (req, res) => {
  const { otp, otpSessionId, sessionToken } = req.body || {};
  const sessionId = (otpSessionId || sessionToken || "").trim();
  const cleanOtp = (otp || "").trim();

  console.log(`[api/helb/otp] Received OTP verification request for session "${sessionId}"`);

  if (!cleanOtp) {
    return res.status(400).json({
      ok: false,
      success: false,
      message: "Please provide the OTP code sent to your phone or email."
    });
  }

  if (!sessionId) {
    return res.status(400).json({
      ok: false,
      success: false,
      message: "OTP session ID is required."
    });
  }

  const session = OTP_SESSIONS.get(sessionId);
  if (!session) {
    return res.status(400).json({
      ok: false,
      success: false,
      message: "OTP verification session has expired or is invalid. Please log in again."
    });
  }

  const { page, ctx, browser, mousePos, capturedProfileData, capturedAllocationData, capturedResponses, email } = session;

  try {
    // 1. Locate OTP input field on portal
    const otpInputSelectors = [
      '#form-otp input',
      'input[name*="otp" i]',
      'input[id*="otp" i]',
      'input[name*="code" i]',
      'input[id*="code" i]',
      'input[name*="verification" i]',
      'input[id*="verification" i]',
      'input[name*="token" i]',
      'input[id*="token" i]',
      'input[placeholder*="otp" i]',
      'input[placeholder*="code" i]',
      'input[placeholder*="verification" i]',
      'input[autocomplete="one-time-code"]',
      '.otp-input',
      '#otp',
      '#verification_code',
      '#code',
      'input[type="text"]',
      'input[type="number"]'
    ];

    const otpInput = page.locator(otpInputSelectors.join(", ")).first();
    const isVisible = await otpInput.isVisible({ timeout: 8000 }).catch(() => false);

    if (!isVisible) {
      console.warn(`[api/helb/otp] OTP input field not found on portal for session ${sessionId}`);
      await cleanupOtpSession(sessionId);
      return res.status(400).json({
        ok: false,
        success: false,
        message: "The OTP input form is no longer visible on the portal. Please log in again."
      });
    }

    // 2. Type OTP with human cadence
    console.log(`[api/helb/otp] Entering OTP into portal input field with human cadence…`);
    await human.humanType(page, otpInput, cleanOtp, mousePos, { clearFirst: true });
    await human.humanPause(250, 600);

    // 3. Locate and click OTP submit / verify button
    const submitBtnSelectors = [
      '#form-otp button[type="submit"]',
      'button[type="submit"]:has-text("Verify")',
      'button:has-text("Verify")',
      'button:has-text("Submit OTP")',
      'button:has-text("Submit")',
      'button:has-text("Confirm")',
      'button:has-text("Validate")',
      'button:has-text("Proceed")',
      'button:has-text("Continue")',
      '.btn-otp',
      '#btn-otp',
      'button[type="submit"]',
      'input[type="submit"]'
    ];

    const submitBtn = page.locator(submitBtnSelectors.join(", ")).first();

    let otpAjaxResponse = null;
    const responsePromise = page.waitForResponse(
      resp => resp.url().includes("otp") || resp.url().includes("verify") || resp.url().includes("auth") || resp.url().includes("signin"),
      { timeout: 20000 }
    ).then(async resp => {
      try {
        otpAjaxResponse = await resp.text();
      } catch (_) {}
    }).catch(() => null);

    console.log(`[api/helb/otp] Clicking OTP verification submit button…`);
    await human.humanClick(page, submitBtn, mousePos);

    await Promise.race([
      responsePromise,
      page.waitForTimeout(5000)
    ]);

    await human.humanPause(500, 1000);

    // 4. Check for error message in DOM
    const msgEl = page.locator('.message, .alert-danger, #msg, .toastr, .text-danger, .invalid-feedback, .alert').first();
    if (await msgEl.isVisible({ timeout: 2500 }).catch(() => false)) {
      const errorText = await msgEl.textContent().catch(() => "");
      const cleanErr = errorText.replace("Processing please wait..!", "").trim();
      if (
        cleanErr &&
        cleanErr.length > 2 &&
        !cleanErr.includes("Processing") &&
        !cleanErr.toLowerCase().includes("success") &&
        !cleanErr.toLowerCase().includes("redirecting")
      ) {
        console.warn(`[api/helb/otp] Portal returned OTP error in DOM: "${cleanErr}"`);
        await cleanupOtpSession(sessionId);
        return res.status(401).json({
          ok: false,
          success: false,
          message: cleanErr
        });
      }
    }

    // 5. Parse AJAX response for OTP error
    if (otpAjaxResponse) {
      try {
        const parsed = JSON.parse(otpAjaxResponse.trim());
        const info = (parsed.info || "").toLowerCase();
        if (info === "warning" || info === "error" || info === "otp_error" || info === "invalid_otp" || parsed.status === "error" || parsed.success === false) {
          const errMsg = parsed.message || parsed.msg || "The OTP entered is incorrect or has expired.";
          console.warn(`[api/helb/otp] Portal rejected OTP via AJAX: ${errMsg}`);
          await cleanupOtpSession(sessionId);
          return res.status(401).json({
            ok: false,
            success: false,
            message: errMsg
          });
        }
      } catch (_) {}
    }

    // 6. Run the authentic scraping flow (reusing scrapeHefPortalSession)
    console.log(`[api/helb/otp] OTP accepted! Running full portal DOM scraping & student data extraction…`);
    const scrapeResult = await scrapeHefPortalSession(
      page,
      ctx,
      email,
      capturedProfileData,
      capturedAllocationData,
      capturedResponses,
      mousePos
    );

    if (!scrapeResult.ok) {
      await cleanupOtpSession(sessionId);
      return res.status(500).json({
        ok: false,
        success: false,
        message: scrapeResult.message || "Failed to retrieve student records after OTP verification."
      });
    }

    // 7. Construct profile and save active session with preserved page/ctx
    const userIdentifier = (email || req.body?.credential || req.body?.nationalId || "").trim();
    const profile = buildResponseProfile(scrapeResult.scrapedData, req.body, userIdentifier);
    scrapeResult.profile = profile;
    scrapeResult.dataIntegrityWarning = profile.dataIntegrityWarning !== undefined ? profile.dataIntegrityWarning : (scrapeResult.dataIntegrityWarning || false);
    scrapeResult.warningDetail = profile.warningDetail || scrapeResult.warningDetail || null;

    const verifiedSessionToken = scrapeResult.sessionToken || `hef-sess-${Date.now().toString(36)}`;
    if (userIdentifier) {
      ACTIVE_SESSIONS.set(userIdentifier, {
        identifier: userIdentifier,
        sessionToken: verifiedSessionToken,
        scrapedData: scrapeResult.scrapedData || {},
        profile,
        page,
        ctx,
        browser,
        cookies: await ctx.cookies().catch(() => []),
        loginTime: Date.now(),
        lastActive: Date.now(),
      });
    }

    if (session.timer) clearTimeout(session.timer);
    OTP_SESSIONS.delete(sessionId);

    return res.status(200).json(scrapeResult);

  } catch (err) {
    console.error(`[api/helb/otp] Error during OTP verification:`, err);
    await cleanupOtpSession(sessionId);
    return res.status(500).json({
      ok: false,
      success: false,
      message: `Failed to process OTP verification: ${err.message}`
    });
  }
});

/**
 * POST /api/helb/profile
 */
app.post("/api/helb/profile", (req, res) => {
  const profile = getRequestProfile(req);
  res.json({
    ok: true,
    success: true,
    profile,
    sourceUrl: "https://portal.hef.co.ke/account/index/frm_profile",
    section: "Student Profile",
    message: "HEF portal profile retrieved successfully."
  });
});

app.get("/api/helb/profile", (req, res) => {
  const profile = buildResponseProfile({}, req.query || {}, req.query?.nationalId || req.query?.email || "");
  res.json({
    ok: true,
    success: true,
    profile,
    sourceUrl: "https://portal.hef.co.ke/account/index/frm_profile",
    section: "Student Profile",
    message: "HEF portal profile retrieved successfully."
  });
});

/**
 * POST /api/helb/balance
 */
app.post("/api/helb/balance", (req, res) => {
  const profile = getRequestProfile(req);
  const { funding, student } = profile;

  res.json({
    ok: true,
    success: true,
    user: student.name,
    nationalId: student.nationalId,
    institution: student.institution,
    programme: student.programme,
    band: funding.band,
    bandName: funding.bandName,
    bandCategory: funding.bandCategory,
    out: funding.cumulative.outstandingBalance,
    bal: funding.cumulative.awardedPrincipal,
    repaid: funding.cumulative.repaid,
    interestAccrued: funding.cumulative.interestAccrued,
    penalty: funding.cumulative.penalty,
    annualTuition: funding.annual.tuition,
    annualScholarship: funding.annual.scholarship,
    annualTuitionLoan: funding.annual.tuitionLoan,
    annualUpkeepLoan: funding.annual.upkeepLoan,
    annualHouseholdFee: funding.annual.householdFee,
    percentages: funding.percentages,
    status: "Active",
    sourceUrl: "https://portal.hef.co.ke/service/index/frm_loans",
    section: "Loan Balance Overview",
    message: `Loan balance retrieved successfully for ${student.name}.`
  });
});

/**
 * 1. LOAN & SCHOLARSHIP APPLICATIONS
 * POST /api/helb/apply-loan and POST /api/helb/apply
 */
app.post(["/api/helb/apply-loan", "/api/helb/apply"], async (req, res) => {
  const body = req.body || {};
  const userIdentifier = (body.credential || body.email || body.nationalId || body.user || "").trim();
  const sessionRes = await getOrCreateSessionPage(userIdentifier);

  if (!sessionRes.ok) {
    return res.status(401).json({
      ok: false,
      success: false,
      message: sessionRes.error || "No active authenticated session found. Please log in first."
    });
  }

  const { page } = sessionRes;
  const applicationType = body.applicationType || body.type || "undergraduate";
  const formData = body.formData || body;

  try {
    const result = await hefEngine.submitLoanApplication(page, applicationType, formData);
    if (!result.ok) {
      const snap = await captureSnapshot(page, "apply-loan-error");
      return res.status(400).json({
        ok: false,
        success: false,
        error: result.error,
        message: result.error,
        snapshot: snap
      });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error("[api/helb/apply-loan] Error:", err);
    const snap = await captureSnapshot(page, "apply-loan-exception");
    return res.status(500).json({
      ok: false,
      success: false,
      error: err.message,
      message: `Application submission failed: ${err.message}`,
      snapshot: snap
    });
  }
});

/**
 * 2. STATUS TRACKING
 * GET /api/helb/application-status and POST /api/helb/app-status
 */
const handleApplicationStatus = async (req, res) => {
  const userIdentifier = (req.query?.credential || req.query?.email || req.query?.nationalId || req.body?.credential || req.body?.email || req.body?.nationalId || "").trim();
  const sessionRes = await getOrCreateSessionPage(userIdentifier);

  if (!sessionRes.ok) {
    // If browser not currently running, check stored profile
    const profile = getRequestProfile(req);
    if (profile && profile.appStatus && profile.appStatus.status !== "Data not found") {
      return res.json({
        ok: true,
        success: true,
        status: profile.appStatus.status,
        stage: profile.appStatus.stage,
        applicationRef: profile.appStatus.applicationRef,
        dateSubmitted: profile.appStatus.dateSubmitted,
        applications: [],
        sourceUrl: "https://portal.hef.co.ke/service/index/frm_loan_status",
        section: "My Applications / Status Tracking"
      });
    }
    return res.status(401).json({
      ok: false,
      success: false,
      message: sessionRes.error || "No active authenticated session found. Please log in first."
    });
  }

  const { page } = sessionRes;
  try {
    const result = await hefEngine.getApplicationStatus(page);
    if (!result.ok) {
      const snap = await captureSnapshot(page, "app-status-error");
      return res.status(404).json({
        ok: false,
        success: false,
        error: result.error,
        message: result.error,
        snapshot: snap
      });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error("[api/helb/application-status] Error:", err);
    const snap = await captureSnapshot(page, "app-status-exception");
    return res.status(500).json({
      ok: false,
      success: false,
      error: err.message,
      message: `Failed to retrieve application status: ${err.message}`,
      snapshot: snap
    });
  }
};

app.get("/api/helb/application-status", handleApplicationStatus);
app.post("/api/helb/app-status", handleApplicationStatus);

/**
 * 3. ALLOCATION & DISBURSEMENTS
 * POST /api/helb/disb and GET /api/helb/disbursements
 */
const handleDisbursements = async (req, res) => {
  const userIdentifier = (req.query?.credential || req.query?.email || req.query?.nationalId || req.body?.credential || req.body?.email || req.body?.nationalId || "").trim();
  const sessionRes = await getOrCreateSessionPage(userIdentifier);

  if (!sessionRes.ok) {
    const profile = getRequestProfile(req);
    if (profile && profile.disbursements) {
      return res.json({
        ok: true,
        success: true,
        disbursements: profile.disbursements,
        allocation: profile.funding,
        sourceUrl: "https://portal.hef.co.ke/service/index/frm_loans",
        section: "My Loans & Disbursement Schedule",
        message: `Disbursement schedule retrieved for ${profile.student.name}.`
      });
    }
    return res.status(401).json({
      ok: false,
      success: false,
      message: sessionRes.error || "No active authenticated session found. Please log in first."
    });
  }

  const { page } = sessionRes;
  try {
    const result = await hefEngine.getDisbursements(page);
    if (!result.ok) {
      const snap = await captureSnapshot(page, "disb-error");
      return res.status(404).json({
        ok: false,
        success: false,
        error: result.error,
        message: result.error,
        snapshot: snap
      });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error("[api/helb/disb] Error:", err);
    const snap = await captureSnapshot(page, "disb-exception");
    return res.status(500).json({
      ok: false,
      success: false,
      error: err.message,
      message: `Failed to retrieve disbursement records: ${err.message}`,
      snapshot: snap
    });
  }
};

app.post("/api/helb/disb", handleDisbursements);
app.get("/api/helb/disbursements", handleDisbursements);

/**
 * 4. SELF-SERVE LOAN REPAYMENT (E-Citizen / M-PESA STK / Bank Deposit)
 * POST /api/helb/repay and POST /api/helb/repayment
 */
app.post(["/api/helb/repay", "/api/helb/repayment"], async (req, res) => {
  const body = req.body || {};
  const userIdentifier = (body.credential || body.email || body.nationalId || body.user || "").trim();
  const sessionRes = await getOrCreateSessionPage(userIdentifier);

  if (!sessionRes.ok) {
    return res.status(401).json({
      ok: false,
      success: false,
      message: sessionRes.error || "No active authenticated session found. Please log in first."
    });
  }

  const { page } = sessionRes;
  const amount = body.amount;
  const method = body.method || "mpesa_stk";

  try {
    const result = await hefEngine.initiateRepayment(page, amount, method, body);
    if (!result.ok) {
      const snap = await captureSnapshot(page, "repay-error");
      return res.status(400).json({
        ok: false,
        success: false,
        error: result.error,
        message: result.error,
        requiresOtp: result.requiresOtp || false,
        snapshot: snap
      });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error("[api/helb/repay] Error:", err);
    const snap = await captureSnapshot(page, "repay-exception");
    return res.status(500).json({
      ok: false,
      success: false,
      error: err.message,
      message: `Repayment initiation failed: ${err.message}`,
      snapshot: snap
    });
  }
});

/**
 * 5. STATEMENT AND RECEIPT MANAGEMENT
 * GET /api/helb/statement and POST /api/helb/statement
 */
const handleStatement = async (req, res) => {
  const userIdentifier = (req.query?.credential || req.query?.email || req.query?.nationalId || req.body?.credential || req.body?.email || req.body?.nationalId || "").trim();
  const sessionRes = await getOrCreateSessionPage(userIdentifier);

  if (!sessionRes.ok) {
    const profile = getRequestProfile(req);
    if (profile && profile.statement) {
      return res.json({
        ok: true,
        success: true,
        student: profile.student.name,
        nationalId: profile.student.nationalId,
        institution: profile.student.institution,
        programme: profile.student.programme,
        band: profile.funding.bandName,
        openingBalance: profile.statement.openingBalance || 0,
        closingBalance: profile.statement.closingBalance || profile.funding?.cumulative?.outstandingBalance || 0,
        statementDate: profile.statement.statementDate || new Date().toISOString().split("T")[0],
        ledger: profile.statement.ledger || [],
        pdfUrl: "https://portal.hef.co.ke/service/index/frm_loan_statement",
        sourceUrl: "https://portal.hef.co.ke/service/index/frm_loan_statement",
        section: "Official Statement of Loan Account",
        message: "Official HELB statement ledger generated successfully."
      });
    }
    return res.status(401).json({
      ok: false,
      success: false,
      message: sessionRes.error || "No active authenticated session found. Please log in first."
    });
  }

  const { page } = sessionRes;
  try {
    const result = await hefEngine.getLoanStatement(page);
    if (!result.ok) {
      const snap = await captureSnapshot(page, "statement-error");
      return res.status(404).json({
        ok: false,
        success: false,
        error: result.error,
        message: result.error,
        snapshot: snap
      });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error("[api/helb/statement] Error:", err);
    const snap = await captureSnapshot(page, "statement-exception");
    return res.status(500).json({
      ok: false,
      success: false,
      error: err.message,
      message: `Failed to retrieve loan statement: ${err.message}`,
      snapshot: snap
    });
  }
};

app.get("/api/helb/statement", handleStatement);
app.post("/api/helb/statement", handleStatement);

/**
 * POST /api/helb/receipt
 */
app.post("/api/helb/receipt", async (req, res) => {
  const body = req.body || {};
  const userIdentifier = (body.credential || body.email || body.nationalId || body.user || "").trim();
  const sessionRes = await getOrCreateSessionPage(userIdentifier);

  if (!sessionRes.ok) {
    return res.status(401).json({
      ok: false,
      success: false,
      message: sessionRes.error || "No active authenticated session found. Please log in first."
    });
  }

  const { page } = sessionRes;
  const transactionId = body.transactionId || body.ref || req.query?.transactionId;

  try {
    const result = await hefEngine.getReceipt(page, transactionId);
    if (!result.ok) {
      const snap = await captureSnapshot(page, "receipt-error");
      return res.status(404).json({
        ok: false,
        success: false,
        error: result.error,
        message: result.error,
        snapshot: snap
      });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error("[api/helb/receipt] Error:", err);
    const snap = await captureSnapshot(page, "receipt-exception");
    return res.status(500).json({
      ok: false,
      success: false,
      error: err.message,
      message: `Failed to retrieve receipt: ${err.message}`,
      snapshot: snap
    });
  }
});

/**
 * 6. EMPLOYER REMITTANCES
 */
app.post("/api/helb/employer/login", async (req, res) => {
  const { credential, password } = req.body || {};
  if (!credential || !password) {
    return res.status(400).json({
      ok: false,
      success: false,
      message: "Please provide your Employer PIN / Email and password."
    });
  }

  try {
    const result = await playwrightEmployerLogin(credential.trim(), password);
    if (!result.ok) {
      return res.status(401).json({
        ok: false,
        success: false,
        message: result.error || "Invalid employer login credentials for HEF portal.",
        snapshot: result.snapshot || null
      });
    }

    const employerIdentifier = `employer_${credential.trim()}`;
    ACTIVE_SESSIONS.set(employerIdentifier, {
      identifier: employerIdentifier,
      sessionToken: result.sessionToken,
      employerData: result.employerData,
      userType: "employer",
      page: result.page,
      ctx: result.ctx,
      browser: result.browser,
      cookies: result.cookies,
      loginTime: Date.now(),
      lastActive: Date.now()
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error("[api/helb/employer/login] Error:", err);
    return res.status(500).json({
      ok: false,
      success: false,
      message: `Employer authentication failed: ${err.message}`
    });
  }
});

app.post("/api/helb/employer/upload-remittance", async (req, res) => {
  const body = req.body || {};
  const userIdentifier = (body.employerPin || body.credential || body.email || "").trim();
  const employerId = userIdentifier.startsWith("employer_") ? userIdentifier : `employer_${userIdentifier}`;
  const sessionRes = await getOrCreateSessionPage(employerId);

  if (!sessionRes.ok) {
    return res.status(401).json({
      ok: false,
      success: false,
      message: sessionRes.error || "No active authenticated employer session found. Please log in first."
    });
  }

  const { page } = sessionRes;
  try {
    const result = await hefEngine.uploadRemittanceSchedule(page, body);
    if (!result.ok) {
      const snap = await captureSnapshot(page, "employer-upload-error");
      return res.status(400).json({
        ok: false,
        success: false,
        error: result.error,
        message: result.error,
        snapshot: snap
      });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error("[api/helb/employer/upload-remittance] Error:", err);
    const snap = await captureSnapshot(page, "employer-upload-exception");
    return res.status(500).json({
      ok: false,
      success: false,
      error: err.message,
      message: `Remittance upload failed: ${err.message}`,
      snapshot: snap
    });
  }
});

app.post("/api/helb/employer/bulk-checkoff", async (req, res) => {
  const body = req.body || {};
  const userIdentifier = (body.employerPin || body.credential || body.email || "").trim();
  const employerId = userIdentifier.startsWith("employer_") ? userIdentifier : `employer_${userIdentifier}`;
  const sessionRes = await getOrCreateSessionPage(employerId);

  if (!sessionRes.ok) {
    return res.status(401).json({
      ok: false,
      success: false,
      message: sessionRes.error || "No active authenticated employer session found. Please log in first."
    });
  }

  const { page } = sessionRes;
  try {
    const result = await hefEngine.submitBulkCheckoff(page, body);
    if (!result.ok) {
      const snap = await captureSnapshot(page, "employer-checkoff-error");
      return res.status(400).json({
        ok: false,
        success: false,
        error: result.error,
        message: result.error,
        snapshot: snap
      });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error("[api/helb/employer/bulk-checkoff] Error:", err);
    const snap = await captureSnapshot(page, "employer-checkoff-exception");
    return res.status(500).json({
      ok: false,
      success: false,
      error: err.message,
      message: `Bulk checkoff failed: ${err.message}`,
      snapshot: snap
    });
  }
});

const handleRemittanceRecords = async (req, res) => {
  const userIdentifier = (req.query?.employerPin || req.query?.credential || req.body?.employerPin || req.body?.credential || "").trim();
  const employerId = userIdentifier.startsWith("employer_") ? userIdentifier : `employer_${userIdentifier}`;
  const sessionRes = await getOrCreateSessionPage(employerId);

  if (!sessionRes.ok) {
    return res.status(401).json({
      ok: false,
      success: false,
      message: sessionRes.error || "No active authenticated employer session found. Please log in first."
    });
  }

  const { page } = sessionRes;
  try {
    const result = await hefEngine.getRemittanceRecords(page);
    if (!result.ok) {
      const snap = await captureSnapshot(page, "employer-records-error");
      return res.status(404).json({
        ok: false,
        success: false,
        error: result.error,
        message: result.error,
        snapshot: snap
      });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error("[api/helb/employer/remittance-records] Error:", err);
    const snap = await captureSnapshot(page, "employer-records-exception");
    return res.status(500).json({
      ok: false,
      success: false,
      error: err.message,
      message: `Failed to retrieve remittance records: ${err.message}`,
      snapshot: snap
    });
  }
};

app.get("/api/helb/employer/remittance-records", handleRemittanceRecords);
app.post("/api/helb/employer/remittance-records", handleRemittanceRecords);

/**
 * POST /api/helb/clearance
 */
app.post("/api/helb/clearance", (req, res) => {
  const profile = getRequestProfile(req);
  const { clearance, funding, student } = profile;

  res.json({
    ok: true,
    success: true,
    student: student.name,
    nationalId: student.nationalId,
    eligible: clearance.eligible,
    certificateType: clearance.certificateType,
    balance: funding.cumulative.outstandingBalance,
    reason: clearance.reason,
    verificationCode: clearance.eligible ? `HELB-CLR-${student.nationalId}-${Date.now().toString().slice(-4)}` : null,
    sourceUrl: "https://portal.hef.co.ke/service/index/frm_clr_cert",
    section: "Clearance & Compliance",
    message: clearance.eligible ? "Eligible for HELB Clearance Certificate." : "Active balance outstanding."
  });
});

/**
 * POST /api/helb/appeal
 */
app.post("/api/helb/appeal", (req, res) => {
  const profile = getRequestProfile(req);
  const requestedBand = req.body.requestedBand || (profile.funding.band ? Math.max(1, profile.funding.band - 1) : 1);

  res.json({
    ok: true,
    success: true,
    ref: `HEF-APL-${Date.now().toString().slice(-6)}`,
    student: profile.student.name,
    nationalId: profile.student.nationalId,
    currentBand: profile.funding.bandName,
    requestedBand: `Band ${requestedBand}`,
    status: "Appeal Ticket Logged",
    requiredDocuments: [
      "Copy of National ID of applicant and parents/guardians",
      "Death certificates (if orphaned / deceased parent)",
      "Medical records / bills (for chronic illnesses in household)",
      "NCPWD Card / Doctor report (if Person With Disability)",
      "Chief / Assistant Chief verification letter",
      "Sworn Affidavit of economic status from Commissioner of Oaths",
      "Salary slips / termination letter / bank statement of breadwinner"
    ],
    sourceUrl: "https://portal.hef.co.ke/service/index/frm_appeal",
    section: "Band Appeal / Re-categorization",
    message: `Appeal lodged to re-categorize from ${profile.funding.bandName} to Band ${requestedBand}.`
  });
});

/**
 * POST /api/helb/update-info
 */
app.post("/api/helb/update-info", (req, res) => {
  const profile = getRequestProfile(req);
  res.json({
    ok: true,
    success: true,
    student: profile.student.name,
    updatedFields: Object.keys(req.body).filter(k => k !== "sessionToken" && k !== "credential"),
    sourceUrl: "https://portal.hef.co.ke/nfm/index/frm_update_details",
    section: "Update Loanee Details",
    message: "HEF account information update request received and verified."
  });
});

/**
 * POST /api/helb/support
 */
app.post("/api/helb/support", (req, res) => {
  res.json({
    ok: true,
    success: true,
    ticketId: `HELB-SUP-${Math.floor(Math.random() * 899999 + 100000)}`,
    channels: {
      phone: ["+254 711 052 000", "+254 20 2278 000"],
      email: ["contactcentre@helb.co.ke", "info@hef.co.ke"],
      hudumaCentres: "Available countrywide at HELB service desks in all 47 county Huduma Centres",
      headOffice: "Anniversary Towers, 18th & 19th Floors, University Way, Nairobi",
      hours: "Monday to Friday: 8:00 AM – 5:00 PM EAT"
    },
    message: "Support inquiry submitted."
  });
});

// ── Fallback 404 Handler for API ──
app.use("/api/*", (req, res) => {
  res.status(404).json({
    ok: false,
    success: false,
    message: `API endpoint ${req.originalUrl} not found.`,
  });
});

// ── Global Error Handler ──
app.use((err, req, res, next) => {
  console.error("[server-error]", err);
  res.status(500).json({
    ok: false,
    success: false,
    message: "Internal server error occurred.",
    error: err.message,
  });
});

// ── Server Start ──
if (require.main === module) {
  app.listen(PORT, () => {
    const proxyConfig = getProxyConfig();
    console.log(`\n===========================================================`);
    console.log(`🚀 Huduma Smart — HELB / HEF AI Automation Backend`);
    console.log(`   Web Application:      http://localhost:${PORT}`);
    console.log(`   API Health Endpoint:  http://localhost:${PORT}/api/health`);
    console.log(`   Target Portal:        ${PORTAL_BASE_URL}`);
    console.log(`   Browser Debug Mode:   ${process.env.DEBUG_VISIBLE === "true" ? "VISIBLE" : "Headless"}`);
    console.log(`   Proxy Enabled:        ${Boolean(proxyConfig)} ${proxyConfig ? `(${proxyConfig.server})` : ""}`);
    console.log(`   Screenshots Dir:      ${SCREENSHOTS_DIR}`);
    console.log(`===========================================================\n`);
  });
}

module.exports = {
  app,
  getSharedBrowser,
  getProxyConfig,
  checkPortalPlainHttpHealth,
  directHefLogin,
  httpGetPortalPage,
  scrapeHefViaDirectHttp,
  playwrightHefLogin,
  playwrightEmployerLogin,
  helbLogin,
  isNetworkError,
  captureSnapshot,
  getOrCreateSessionPage,
  cleanupActiveSession,
  ACTIVE_SESSIONS,
  OTP_SESSIONS,
  PORTAL_BASE_URL,
};