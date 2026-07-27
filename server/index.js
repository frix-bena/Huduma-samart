/**
 * Huduma Smart — HELB Playwright Microservice
 * Express server that drives a stealth headless browser to log into portal.hef.co.ke
 *
 * Install dependencies:
 *   npm install express cors playwright playwright-extra puppeteer-extra-plugin-stealth fs-extra
 *   npx playwright install chromium
 *
 * Run:  node index.js
 *       PORT=4000 node index.js   ← any port you like
 */

const express = require("express");
const cors    = require("cors");
const path    = require("path");
const fs      = require("fs-extra");
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth");

// ── Apply stealth plugin ──────────────────────────────────────────────────────
chromium.use(stealth());

const app  = express();
const PORT = process.env.PORT || 3001;

// ── CORS — accept requests from any origin (frontend on any port / Vercel) ────
app.use(cors());

app.use(express.json());

// ── Serve frontend static files ───────────────────────────────────────────────
// This lets the entire app (HTML + JS + CSS) be served from the same Express
// server on whatever port you choose. No separate web server needed.
app.use(express.static(path.join(__dirname, "..")));

// ── Helpers ───────────────────────────────────────────────────────────────────

const PORTAL_URL  = "https://portal.hef.co.ke/login";
const SCREENSHOTS = path.join(__dirname, "screenshots");
fs.ensureDirSync(SCREENSHOTS);

/** Human-like random delay between keystrokes */
const humanDelay = () => Math.floor(Math.random() * 80 + 40);

/**
 * launchBrowser — creates a stealth Chromium instance.
 * Set DEBUG_VISIBLE=true in env to watch the browser window.
 */
async function launchBrowser() {
  return chromium.launch({
    headless: process.env.DEBUG_VISIBLE !== "true",
    slowMo:   process.env.DEBUG_VISIBLE === "true" ? 50 : 0,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--window-size=1280,800",
    ],
  });
}

/**
 * newStealthPage — opens a new page with a realistic browser fingerprint.
 */
async function newStealthPage(browser) {
  const ctx = await browser.newContext({
    viewport:  { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    locale:     "en-KE",
    timezoneId: "Africa/Nairobi",
    extraHTTPHeaders: { "Accept-Language": "en-KE,en;q=0.9" },
  });
  const page = await ctx.newPage();

  // Remove navigator.webdriver flag at runtime
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  return { page, ctx };
}

// ── Snapshot helper ───────────────────────────────────────────────────────────
async function captureError(page, label) {
  const ts   = Date.now();
  const png  = path.join(SCREENSHOTS, `${label}-${ts}.png`);
  const html = path.join(SCREENSHOTS, `${label}-${ts}.html`);
  await page.screenshot({ path: png, fullPage: true }).catch(() => {});
  const content = await page.content().catch(() => "<could not capture>");
  await fs.writeFile(html, content).catch(() => {});
  return { png, html, timestamp: ts };
}

// ── Core login function ───────────────────────────────────────────────────────
async function helbLogin(email, password) {
  const browser = await launchBrowser();
  const { page, ctx } = await newStealthPage(browser);

  try {
    // 1. Navigate to portal
    console.log(`[helb-login] Navigating to ${PORTAL_URL}`);
    await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Wait for the network to settle — use catch so a slow portal doesn't abort early
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {
      console.warn("[helb-login] networkidle timeout — proceeding anyway");
    });

    // 2. Dismiss cookie-consent banners
    const cookieBtn = page
      .locator("button:has-text('Accept'), button:has-text('Agree'), #cookie-accept")
      .first();
    if (await cookieBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cookieBtn.click();
      await page.waitForTimeout(500);
    }

    // 3. PRIMARY WAIT — block until ANY recognisable email input is in the DOM.
    //    This is the main fix: we wait up to 10 s for the form to appear before
    //    touching anything, so we never fail just because the page hadn't rendered yet.
    const PRIMARY_EMAIL_SELECTORS = [
      "input[type='email']",
      "input[name='email']",
      "input[id*='email' i]",
      "input[placeholder*='email' i]",
      "input[autocomplete='email']",
      "input[autocomplete='username']",
    ];
    console.log("[helb-login] Waiting for email input to appear in DOM…");
    await page
      .waitForSelector(PRIMARY_EMAIL_SELECTORS.join(", "), { state: "visible", timeout: 10000 })
      .catch(() => console.warn("[helb-login] Primary waitForSelector timed out — trying fallback loop"));

    // 4. FALLBACK LOOP — try every known selector with a 10 s budget each.
    //    Covers non-standard or changed portal markup.
    const idSelectors = [
      "input[type='email']",                    // ← most specific; HEF portal email field
      "input[name='email']",
      "input[id*='email' i]",
      "input[placeholder*='email' i]",
      "input[autocomplete='email']",            // modern autocomplete hint
      "input[autocomplete='username']",
      "input[aria-label*='email' i]",           // aria-labelled field
      "input[aria-label*='user' i]",
      "input[name='username']",
      "input[placeholder*='user' i]",
      "input[placeholder*='login' i]",
      "form input[type='text']:first-of-type",  // first text input inside a form
      "input[type='text']:first-of-type",       // broadest fallback
    ];

    let idField = null;
    for (const sel of idSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 10000 }).catch(() => false)) {
        idField = el;
        console.log(`[helb-login] Email field found via selector: ${sel}`);
        break;
      }
    }
    if (!idField) {
      await captureError(page, "no-email-field");
      throw new Error(
        "Could not find the Email input field. The portal may have changed its layout — check the snapshot."
      );
    }

    // 5. Locate Password field (10 s per selector)
    const pwSelectors = [
      "input[type='password']",
      "input[name='password']",
      "input[id*='pass' i]",
      "input[autocomplete='current-password']",
      "input[placeholder*='password' i]",
      "input[placeholder*='pass' i]",
      "input[aria-label*='password' i]",
    ];
    let pwField = null;
    for (const sel of pwSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 10000 }).catch(() => false)) {
        pwField = el;
        console.log(`[helb-login] Password field found via selector: ${sel}`);
        break;
      }
    }
    if (!pwField) {
      await captureError(page, "no-password-field");
      throw new Error("Could not find the Password input field.");
    }

    // 6. Human-like typing
    await idField.click();
    await idField.fill("");
    await page.waitForTimeout(humanDelay());
    await idField.pressSequentially(email, { delay: humanDelay() });

    await page.waitForTimeout(humanDelay() * 2);

    await pwField.click();
    await pwField.fill("");
    await page.waitForTimeout(humanDelay());
    await pwField.pressSequentially(password, { delay: humanDelay() });

    await page.waitForTimeout(humanDelay() * 2);

    // 7. Find and click the submit button (10 s per selector)
    const submitSelectors = [
      "button[type='submit']",
      "input[type='submit']",
      "button:has-text('Login')",
      "button:has-text('Log In')",
      "button:has-text('Sign In')",
      "button:has-text('Continue')",
      "[role='button']:has-text('Login')",
    ];
    let submitBtn = null;
    for (const sel of submitSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 10000 }).catch(() => false)) {
        submitBtn = el;
        console.log(`[helb-login] Submit button found via selector: ${sel}`);
        break;
      }
    }
    if (!submitBtn) throw new Error("Could not find the login submit button.");

    // 8. Submit and wait for navigation
    console.log("[helb-login] Submitting login form…");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 }).catch(() => {}),
      submitBtn.click(),
    ]);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

    // 9. Check for OTP wall
    const otpIndicators = [
      "input[name='otp']",
      "input[placeholder*='OTP' i]",
      "input[placeholder*='code' i]",
      "text=verification code",
      "text=one-time",
    ];
    for (const sel of otpIndicators) {
      if (await page.locator(sel).isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log("[helb-login] OTP screen detected.");
        const snap = await captureError(page, "otp-required");
        return { ok: false, otp_required: true, message: "OTP verification required.", snapshot: snap };
      }
    }

    // 10. Check for portal error messages
    const errorSelectors = [
      ".alert-danger", ".error-message", "[class*='error']",
      "text=Invalid", "text=incorrect", "text=failed", "text=wrong",
    ];
    for (const sel of errorSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
        const errText = await el.textContent().catch(() => "Unknown error");
        const snap    = await captureError(page, "login-failed");
        return { ok: false, message: errText.trim(), snapshot: snap };
      }
    }

    // 11. Confirm dashboard loaded
    const dashboardSelectors = [
      "[class*='dashboard']", "[class*='welcome']",
      "text=Welcome", "text=My Account", "text=Loan Balance",
      "nav[class*='user']", "a[href*='logout']", "a[href*='log-out']",
    ];
    let dashboardFound = false;
    for (const sel of dashboardSelectors) {
      if (await page.locator(sel).isVisible({ timeout: 10000 }).catch(() => false)) {
        dashboardFound = true; break;
      }
    }
    if (!dashboardFound) {
      const snap = await captureError(page, "unknown-state");
      return {
        ok: false,
        message:
          "Login submitted but the HELB dashboard was not detected. " +
          "Your credentials may be wrong, or the portal may be down. Check the snapshot.",
        snapshot: snap,
      };
    }

    // 12. Success — grab session info
    const pageTitle     = await page.title().catch(() => "");
    const cookies       = await ctx.cookies();
    const sessionCookie = cookies.find(
      c => c.name.toLowerCase().includes("session") || c.name.toLowerCase().includes("token")
    );

    console.log("[helb-login] ✅ Login successful.");
    return {
      ok: true,
      message: "Login successful.",
      sessionToken: sessionCookie?.value || null,
      pageTitle,
    };

  } catch (err) {
    console.error("[helb-login] ❌ Error:", err.message);
    const snap = await captureError(page, "exception").catch(() => ({}));
    return { ok: false, message: err.message, snapshot: snap };
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// ── OTP submission function ───────────────────────────────────────────────────
async function helbSubmitOTP(sessionToken, otpCode) {
  // In production: reuse the browser session by persisting the context storage state.
  // For now, this is a placeholder that can be wired to a persistent session store.
  return {
    ok: false,
    message:
      "OTP session resumption not yet implemented. " +
      "Store browser state between requests using context.storageState().",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/helb/login
 * Body: { email: string, password: string }
 * Returns: { ok, message, sessionToken? } | { ok:false, otp_required, snapshot }
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post("/api/helb/login", async (req, res) => {
  const { nationalId, password, email } = req.body;
  const credential = email || nationalId;

  if (!credential || !password) {
    return res.status(400).json({ ok: false, message: "An email address and password are required." });
  }

  // Fail-fast — HEF portal only accepts email addresses
  if (!EMAIL_REGEX.test(credential)) {
    return res.status(400).json({
      ok: false,
      message: "The HEF portal requires a valid email address for login. National IDs are not accepted here.",
      hint:    "Please use the email address registered on portal.hef.co.ke",
    });
  }

  try {
    const result = await helbLogin(credential, password);
    const status = result.ok ? 200 : result.otp_required ? 202 : 401;
    return res.status(status).json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Internal server error.", error: err.message });
  }
});

/**
 * POST /api/helb/otp
 * Body: { sessionToken: string, otp: string }
 */
app.post("/api/helb/otp", async (req, res) => {
  const { sessionToken, otp } = req.body;
  if (!sessionToken || !otp) {
    return res.status(400).json({ ok: false, message: "sessionToken and otp are required." });
  }
  const result = await helbSubmitOTP(sessionToken, otp);
  return res.status(result.ok ? 200 : 400).json(result);
});

/**
 * GET /api/health
 */
app.get("/api/health", (_, res) =>
  res.json({ ok: true, service: "Huduma Smart Playwright Microservice", ts: new Date().toISOString() })
);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Huduma Smart — HELB AI Consultant`);
  console.log(`   App (frontend + API): http://localhost:${PORT}`);
  console.log(`   API health check:     http://localhost:${PORT}/api/health`);
  console.log(`   Debug mode: ${process.env.DEBUG_VISIBLE === "true" ? "VISIBLE BROWSER" : "headless"}`);
  console.log(`   Screenshots: ${SCREENSHOTS}\n`);
  console.log(`   ✅ Open http://localhost:${PORT} in your browser\n`);
});