/**
 * Huduma Smart — /api/helb/login
 * Vercel Serverless Function
 *
 * Receives { email, password } and drives a stealth headless Chromium
 * instance to log into portal.hef.co.ke on the user's behalf.
 *
 * Uses @sparticuz/chromium — a serverless-optimised Chromium that
 * downloads itself to /tmp at runtime (no bundling, fits Vercel limits).
 *
 * Recommended plan: Vercel Pro (maxDuration: 60s)
 * Free plan (10s) may timeout on slow portal responses.
 */

const chromium = require("@sparticuz/chromium");
const { chromium: pw } = require("playwright-core");

// ── Portal constants ──────────────────────────────────────────────────────────
const PORTAL_URL = "https://portal.hef.co.ke/login";

/** Faster human-like delay for serverless (shorter than local dev) */
const humanDelay = () => Math.floor(Math.random() * 50 + 30);

// ── Core login ────────────────────────────────────────────────────────────────
async function helbLogin(email, password) {
  const executablePath = await chromium.executablePath();

  const browser = await pw.launch({
    args: chromium.args,
    executablePath,
    headless: chromium.headless,
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

  // Remove automation flag
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  try {
    // 1. Navigate
    console.log("[helb-login] Navigating to", PORTAL_URL);
    await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    // 2. Cookie consent
    const cookieBtn = page
      .locator("button:has-text('Accept'), button:has-text('Agree'), #cookie-accept")
      .first();
    if (await cookieBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cookieBtn.click();
      await page.waitForTimeout(400);
    }

    // 3. Email field
    const emailSelectors = [
      "input[type='email']",
      "input[name='email']",
      "input[id*='email' i]",
      "input[placeholder*='email' i]",
      "input[name='username']",
      "input[placeholder*='user' i]",
      "input[type='text']:first-of-type",
    ];
    let emailField = null;
    for (const sel of emailSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        emailField = el;
        break;
      }
    }
    if (!emailField) throw new Error("Could not find the email input field on the portal.");

    // 4. Password field
    const pwSelectors = [
      "input[type='password']",
      "input[name='password']",
      "input[id*='pass' i]",
    ];
    let pwField = null;
    for (const sel of pwSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        pwField = el;
        break;
      }
    }
    if (!pwField) throw new Error("Could not find the password input field on the portal.");

    // 5. Type credentials
    await emailField.click();
    await emailField.fill("");
    await page.waitForTimeout(humanDelay());
    await emailField.pressSequentially(email, { delay: humanDelay() });

    await page.waitForTimeout(humanDelay() * 2);

    await pwField.click();
    await pwField.fill("");
    await page.waitForTimeout(humanDelay());
    await pwField.pressSequentially(password, { delay: humanDelay() });

    await page.waitForTimeout(humanDelay() * 2);

    // 6. Submit
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
        submitBtn = el;
        break;
      }
    }
    if (!submitBtn) throw new Error("Could not find the login submit button.");

    console.log("[helb-login] Submitting form…");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 }).catch(() => {}),
      submitBtn.click(),
    ]);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    // 7. OTP wall?
    const otpIndicators = [
      "input[name='otp']",
      "input[placeholder*='OTP' i]",
      "text=verification code",
      "text=one-time",
    ];
    for (const sel of otpIndicators) {
      if (await page.locator(sel).isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log("[helb-login] OTP screen detected.");
        return { ok: false, otp_required: true, message: "OTP verification required." };
      }
    }

    // 8. Portal error message?
    const errorSelectors = [
      ".alert-danger", ".error-message", "[class*='error']",
      "text=Invalid", "text=incorrect", "text=failed",
    ];
    for (const sel of errorSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        const errText = await el.textContent().catch(() => "Login failed");
        return { ok: false, message: errText.trim() };
      }
    }

    // 9. Dashboard check
    const dashboardSelectors = [
      "[class*='dashboard']", "[class*='welcome']",
      "text=Welcome", "text=My Account", "text=Loan Balance",
      "nav[class*='user']", "a[href*='logout']",
    ];
    let dashboardFound = false;
    for (const sel of dashboardSelectors) {
      if (await page.locator(sel).isVisible({ timeout: 5000 }).catch(() => false)) {
        dashboardFound = true;
        break;
      }
    }
    if (!dashboardFound) {
      return {
        ok: false,
        message: "Login submitted but the portal dashboard was not detected. Your credentials may be incorrect, or the portal may be down.",
      };
    }

    // 10. Success — grab session info
    const pageTitle = await page.title().catch(() => "");
    const cookies = await ctx.cookies();
    const sessionCookie = cookies.find(
      (c) => c.name.toLowerCase().includes("session") || c.name.toLowerCase().includes("token")
    );

    console.log("[helb-login] ✅ Login successful.");
    return {
      ok: true,
      message: "Login successful.",
      sessionToken: sessionCookie?.value || null,
      pageTitle,
    };
  } catch (err) {
    console.error("[helb-login] ❌", err.message);
    return { ok: false, message: err.message };
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// ── Vercel handler ────────────────────────────────────────────────────────────
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async (req, res) => {
  // CORS (for local dev where frontend may be on a different port)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, message: "Method not allowed." });

  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ ok: false, message: "Email and password are required." });
  }
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({
      ok: false,
      message: "The HELB portal requires a valid email address. National IDs are not accepted.",
    });
  }

  try {
    const result = await helbLogin(email, password);
    const status = result.ok ? 200 : result.otp_required ? 202 : 401;
    return res.status(status).json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Internal server error.", error: err.message });
  }
};
