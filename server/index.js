/**
 * Huduma Smart — HELB Playwright Microservice
 * Express server that receives credentials from n8n and
 * drives a stealth headless browser to interact with portal.hef.co.ke
 *
 * Install dependencies:
 *   npm install express playwright playwright-extra puppeteer-extra-plugin-stealth fs-extra
 *   npx playwright install chromium
 */

const express  = require("express");
const path     = require("path");
const fs       = require("fs-extra");
const { chromium } = require("playwright-extra");
const stealth  = require("puppeteer-extra-plugin-stealth");

// ── Apply stealth plugin ──────────────────────────────────────────────────────
chromium.use(stealth());

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

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
    slowMo: process.env.DEBUG_VISIBLE === "true" ? 50 : 0,
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
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    locale: "en-KE",
    timezoneId: "Africa/Nairobi",
    extraHTTPHeaders: {
      "Accept-Language": "en-KE,en;q=0.9",
    },
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
async function helbLogin(nationalId, password) {
  const browser = await launchBrowser();
  const { page, ctx } = await newStealthPage(browser);

  try {
    // 1. Navigate to portal
    console.log(`[helb-login] Navigating to ${PORTAL_URL}`);
    await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 });

    // 2. Detect and solve any cookie-consent banners
    const cookieBtn = page.locator("button:has-text('Accept'), button:has-text('Agree'), #cookie-accept").first();
    if (await cookieBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cookieBtn.click();
      await page.waitForTimeout(500);
    }

    // 3. Locate Email field — HEF portal uses email not National ID
    const idSelectors = [
      "input[type='email']",          // Most specific — HEF login email field
      "input[name='email']",
      "input[id*='email' i]",
      "input[placeholder*='email' i]",
      "input[name='username']",        // Fallback generic selectors
      "input[placeholder*='user' i]",
      "input[type='text']:first-of-type",
    ];
    let idField = null;
    for (const sel of idSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        idField = el; break;
      }
    }
    if (!idField) throw new Error("Could not find the National ID input field.");

    // 4. Locate Password field
    const pwSelectors = [
      "input[type='password']",
      "input[name='password']",
      "input[id*='pass' i]",
    ];
    let pwField = null;
    for (const sel of pwSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        pwField = el; break;
      }
    }
    if (!pwField) throw new Error("Could not find the Password input field.");

    // 5. Human-like typing — clear then type character by character
    await idField.click();
    await idField.fill(""); // clear first
    await page.waitForTimeout(humanDelay());
    await idField.pressSequentially(nationalId, { delay: humanDelay() });

    await page.waitForTimeout(humanDelay() * 2);

    await pwField.click();
    await pwField.fill("");
    await page.waitForTimeout(humanDelay());
    await pwField.pressSequentially(password, { delay: humanDelay() });

    await page.waitForTimeout(humanDelay() * 2);

    // 6. Find and click submit button
    const submitSelectors = [
      "button[type='submit']",
      "input[type='submit']",
      "button:has-text('Login')",
      "button:has-text('Sign In')",
      "button:has-text('Log In')",
    ];
    let submitBtn = null;
    for (const sel of submitSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        submitBtn = el; break;
      }
    }
    if (!submitBtn) throw new Error("Could not find the login submit button.");

    // 7. Click and wait for navigation
    console.log("[helb-login] Submitting login form…");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 }).catch(() => {}),
      submitBtn.click(),
    ]);

    await page.waitForLoadState("networkidle", { timeout: 15000 });

    // 8. Check for post-login OTP wall
    const otpIndicators = [
      "input[name='otp']",
      "input[placeholder*='OTP' i]",
      "text=verification code",
      "text=one-time",
    ];
    for (const sel of otpIndicators) {
      if (await page.locator(sel).isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log("[helb-login] OTP screen detected.");
        const snap = await captureError(page, "otp-required");
        return { ok: false, otp_required: true, message: "OTP verification required.", snapshot: snap };
      }
    }

    // 9. Check for error messages
    const errorSelectors = [
      ".alert-danger", ".error-message", "[class*='error']",
      "text=Invalid", "text=incorrect", "text=failed",
    ];
    for (const sel of errorSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        const errText = await el.textContent().catch(() => "Unknown error");
        const snap = await captureError(page, "login-failed");
        return { ok: false, message: errText.trim(), snapshot: snap };
      }
    }

    // 10. Confirm successful dashboard load
    const dashboardSelectors = [
      "[class*='dashboard']",
      "[class*='welcome']",
      "text=Welcome",
      "text=My Account",
      "text=Loan Balance",
      "nav[class*='user']",
      "a[href*='logout']",
    ];
    let dashboardFound = false;
    for (const sel of dashboardSelectors) {
      if (await page.locator(sel).isVisible({ timeout: 5000 }).catch(() => false)) {
        dashboardFound = true; break;
      }
    }

    if (!dashboardFound) {
      const snap = await captureError(page, "unknown-state");
      return {
        ok: false,
        message: "Login submitted but dashboard was not detected. Check snapshot.",
        snapshot: snap,
      };
    }

    // 11. Scrape basic account info from dashboard
    const pageTitle = await page.title().catch(() => "");
    const cookies   = await ctx.cookies();
    const sessionCookie = cookies.find(c => c.name.toLowerCase().includes("session") || c.name.toLowerCase().includes("token"));

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
    return {
      ok: false,
      message: err.message,
      snapshot: snap,
    };
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// ── OTP submission function ───────────────────────────────────────────────────
async function helbSubmitOTP(sessionToken, otpCode) {
  // In production: reuse the browser session by persisting the context storage state.
  // For now, this is a placeholder that can be wired to a persistent session store.
  return { ok: false, message: "OTP session resumption not yet implemented. Store browser state between requests using context.storageState()." };
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/helb/login
 * Body: { nationalId: string, password: string }
 * Returns: { ok, message, sessionToken? } | { ok:false, otp_required, snapshot }
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post("/api/helb/login", async (req, res) => {
  const { nationalId, password, email } = req.body;
  const credential = email || nationalId;

  if (!credential || !password) {
    return res.status(400).json({ ok: false, message: "An email address and password are required." });
  }

  // Layer 2: Fail-fast — HEF portal only accepts email addresses
  if (!EMAIL_REGEX.test(credential)) {
    return res.status(400).json({
      ok: false,
      message: "The HEF portal requires a valid email address for login. National IDs are not accepted here.",
      hint: "Please use the email address registered on portal.hef.co.ke"
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
app.get("/api/health", (_, res) => res.json({ ok: true, service: "Huduma Smart Playwright Microservice", ts: new Date().toISOString() }));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Huduma Smart Playwright Microservice`);
  console.log(`   Listening on http://localhost:${PORT}`);
  console.log(`   Debug mode: ${process.env.DEBUG_VISIBLE === "true" ? "VISIBLE BROWSER" : "headless"}`);
  console.log(`   Screenshots: ${SCREENSHOTS}\n`);
});
