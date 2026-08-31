/**
 * Huduma Smart — Human Interaction Engine for Playwright
 * 
 * Simulates genuine human behavior for automated interactions with the HELB / HEF portal:
 * - Natural Bézier-curve mouse trajectories with acceleration, deceleration, and micro-jitter
 * - Human-like typing cadence with normal distribution delays, word-boundary pauses, and micro-hesitations
 * - Randomized click offsets within target element bounding boxes (avoiding robotic dead-center clicks)
 * - Stepped smooth scrolling with natural deceleration curves
 * - Randomized human "reading" and "thinking" pauses
 * - Comprehensive anti-bot stealth overrides (navigator, WebGL, Chrome runtime, viewport, locale)
 */

// ── Math & Geometry Utilities ──

/**
 * Generate a random number within [min, max]
 */
function randRange(min, max) {
  return Math.random() * (max - min) + min;
}

/**
 * Generate a random integer within [min, max] inclusive
 */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate a Gaussian (normally distributed) random number around mean with given standard deviation
 */
function randGaussian(mean, stdDev) {
  let u1 = Math.random();
  let u2 = Math.random();
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * stdDev + mean;
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Cubic Bézier interpolation formula: B(t) = (1-t)^3 * P0 + 3(1-t)^2 * t * P1 + 3(1-t) * t^2 * P2 + t^3 * P3
 */
function cubicBezier(p0, p1, p2, p3, t) {
  const oneMinusT = 1 - t;
  return (
    Math.pow(oneMinusT, 3) * p0 +
    3 * Math.pow(oneMinusT, 2) * t * p1 +
    3 * oneMinusT * Math.pow(t, 2) * p2 +
    Math.pow(t, 3) * p3
  );
}

/**
 * Generate smooth Bézier curve mouse trajectory points between start and target
 */
function generateBezierPath(startX, startY, targetX, targetY, stepCount = 25) {
  const distance = Math.hypot(targetX - startX, targetY - startY);
  const steps = Math.max(12, Math.min(stepCount, Math.floor(distance / 15)));

  // Generate randomized control points with natural human-arm curvature
  const midX = (startX + targetX) / 2;
  const midY = (startY + targetY) / 2;
  const spread = Math.min(150, Math.max(30, distance * 0.25));

  const ctrl1X = startX + (midX - startX) * randRange(0.4, 0.8) + randRange(-spread, spread);
  const ctrl1Y = startY + (midY - startY) * randRange(0.4, 0.8) + randRange(-spread, spread);
  const ctrl2X = midX + (targetX - midX) * randRange(0.2, 0.6) + randRange(-spread * 0.5, spread * 0.5);
  const ctrl2Y = midY + (targetY - midY) * randRange(0.2, 0.6) + randRange(-spread * 0.5, spread * 0.5);

  const points = [];
  for (let i = 0; i <= steps; i++) {
    // Ease-in / Ease-out non-linear progress for natural speed curve
    const t = i / steps;
    // Smoother step easing function: 3*t^2 - 2*t^3
    const easedT = t * t * (3 - 2 * t);

    let x = cubicBezier(startX, ctrl1X, ctrl2X, targetX, easedT);
    let y = cubicBezier(startY, ctrl1Y, ctrl2Y, targetY, easedT);

    // Add subtle sub-pixel tremor/jitter except at the exact start and finish
    if (i > 0 && i < steps) {
      x += randGaussian(0, 0.6);
      y += randGaussian(0, 0.6);
    }

    points.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }

  return points;
}

// ── Human Interaction Primitives ──

/**
 * Move the mouse smoothly to target (targetX, targetY) using natural human curves
 */
async function humanMouseMove(page, targetX, targetY, currentPos = { x: 100, y: 100 }) {
  if (!page || !page.mouse) return;
  const startX = currentPos.x ?? 100;
  const startY = currentPos.y ?? 100;

  const points = generateBezierPath(startX, startY, targetX, targetY);
  for (const pt of points) {
    await page.mouse.move(pt.x, pt.y);
    currentPos.x = pt.x;
    currentPos.y = pt.y;
    // Fast micro-delay between trajectory points (2ms - 8ms)
    await sleep(randInt(2, 8));
  }
}

/**
 * Click an element just like a human:
 * 1. Locate element and scroll into view smoothly
 * 2. Calculate a randomized offset inside element (not dead-center)
 * 3. Move cursor smoothly along a Bézier curve
 * 4. Hover naturally (100ms - 250ms)
 * 5. Mouse down -> pause (50ms - 110ms) -> Mouse up
 */
async function humanClick(page, locatorOrSelector, currentPos = { x: 100, y: 100 }) {
  if (!page) return false;
  try {
    const loc = typeof locatorOrSelector === "string" ? page.locator(locatorOrSelector).first() : locatorOrSelector;
    if (!(await loc.isVisible({ timeout: 4000 }).catch(() => false))) {
      return false;
    }

    await loc.scrollIntoViewIfNeeded({ timeout: 2500 }).catch(() => {});
    const box = await loc.boundingBox().catch(() => null);
    if (!box) {
      // Fallback to standard click if bounding box unavailable
      await loc.click({ delay: randInt(60, 120) }).catch(() => {});
      return true;
    }

    // Pick random target inside element padding (20% to 80% to avoid edges)
    const targetX = box.x + box.width * randRange(0.25, 0.75);
    const targetY = box.y + box.height * randRange(0.25, 0.75);

    // Smooth Bézier mouse movement
    await humanMouseMove(page, targetX, targetY, currentPos);

    // Natural hover pause before clicking
    await sleep(randInt(120, 280));

    // Mouse down -> hold -> Mouse up
    await page.mouse.down();
    await sleep(randInt(55, 115));
    await page.mouse.up();

    // Post-click settling pause
    await sleep(randInt(80, 200));
    return true;
  } catch (err) {
    // Graceful fallback
    try {
      const loc = typeof locatorOrSelector === "string" ? page.locator(locatorOrSelector).first() : locatorOrSelector;
      await loc.click({ timeout: 2000 }).catch(() => {});
      return true;
    } catch (_) {
      return false;
    }
  }
}

/**
 * Type text character-by-character with realistic human typing cadence:
 * - Variable delay per keystroke (normally distributed)
 * - Hesitations before special characters (@, ., _, numbers)
 * - Micro-pauses at word boundaries
 */
async function humanType(page, locatorOrSelector, text, currentPos = { x: 100, y: 100 }, options = { clearFirst: true }) {
  if (!page || !text) return;
  try {
    const loc = typeof locatorOrSelector === "string" ? page.locator(locatorOrSelector).first() : locatorOrSelector;
    await humanClick(page, loc, currentPos);

    if (options.clearFirst) {
      await loc.fill("").catch(() => {});
      await sleep(randInt(60, 140));
    }

    const chars = String(text).split("");
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      const prevChar = i > 0 ? chars[i - 1] : "";

      // Base keystroke delay
      let delay = Math.round(randGaussian(65, 18));
      delay = Math.max(30, Math.min(160, delay));

      // Extra pause for word boundaries (spaces)
      if (char === " " || prevChar === " ") {
        delay += randInt(40, 90);
      }

      // Extra pause for special symbols and numbers (shift keys or hunt-and-peck)
      if (/[@#$%.+\-_/\\0-9]/.test(char)) {
        delay += randInt(30, 70);
      }

      await page.keyboard.type(char, { delay: 0 }).catch(async () => {
        await page.keyboard.press(char).catch(() => {});
      });
      await sleep(delay);
    }

    // Verify input value matches exactly
    const val = await loc.inputValue().catch(() => null);
    if (val !== text) {
      await loc.fill(text).catch(() => {});
    }

    // Dispatch events for framework reactivity (React, Vue, jQuery, etc.)
    await loc.evaluate(el => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }).catch(() => {});

    // Post-typing pause (human reviewing what they typed)
    await sleep(randInt(120, 300));
  } catch (err) {
    // Fallback if locator fails
    try {
      const loc = typeof locatorOrSelector === "string" ? page.locator(locatorOrSelector).first() : locatorOrSelector;
      await loc.fill(text).catch(() => {});
    } catch (_) {}
  }
}

/**
 * Smoothly scroll the page mimicking a human using a mouse wheel or trackpad
 */
async function humanScroll(page, distanceY = 400, steps = 10) {
  if (!page || !page.mouse) return;
  try {
    const stepDelta = distanceY / steps;
    for (let i = 0; i < steps; i++) {
      // Ease out as we reach the target scroll position
      const progress = (i + 1) / steps;
      const easeMultiplier = Math.sin((progress * Math.PI) / 2);
      const currentDelta = stepDelta * (1 + 0.3 * (1 - easeMultiplier));

      await page.mouse.wheel(0, currentDelta);
      await sleep(randInt(25, 65));
    }
    await sleep(randInt(150, 400));
  } catch (_) {}
}

/**
 * Pause to simulate human reading or comprehending the screen
 */
async function humanPause(minMs = 600, maxMs = 1800) {
  await sleep(randInt(minMs, maxMs));
}

// ── Anti-Bot Stealth Configuration ──

/**
 * Inject anti-bot stealth scripts and browser property overrides into Playwright context/page
 */
async function setupHumanStealth(page) {
  if (!page) return;

  await page.addInitScript(() => {
    // 1. Remove automation flags
    try {
      Object.defineProperty(Navigator.prototype, "webdriver", {
        get: () => undefined,
        configurable: true
      });
    } catch (_) {}
    try {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
        configurable: true
      });
    } catch (_) {}
    try {
      delete Object.getPrototypeOf(navigator).webdriver;
    } catch (_) {}
    try {
      delete navigator.webdriver;
    } catch (_) {}

    // 2. Mock Chrome runtime object
    try {
      if (!window.chrome) {
        window.chrome = {};
      }
      window.chrome.runtime = {
        PlatformOs: { MAC: "mac", WIN: "win", ANDROID: "android", CROS: "cros", LINUX: "linux", OPENBSD: "openbsd" },
        PlatformArch: { ARM: "arm", X86_32: "x86-32", X86_64: "x86-64" },
        PlatformNaclArch: { ARM: "arm", X86_32: "x86-32", X86_64: "x86-64" },
        connect: () => {},
        sendMessage: () => {}
      };
      window.chrome.app = { isInstalled: false, InstallState: { DISABLED: "disabled", INSTALLED: "installed", NOT_INSTALLED: "not_installed" } };
      window.chrome.csi = () => {};
      window.chrome.loadTimes = () => ({
        requestTime: Date.now() / 1000,
        startLoadTime: Date.now() / 1000,
        commitLoadTime: Date.now() / 1000,
        finishDocumentLoadTime: Date.now() / 1000,
        finishLoadTime: Date.now() / 1000,
        firstPaintTime: Date.now() / 1000,
        navigationType: "Other",
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
        npnNegotiatedProtocol: "h2",
        wasAlternateProtocolAvailable: false,
        connectionInfo: "h2"
      });
    } catch (_) {}

    // 3. Mock navigator languages & locale
    Object.defineProperty(navigator, "languages", { get: () => ["en-KE", "en-US", "en"] });
    Object.defineProperty(navigator, "language", { get: () => "en-KE" });

    // 4. Mock navigator plugins
    const mockPlugins = [
      { name: "PDF Viewer", filename: "internal-pdf-viewer", description: "Portable Document Format" },
      { name: "Chrome PDF Viewer", filename: "internal-pdf-viewer", description: "Portable Document Format" },
      { name: "Chromium PDF Viewer", filename: "internal-pdf-viewer", description: "Portable Document Format" },
      { name: "Microsoft Edge PDF Viewer", filename: "internal-pdf-viewer", description: "Portable Document Format" },
      { name: "WebKit built-in PDF", filename: "internal-pdf-viewer", description: "Portable Document Format" }
    ];
    Object.defineProperty(navigator, "plugins", { get: () => mockPlugins });

    // 5. Mock Permissions API
    if (navigator.permissions && navigator.permissions.query) {
      const originalQuery = navigator.permissions.query;
      navigator.permissions.query = (parameters) =>
        parameters && parameters.name === "notifications"
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);
    }

    // 6. Mock Hardware and Screen
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
    Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
    Object.defineProperty(navigator, "maxTouchPoints", { get: () => 0 });

    // 7. WebGL Vendor & Renderer spoofing (mimic standard Intel / Apple graphics)
    try {
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (parameter) {
        // UNMASKED_VENDOR_WEBGL
        if (parameter === 37445) return "Intel Inc.";
        // UNMASKED_RENDERER_WEBGL
        if (parameter === 37446) return "Intel(R) Iris(TM) Plus Graphics 640";
        return getParameter.apply(this, arguments);
      };
      if (typeof WebGL2RenderingContext !== "undefined") {
        const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = function (parameter) {
          if (parameter === 37445) return "Intel Inc.";
          if (parameter === 37446) return "Intel(R) Iris(TM) Plus Graphics 640";
          return getParameter2.apply(this, arguments);
        };
      }
    } catch (_) {}
  });
}

module.exports = {
  randRange,
  randInt,
  randGaussian,
  sleep,
  generateBezierPath,
  humanMouseMove,
  humanClick,
  humanType,
  humanScroll,
  humanPause,
  setupHumanStealth
};
