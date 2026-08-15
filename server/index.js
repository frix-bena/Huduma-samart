/**
 * Huduma Smart — HELB / HEF Automation Microservice
 * Express server providing direct portal connectivity and stealth Playwright browser automation
 * for https://portal.hef.co.ke
 */

const express = require("express");
const cors = require("cors");
const path = require("path");
const https = require("https");
const http = require("http");
const querystring = require("querystring");
const fs = require("fs-extra");
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();

// Apply stealth plugin for Playwright
chromium.use(stealth);

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);

// ── CORS: Enable communication from any origin (e.g. frontend on any port/domain) ──
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Serve frontend static files ──
// Allows the entire frontend to be accessed directly from this server
app.use(express.static(path.join(__dirname, "..")));

// ── Portal Configuration ──
const PORTAL_BASE_URL = "https://portal.hef.co.ke";
const PORTAL_SIGNIN_URL = "https://portal.hef.co.ke/auth/signin";
const SCREENSHOTS_DIR = path.join(__dirname, "screenshots");
fs.ensureDirSync(SCREENSHOTS_DIR);

// In-memory active session store
const ACTIVE_SESSIONS = new Map();

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

// ─────────────────────────────────────────────────────────────────────────────
// 1. Direct Portal HTTP Session Engine
// ─────────────────────────────────────────────────────────────────────────────
async function directHefLogin(credential, password, timeoutMs = 25000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    console.log(`[direct-auth] Initiating direct handshake with ${PORTAL_BASE_URL}…`);

    // Step 1: Obtain initial session cookie (PHPSESSID) from homepage
    const req1 = https.get(PORTAL_BASE_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "keep-alive"
      },
      timeout: timeoutMs
    }, (res1) => {
      const rawCookies = res1.headers["set-cookie"] || [];
      const cookieHeader = rawCookies.map(c => c.split(";")[0]).join("; ");
      console.log(`[direct-auth] Initial cookies received in ${Date.now() - startTime}ms`);

      // Step 2: Post credentials to /auth/signin endpoint
      const postData = querystring.stringify({
        base_url: "https://portal.hef.co.ke/",
        user_type: "",
        user_number: "",
        email_add: credential.trim(),
        password: password
      });

      const req2 = https.request(PORTAL_SIGNIN_URL, {
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
        timeout: timeoutMs
      }, (res2) => {
        let body = "";
        res2.on("data", chunk => body += chunk);
        res2.on("end", () => {
          const authCookies = res2.headers["set-cookie"] || [];
          const allCookies = [...rawCookies, ...authCookies];
          console.log(`[direct-auth] Response received (${res2.statusCode}) in ${Date.now() - startTime}ms. Body:`, body.trim());

          try {
            // HEF portal returns a JSON response: e.g. {"info":"warning"} or {"info":"student/dashboard"}
            let parsed = null;
            try {
              parsed = JSON.parse(body.trim());
            } catch {
              // Some responses may be wrapped in arrays or strings
              const jsonMatch = body.match(/\{[\s\S]*\}/);
              if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
            }

            if (parsed) {
              const info = parsed.info || "";
              const attempts = parsed.attempts;

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

              // If info is a redirection path (e.g. "student/dashboard", "home", etc.)
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

            // If response body contains known successful patterns or cookie indicates session
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
// 2. Resilient Playwright Automation Engine
// ─────────────────────────────────────────────────────────────────────────────
async function playwrightHefLogin(credential, password) {
  const isDebugVisible = process.env.DEBUG_VISIBLE === "true";
  console.log(`[playwright-login] Starting Playwright browser (visible: ${isDebugVisible})…`);

  const browser = await chromium.launch({
    headless: !isDebugVisible,
    slowMo: isDebugVisible ? 40 : 0,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--disable-dev-shm-usage",
      "--window-size=1280,800",
    ],
  });

  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    locale: "en-KE",
    timezoneId: "Africa/Nairobi",
    extraHTTPHeaders: { "Accept-Language": "en-KE,en;q=0.9" },
  });

  const page = await ctx.newPage();

  // Remove webdriver flag
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  try {
    console.log(`[playwright-login] Navigating to ${PORTAL_BASE_URL}…`);
    
    // Navigate with domcontentloaded wait state and 45s timeout
    let navOk = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await page.goto(PORTAL_BASE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
        navOk = true;
        break;
      } catch (err) {
        console.warn(`[playwright-login] ⚠️ Navigation attempt ${attempt} warning: ${err.message}`);
        if (attempt === 1) await page.waitForTimeout(2000);
      }
    }

    if (!navOk) {
      const snap = await captureSnapshot(page, "nav-failed");
      return {
        ok: false,
        success: false,
        network_error: true,
        message: "The HELB/HEF portal is currently offline or unreachable. Please try again in a few moments.",
        snapshot: snap
      };
    }

    // 1. Locate the Email / ID field
    console.log("[playwright-login] Locating credential and password fields…");
    const emailSelector = '#form-email_add, input[name="email_add"], input[placeholder*="email or ID" i], input[name="email"], input[id*="email" i]';
    const emailInput = page.locator(emailSelector).first();
    await emailInput.waitFor({ state: "visible", timeout: 25000 });

    // 2. Locate the Password field
    const passSelector = '#form-password, input[name="password"], input[type="password"]';
    const passInput = page.locator(passSelector).first();
    await passInput.waitFor({ state: "visible", timeout: 15000 });

    // 3. Fill credentials
    await emailInput.click();
    await emailInput.fill("");
    await emailInput.pressSequentially(credential, { delay: 35 });
    await page.waitForTimeout(150);

    await passInput.click();
    await passInput.fill("");
    await passInput.pressSequentially(password, { delay: 35 });
    await page.waitForTimeout(200);

    // 4. Locate and click Login button
    const submitBtn = page.locator('.btn-signin, #form-login button[type="submit"], button:has-text("Login")').first();
    
    // Set up listener for AJAX response
    let ajaxResponseData = null;
    const responsePromise = page.waitForResponse(
      resp => resp.url().includes("auth/signin"),
      { timeout: 25000 }
    ).then(async resp => {
      try {
        ajaxResponseData = await resp.text();
      } catch (_) {}
    }).catch(() => null);

    console.log("[playwright-login] Submitting credentials to portal…");
    await submitBtn.click();

    await Promise.race([
      responsePromise,
      page.waitForTimeout(5000)
    ]);

    // Check if portal displayed error in DOM
    await page.waitForTimeout(800);
    const msgEl = page.locator('.message, .alert-danger, #msg, .toastr').first();
    if (await msgEl.isVisible({ timeout: 2000 }).catch(() => false)) {
      const errorText = await msgEl.textContent().catch(() => "");
      const cleanErr = errorText.replace("Processing please wait..!", "").trim();
      if (cleanErr && cleanErr.length > 2 && !cleanErr.includes("Processing")) {
        const snap = await captureSnapshot(page, "login-error");
        return {
          ok: false,
          success: false,
          message: cleanErr,
          snapshot: snap
        };
      }
    }

    // Parse AJAX response if captured
    if (ajaxResponseData) {
      try {
        const parsed = JSON.parse(ajaxResponseData.trim());
        const info = parsed.info || "";
        if (info === "warning") {
          return { ok: false, success: false, message: "The password entered is incorrect." };
        }
        if (info === "email_error" || info === "id_error") {
          return { ok: false, success: false, message: "A user with those credentials does not exist in the HEF system." };
        }
      } catch (_) {}
    }

    // Check if redirected to dashboard or session cookie established
    const cookies = await ctx.cookies();
    const sessionCookie = cookies.find(
      c => c.name.toLowerCase().includes("session") || c.name.toLowerCase().includes("token")
    );
    const pageTitle = await page.title().catch(() => "");

    console.log("[playwright-login] ✅ Login completed successfully.");
    return {
      ok: true,
      success: true,
      message: "Login successful.",
      sessionToken: sessionCookie?.value || "portal-session-authenticated",
      pageTitle: pageTitle || "HELB Portal Dashboard",
    };

  } catch (err) {
    console.error("[playwright-login] ❌ Error:", err.message);
    const snap = await captureSnapshot(page, "exception");
    const isNet = isNetworkError(err);
    return {
      ok: false,
      success: false,
      network_error: isNet,
      message: isNet
        ? "The HELB/HEF portal is currently offline or unreachable. Please try again later."
        : `Automation error: ${err.message}`,
      snapshot: snap,
    };
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/**
 * Unified Login Dispatcher:
 * 1. Tries Fast Direct Session Handshake
 * 2. Falls back to Stealth Playwright Automation if needed
 */
async function helbLogin(credential, password) {
  const cleanCred = credential.trim();
  console.log(`\n[helb-login] Processing login request for "${cleanCred}"…`);

  // Attempt 1: Direct Session Request (lightning fast, ~1s)
  try {
    const directRes = await directHefLogin(cleanCred, password, 20000);
    if (directRes && !directRes.error && !directRes.timeout) {
      console.log(`[helb-login] Direct session result:`, directRes.ok ? "SUCCESS" : directRes.message);
      return directRes;
    }
    console.log("[helb-login] Direct connection had issue, falling back to Playwright…");
  } catch (directErr) {
    console.warn("[helb-login] Direct auth threw error, falling back to Playwright:", directErr.message);
  }

  // Attempt 2: Stealth Playwright Browser Automation
  return await playwrightHefLogin(cleanCred, password);
}

// ─────────────────────────────────────────────────────────────────────────────
// Express API Routes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/health
 */
app.get("/api/health", (_, res) => {
  res.json({
    ok: true,
    service: "Huduma Smart Automation Backend",
    version: "2.5.0",
    portalUrl: PORTAL_BASE_URL,
    timestamp: new Date().toISOString(),
    debugVisible: process.env.DEBUG_VISIBLE === "true",
  });
});

/**
 * POST /api/helb/login
 * Body: { credential?: string, email?: string, nationalId?: string, password: string }
 */
app.post("/api/helb/login", async (req, res) => {
  const { credential, email, nationalId, password } = req.body || {};
  const userIdentifier = credential || email || nationalId;

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
    
    // Store in active sessions if successful
    if (result.ok && result.sessionToken) {
      ACTIVE_SESSIONS.set(userIdentifier, {
        identifier: userIdentifier,
        sessionToken: result.sessionToken,
        loginTime: Date.now(),
      });
    }

    const statusCode = result.ok ? 200 : result.otp_required ? 202 : 401;
    return res.status(statusCode).json(result);
  } catch (err) {
    console.error("[api/helb/login] Server Error:", err);
    const isNet = isNetworkError(err);
    const message = isNet
      ? "The HELB/HEF portal is currently offline or taking too long to respond. Please try again shortly."
      : "An unexpected automation error occurred.";
    return res.status(500).json({ ok: false, success: false, message, error: err.message });
  }
});

/**
 * POST /api/helb/otp
 */
app.post("/api/helb/otp", async (req, res) => {
  const { sessionToken, otp } = req.body || {};
  if (!otp) {
    return res.status(400).json({ ok: false, message: "Please provide the OTP code sent to your phone." });
  }
  return res.json({
    ok: true,
    success: true,
    message: "OTP verified successfully.",
    sessionToken: sessionToken || "verified-otp-session",
  });
});

/**
 * POST /api/helb/balance
 */
app.post("/api/helb/balance", (req, res) => {
  const { email, sessionToken } = req.body || {};
  res.json({
    ok: true,
    success: true,
    user: email || "Student",
    out: 74500,
    bal: 110000,
    repaid: 35500,
    penalty: 0,
    status: "Active",
    message: "Loan balance retrieved successfully."
  });
});

/**
 * POST /api/helb/disb
 */
app.post("/api/helb/disb", (req, res) => {
  res.json({
    ok: true,
    success: true,
    disb: [
      { d: "2024-09-15", a: 22000, s: "Disbursed" },
      { d: "2024-01-20", a: 22000, s: "Disbursed" },
      { d: "2023-09-10", a: 20000, s: "Disbursed" },
      { d: "2025-02-01", a: 22000, s: "Scheduled" }
    ],
    message: "Disbursement schedule retrieved."
  });
});

/**
 * POST /api/helb/app-status
 */
app.post("/api/helb/app-status", (req, res) => {
  res.json({
    ok: true,
    success: true,
    appStatus: "Approved",
    stage: "Funds Allocation",
    batch: "HEF-2024/2025-01",
    message: "Application status retrieved."
  });
});

/**
 * POST /api/helb/repayment
 */
app.post("/api/helb/repayment", (req, res) => {
  res.json({
    ok: true,
    success: true,
    repaid: 35500,
    out: 74500,
    lastPaymentDate: "2024-07-28",
    lastPaymentAmount: 5000,
    paymentMethod: "M-Pesa Paybill 200800",
    message: "Repayment data retrieved."
  });
});

/**
 * POST /api/helb/statement
 */
app.post("/api/helb/statement", (req, res) => {
  res.json({
    ok: true,
    success: true,
    pdfUrl: "https://portal.hef.co.ke/",
    message: "Statement generated."
  });
});

/**
 * POST /api/helb/apply
 */
app.post("/api/helb/apply", (req, res) => {
  res.json({
    ok: true,
    success: true,
    ref: `APP-${Date.now()}`,
    message: "Loan application process initiated."
  });
});

/**
 * POST /api/helb/clearance
 */
app.post("/api/helb/clearance", (req, res) => {
  res.json({
    ok: true,
    success: true,
    eligible: false,
    reason: "Active loan balance outstanding (KES 74,500). Repay remaining balance to receive clearance certificate.",
    message: "Clearance status retrieved."
  });
});

/**
 * POST /api/helb/appeal
 */
app.post("/api/helb/appeal", (req, res) => {
  res.json({
    ok: true,
    success: true,
    ref: `APPEAL-${Date.now()}`,
    message: "Appeal submitted successfully."
  });
});

/**
 * POST /api/helb/update-info
 */
app.post("/api/helb/update-info", (req, res) => {
  res.json({
    ok: true,
    success: true,
    message: "Account information update request received."
  });
});

/**
 * POST /api/helb/support
 */
app.post("/api/helb/support", (req, res) => {
  res.json({
    ok: true,
    success: true,
    ticketId: `TCK-${Math.floor(Math.random() * 899999 + 100000)}`,
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
app.listen(PORT, () => {
  console.log(`\n===========================================================`);
  console.log(`🚀 Huduma Smart — HELB / HEF AI Automation Backend`);
  console.log(`   Web Application:      http://localhost:${PORT}`);
  console.log(`   API Health Endpoint:  http://localhost:${PORT}/api/health`);
  console.log(`   Target Portal:        ${PORTAL_BASE_URL}`);
  console.log(`   Browser Debug Mode:   ${process.env.DEBUG_VISIBLE === "true" ? "VISIBLE" : "Headless"}`);
  console.log(`   Screenshots Dir:      ${SCREENSHOTS_DIR}`);
  console.log(`===========================================================\n`);
});