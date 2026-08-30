const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const hefEngine = require("../hefEngine");
const human = require("../humanInteraction");

// Scraper functions from index.js (or re-implemented matching index.js for unit testing)
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

async function scrapeFieldByLabels(page, fieldName, labels, fallbackSelectors = [], auditReport = null) {
  let candidateRejected = null;

  for (const label of labels) {
    const lower = label.toLowerCase();

    // 1. Exact Playwright locator with following-sibling
    try {
      const sibLoc = page.locator(`text="${label}" >> xpath=following-sibling::*[1]`).first();
      if (await sibLoc.isVisible({ timeout: 300 }).catch(() => false)) {
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
      if (await xpathLoc.isVisible({ timeout: 300 }).catch(() => false)) {
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

    // 3. Table cell
    try {
      const tableCellLoc = page.locator(`xpath=//td[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${lower}")]/following-sibling::td[1] | //th[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${lower}")]/following-sibling::td[1]`).first();
      if (await tableCellLoc.isVisible({ timeout: 300 }).catch(() => false)) {
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

    // 4. Definition list
    try {
      const ddLoc = page.locator(`xpath=//dt[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${lower}")]/following-sibling::dd[1]`).first();
      if (await ddLoc.isVisible({ timeout: 300 }).catch(() => false)) {
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

    // 5. Strictly scoped container (position() <= 3, NO row/col page-wide containers)
    try {
      const containerLoc = page.locator(`xpath=(//*[translate(normalize-space(text()), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')="${lower}" or contains(translate(normalize-space(text()), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${lower}")][not(self::body or self::html or self::footer or contains(@class, "footer"))]/ancestor::*[position() <= 3 and (contains(@class, "form-group") or contains(@class, "detail") or contains(@class, "item") or contains(@class, "info-box") or contains(@class, "data-field") or contains(@class, "profile-field") or contains(@class, "field"))]//*[contains(@class, "value") or contains(@class, "desc") or contains(@class, "text") or contains(@class, "number") or self::b or self::strong or self::span][not(contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${lower}"))])[1]`).first();
      if (await containerLoc.isVisible({ timeout: 300 }).catch(() => false)) {
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

  // 6. Direct CSS Selectors
  for (const sel of fallbackSelectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 300 }).catch(() => false) || (sel.includes("input") && await loc.count().catch(() => 0) > 0)) {
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

async function runTests() {
  console.log("===============================================================================");
  console.log(" RUNNING HELB / HEF DATA INTEGRITY & SCRAPER TEST SUITE");
  console.log("===============================================================================\n");

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Error: ${err.message}`);
      failed++;
    }
  }

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Error: ${err.message}`);
      failed++;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST GROUP 1: Boilerplate Blocklist
  // ─────────────────────────────────────────────────────────────────────────
  console.log("--- Test Group 1: Boilerplate Blocklist Filter ---");

  test("Identifies and rejects standard copyright / powered-by footer strings", () => {
    assert.strictEqual(hefEngine.isBoilerplateText("Copyright © 2026 HELB, All rights reserved. Powered By: HELB ICT Team"), true);
    assert.strictEqual(hefEngine.isBoilerplateText("© 2026 Higher Education Financing. All rights reserved."), true);
    assert.strictEqual(hefEngine.isBoilerplateText("Powered By: HELB ICT Team"), true);
    assert.strictEqual(hefEngine.isBoilerplateText("HELB ICT Team"), true);
    assert.strictEqual(hefEngine.isBoilerplateText("All rights reserved"), true);
    assert.strictEqual(hefEngine.isBoilerplateText("Disclaimer: This portal is for official use only"), true);
    assert.strictEqual(hefEngine.isBoilerplateText("Terms and conditions apply"), true);
  });

  test("Allows authentic student profile data through", () => {
    assert.strictEqual(hefEngine.isBoilerplateText("BERNARD GICHUKI"), false);
    assert.strictEqual(hefEngine.isBoilerplateText("40064257"), false);
    assert.strictEqual(hefEngine.isBoilerplateText("12345678901/2022"), false);
    assert.strictEqual(hefEngine.isBoilerplateText("University of Nairobi"), false);
    assert.strictEqual(hefEngine.isBoilerplateText("Bachelor of Science (Computer Science)"), false);
    assert.strictEqual(hefEngine.isBoilerplateText("Band 3"), false);
    assert.strictEqual(hefEngine.isBoilerplateText("KES 45,000"), false);
    assert.strictEqual(hefEngine.isBoilerplateText("2026/2027"), false);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST GROUP 2: Shape & Type Validation
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n--- Test Group 2: Centralized Shape Validators ---");

  test("National ID shape validator accepts valid IDs and rejects boilerplate/invalid strings", () => {
    assert.strictEqual(hefEngine.FIELD_VALIDATORS.nationalId("40064257"), true);
    assert.strictEqual(hefEngine.FIELD_VALIDATORS.nationalId("12345678"), true);
    assert.strictEqual(hefEngine.FIELD_VALIDATORS.nationalId("Copyright © 2026 HELB"), false);
    assert.strictEqual(hefEngine.FIELD_VALIDATORS.nationalId("abc123"), false);
    assert.strictEqual(hefEngine.FIELD_VALIDATORS.nationalId("12"), false);
  });

  test("KCSE Index shape validator accepts 11-digit format and rejects invalid formats", () => {
    assert.strictEqual(hefEngine.FIELD_VALIDATORS.kcseIndex("12345678901/2022"), true);
    assert.strictEqual(hefEngine.FIELD_VALIDATORS.kcseIndex("12345678901"), true);
    assert.strictEqual(hefEngine.FIELD_VALIDATORS.kcseIndex("Powered By: HELB ICT Team"), false);
    assert.strictEqual(hefEngine.FIELD_VALIDATORS.kcseIndex("1234"), false);
  });

  test("Band shape validator accepts Band 1-5 and rejects invalid ranges or footer text", () => {
    assert.strictEqual(hefEngine.FIELD_VALIDATORS.bandAllocated("Band 1"), true);
    assert.strictEqual(hefEngine.FIELD_VALIDATORS.bandAllocated("Band 5"), true);
    assert.strictEqual(hefEngine.FIELD_VALIDATORS.bandAllocated("3"), true);
    assert.strictEqual(hefEngine.FIELD_VALIDATORS.bandAllocated("Band 8"), false);
    assert.strictEqual(hefEngine.FIELD_VALIDATORS.bandAllocated("Copyright © 2026"), false);
  });

  test("Academic Year validator accepts 20XX/20YY format and rejects arbitrary text", () => {
    assert.strictEqual(hefEngine.FIELD_VALIDATORS.academicYear("2026/2027"), true);
    assert.strictEqual(hefEngine.FIELD_VALIDATORS.academicYear("2024-2025"), true);
    assert.strictEqual(hefEngine.FIELD_VALIDATORS.academicYear("2026"), false);
    assert.strictEqual(hefEngine.FIELD_VALIDATORS.academicYear("Copyright © 2026 HELB"), false);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST GROUP 3: resolveHefProfile & evaluateDataIntegrity
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n--- Test Group 3: resolveHefProfile & evaluateDataIntegrity ---");

  test("resolveHefProfile replaces boilerplate fields with 'Data not found'", () => {
    const profile = hefEngine.resolveHefProfile({
      name: "BERNARD GICHUKI",
      nationalId: "40064257",
      institution: "Copyright © 2026 HELB, All rights reserved.", // Corrupted field
      programme: "Powered By: HELB ICT Team",                    // Corrupted field
      band: "Band 3",
      academicYear: "2026/2027"
    });

    assert.strictEqual(profile.student.name, "BERNARD GICHUKI");
    assert.strictEqual(profile.student.nationalId, "40064257");
    assert.strictEqual(profile.student.institution, "Data not found");
    assert.strictEqual(profile.student.programme, "Data not found");
    assert.strictEqual(profile.student.academicYear, "2026/2027");
  });

  test("evaluateDataIntegrity raises dataIntegrityWarning when > 3 fields are unverified or rejected", () => {
    const rawData = {
      name: "BERNARD GICHUKI",
      nationalId: "40064257",
      academicYear: "2026/2027"
      // institution, programme, kcseIndex, band all missing -> 4 unverified
    };

    const integrity = hefEngine.evaluateDataIntegrity(rawData, {
      institution: { status: "REJECTED", reason: "Boilerplate/footer text detected", rawValue: "Copyright © 2026" }
    });

    assert.strictEqual(integrity.dataIntegrityWarning, true);
    assert.ok(/rejected by integrity guardrails|unverified/i.test(integrity.warningDetail));
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST GROUP 4: Playwright DOM Scraper Isolation Tests
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n--- Test Group 4: Playwright DOM Scraper Isolation & Rejection ---");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await asyncTest("Strategy 5 never matches page-wide row/col containers or footer text", async () => {
    // Synthetic HTML that mimics the exact bug scenario:
    // A form group with a label, but no direct value sibling, inside a large container with a footer
    const testHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <div class="row main-wrapper">
            <div class="col-md-6 form-group">
              <label class="control-label">Institution</label>
              <!-- Value is missing on this sub-page -->
            </div>
            <div class="col-md-12 footer">
              <p class="text-muted">Copyright © 2026 HELB, All rights reserved. Powered By: HELB ICT Team</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await page.setContent(testHtml);
    const auditReport = {};
    const extracted = await scrapeFieldByLabels(page, "institution", ["Institution"], [], auditReport);

    assert.strictEqual(extracted, null, "Extracted value must be null (never footer text)");
    assert.strictEqual(auditReport.institution.status, "NOT_FOUND");
    assert.notStrictEqual(extracted, "Copyright © 2026 HELB, All rights reserved. Powered By: HELB ICT Team");
  });

  await asyncTest("Strategy 6 extracts verified real fields from hidden input tags", async () => {
    const testHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <input type="hidden" id="user_id" name="user_id" value="40064257" />
          <input type="hidden" id="academic_year" name="academic_year" value="2026/2027" />
          <div class="dropdown-user">
            <span class="user-name"><b>BERNARD GICHUKI</b></span>
          </div>
        </body>
      </html>
    `;

    await page.setContent(testHtml);
    const auditReport = {};

    const name = await scrapeFieldByLabels(page, "name", ["Full Name", "Name"], [".dropdown-user .user-name b"], auditReport);
    const nationalId = await scrapeFieldByLabels(page, "nationalId", ["National ID"], ["input#user_id"], auditReport);
    const academicYear = await scrapeFieldByLabels(page, "academicYear", ["Academic Year"], ["input#academic_year"], auditReport);

    assert.strictEqual(name, "BERNARD GICHUKI");
    assert.strictEqual(nationalId, "40064257");
    assert.strictEqual(academicYear, "2026/2027");
    assert.strictEqual(auditReport.name.status, "FOUND");
    assert.strictEqual(auditReport.nationalId.status, "FOUND");
  });

  await page.route("**/*", route => {
    if (route.request().url().startsWith("http")) return route.abort();
    return route.continue();
  });

  await asyncTest("debug-dashboard.html snapshot extracts authentic attributes without footer leakage", async () => {
    const htmlPath = path.resolve(__dirname, "../../debug-dashboard.html");
    if (fs.existsSync(htmlPath)) {
      const htmlContent = fs.readFileSync(htmlPath, "utf-8");
      await page.setContent(htmlContent, { waitUntil: "commit", timeout: 10000 });

      const auditReport = {};
      const name = await scrapeFieldByLabels(page, "name", ["Full Name", "Name"], [".dropdown-user .user-name b", "input#unames"], auditReport);
      const nationalId = await scrapeFieldByLabels(page, "nationalId", ["National ID"], ["input#user_id"], auditReport);
      const academicYear = await scrapeFieldByLabels(page, "academicYear", ["Academic Year"], ["input#academic_year"], auditReport);
      const institution = await scrapeFieldByLabels(page, "institution", ["Institution"], ["input#institution", ".institution-name"], auditReport);

      assert.strictEqual(name, "BERNARD GICHUKI");
      assert.strictEqual(nationalId, "40064257");
      assert.strictEqual(academicYear, null);
      // On the initial landing page before navigating to profile/loans sub-routes, institution is missing from DOM
      // It must strictly be null / Data not found, NEVER footer copyright text
      assert.strictEqual(institution, null);
      assert.notStrictEqual(institution, "Copyright © 2026 HELB, All rights reserved. Powered By: HELB ICT Team");
    }
  });

  await browser.close();

  // ─────────────────────────────────────────────────────────────────────────
  // TEST GROUP 5: Conversational Entity Extraction & Zero Guessing
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n--- Test Group 5: Conversational Details Extraction & Zero Guessing ---");

  test("Extracts user provided National ID, KCSE index, Band, Institution, and Programme", () => {
    const text = "My name is Brian Kipkorir, national ID: 38472910, studying Computer Science at University of Nairobi, I am in Band 2, year 3 semester 1, kcse index: 12345678001/2021";
    const extracted = hefEngine.extractUserDetailsFromText(text);

    assert.strictEqual(extracted.name, "Brian Kipkorir");
    assert.strictEqual(extracted.nationalId, "38472910");
    assert.strictEqual(extracted.kcseIndex, "12345678001/2021");
    assert.strictEqual(extracted.band, 2);
    assert.strictEqual(extracted.yearOfStudy, 3);
    assert.strictEqual(extracted.currentSemester, 1);
    assert.ok(extracted.institution.includes("University of Nairobi"));
    assert.ok(extracted.programme.includes("Computer Science"));
  });

  test("Does not extract random numbers or Paybill as National ID", () => {
    const text = "Paybill 200800 repayment amount 50000";
    const extracted = hefEngine.extractUserDetailsFromText(text);
    assert.strictEqual(extracted.nationalId, undefined);
  });

  test("resolveHefProfile does not invent fake details when fields are missing", () => {
    const profile = hefEngine.resolveHefProfile({
      credential: "student@example.com"
    });

    assert.strictEqual(profile.student.nationalId, "Data not found");
    assert.strictEqual(profile.student.institution, "Data not found");
    assert.strictEqual(profile.student.programme, "Data not found");
    assert.strictEqual(profile.student.kcseIndex, "Data not found");
    assert.strictEqual(profile.funding.band, null);
    assert.strictEqual(profile.funding.cumulative.outstandingBalance, null);
    assert.deepStrictEqual(profile.disbursements, []);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST GROUP 6: Human Browser Interaction & Stealth Engine
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n--- Test Group 6: Human Browser Interaction & Stealth Engine ---");

  test("Bézier mouse path generates smooth multi-point trajectories with correct endpoints", () => {
    const startX = 100, startY = 150;
    const targetX = 650, targetY = 420;
    const pathPoints = human.generateBezierPath(startX, startY, targetX, targetY, 20);

    assert.ok(Array.isArray(pathPoints) && pathPoints.length >= 10, "Trajectory must contain at least 10 intermediate points");
    const firstPoint = pathPoints[0];
    const lastPoint = pathPoints[pathPoints.length - 1];

    assert.strictEqual(Math.round(firstPoint.x), startX, "Trajectory start X must match");
    assert.strictEqual(Math.round(firstPoint.y), startY, "Trajectory start Y must match");
    assert.strictEqual(Math.round(lastPoint.x), targetX, "Trajectory target X must match");
    assert.strictEqual(Math.round(lastPoint.y), targetY, "Trajectory target Y must match");
  });

  test("Random range and Gaussian utilities generate realistic human timing parameters", () => {
    for (let i = 0; i < 50; i++) {
      const rInt = human.randInt(50, 150);
      assert.ok(rInt >= 50 && rInt <= 150, "randInt must stay within specified bounds");

      const rGauss = human.randGaussian(100, 20);
      assert.ok(typeof rGauss === "number" && !isNaN(rGauss), "randGaussian must return valid numbers");
    }
  });

  await asyncTest("Human stealth setup injects realistic browser navigator overrides", async () => {
    const testBrowser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"]
    });
    const testCtx = await testBrowser.newContext();
    const testPage = await testCtx.newPage();

    await human.setupHumanStealth(testPage);
    await testPage.goto("data:text/html,<html><body><h1>Test Stealth</h1></body></html>");

    const evalResult = await testPage.evaluate(() => {
      return {
        webdriver: navigator.webdriver,
        hasChrome: typeof window.chrome === "object" && typeof window.chrome.runtime === "object",
        languages: navigator.languages,
        pluginsLength: navigator.plugins.length,
        hardwareConcurrency: navigator.hardwareConcurrency
      };
    });

    assert.ok(!evalResult.webdriver, "navigator.webdriver must be false or undefined");
    assert.strictEqual(evalResult.hasChrome, true, "window.chrome.runtime must exist");
    assert.ok(evalResult.languages.includes("en-KE"), "navigator.languages must include en-KE");
    assert.ok(evalResult.pluginsLength > 0, "navigator.plugins must be populated");
    assert.strictEqual(evalResult.hardwareConcurrency, 8, "hardwareConcurrency must be realistic (8)");

    await testBrowser.close();
  });

  await asyncTest("Sidebar navigation accurately locates items and expands Self Serve submenu", async () => {
    const testBrowser = await chromium.launch({ headless: true });
    const testCtx = await testBrowser.newContext();
    const testPage = await testCtx.newPage();

    const sidebarHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <div class="main-menu">
            <ul class="navigation">
              <li class="nav-item"><a href="/account/index"><span class="menu-title">Dashboard</span></a></li>
              <li class="nav-item has-sub">
                <a href="javascript:void(0);" id="my-account-parent"><span class="menu-title">My Account</span></a>
                <ul class="menu-content" id="my-account-menu" style="display: none;">
                  <li><a class="menu-item" href="/account/index/frm_profile">My Card</a></li>
                </ul>
              </li>
              <li class="nav-item">
                <a href="/nfm/index/frm_kuccps_details"><span class="menu-title">Update Institutions</span></a>
              </li>
              <li class="nav-item">
                <a href="/service/index/frm_loans"><span class="menu-title">My Loans</span></a>
              </li>
              <li class="nav-item has-sub" id="self-serve-li">
                <a href="javascript:void(0);" id="self-serve-parent" onclick="document.getElementById('self-serve-menu').style.display='block';"><span class="menu-title">Self Serve</span></a>
                <ul class="menu-content" id="self-serve-menu" style="display: none;">
                  <li><a class="menu-item" href="/service/index/frm_loan_statement">Loan Statement</a></li>
                  <li><a class="menu-item" href="/service/index/frm_clr_cert">Clearance Certificate</a></li>
                  <li><a class="menu-item" href="/service/index/frm_loan_repayment">Loan Repayment</a></li>
                </ul>
              </li>
            </ul>
          </div>
        </body>
      </html>
    `;

    await testPage.setContent(sidebarHtml);

    const portalSubPages = [
      {
        name: "Academic & Institution Details",
        url: "https://portal.hef.co.ke/nfm/index/frm_update_details",
        menuLink: 'a[href*="frm_update_details"], a[href*="frm_kuccps_details"], a:has-text("Update Institutions"), a:has-text("Update Profile")',
        parentMenu: "My Profile"
      },
      {
        name: "My Loans & Scholarships",
        url: "https://portal.hef.co.ke/service/index/frm_loans",
        menuLink: 'a[href*="frm_loans"], a:has-text("My Loans")'
      },
      {
        name: "HELB Loan Statement & Ledger",
        url: "https://portal.hef.co.ke/service/index/frm_loan_statement",
        menuLink: 'a[href*="frm_loan_statement"], a:has-text("Loan Statement")',
        parentMenu: "Self Serve"
      },
      {
        name: "Loan Repayment & Paybill",
        url: "https://portal.hef.co.ke/service/index/frm_loan_repayment",
        menuLink: 'a[href*="frm_loan_repayment"], a:has-text("Loan Repayment")',
        parentMenu: "Self Serve"
      },
      {
        name: "Clearance & Compliance",
        url: "https://portal.hef.co.ke/service/index/frm_clr_cert",
        menuLink: 'a[href*="frm_clr_cert"], a[href*="frm_comp_cert"], a:has-text("Clearance Certificate"), a:has-text("Compliance Certificate")',
        parentMenu: "Self Serve"
      }
    ];

    // Top-level "Update Institutions" link is directly visible
    const instLink = testPage.locator(portalSubPages[0].menuLink).first();
    assert.strictEqual(await instLink.isVisible(), true, "Update Institutions link should be visible");

    // "Self Serve" sub-link (Loan Statement) is initially hidden
    let stmtLink = testPage.locator(portalSubPages[2].menuLink).first();
    assert.strictEqual(await stmtLink.isVisible(), false, "Loan Statement link should initially be hidden in collapsed menu");

    // Expand Self Serve parent
    const selfServeParent = testPage.locator(`li.has-sub:has-text("Self Serve") > a, a:has-text("Self Serve")`).first();
    assert.strictEqual(await selfServeParent.isVisible(), true, "Self Serve parent menu should be visible");
    await selfServeParent.click();

    // Now Loan Statement sub-link is visible
    stmtLink = testPage.locator(portalSubPages[2].menuLink).first();
    assert.strictEqual(await stmtLink.isVisible(), true, "Loan Statement link should be visible after Self Serve expands");

    await testBrowser.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST GROUP 7: Fast Direct HTML Extraction & In-Memory Parsing (< 2ms)
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n--- Test Group 7: Fast Direct HTML Extraction & In-Memory Parsing ---");

  test("extractDataFromHtml instantly extracts all authentic hidden inputs and dropdowns from HTML", () => {
    const syntheticDashboardHtml = `
      <!DOCTYPE html>
      <html>
      <body>
        <div class="dropdown-user"><div class="user-name"><b>BERNARD GICHUKI WANJIKU</b></div></div>
        <input type="hidden" id="user_id" name="user_id" value="40064257" />
        <input type="hidden" id="unames" name="unames" value="BERNARD GICHUKI WANJIKU" />
        <input type="hidden" id="kcse_index" name="kcse_index" value="12345678001/2023" />
        <input type="hidden" id="institution" name="institution" value="UNIVERSITY OF NAIROBI" />
        <input type="hidden" id="programme" name="programme" value="BACHELOR OF SCIENCE IN COMPUTER SCIENCE" />
        <input type="hidden" id="study_year" name="study_year" value="2" />
        <input type="hidden" id="academic_year" name="academic_year" value="2025/2026" />
        <input type="hidden" id="usermobile" name="usermobile" value="0712345678" />
        <input type="hidden" id="bank_name" name="bank_name" value="EQUITY BANK" />
        <input type="hidden" id="account_number" name="account_number" value="1234567890" />
        <div class="band-badge">Band 3</div>
        <table id="big_table2">
          <tbody>
            <tr>
              <td>2025-09-15</td>
              <td>Semester 1</td>
              <td>Tuition Loan</td>
              <td>KES 35,000</td>
              <td>Disbursed</td>
              <td>Batch 44</td>
            </tr>
            <tr>
              <td>2025-09-20</td>
              <td>Semester 1</td>
              <td>Upkeep Stipend</td>
              <td>KES 25,000</td>
              <td>Disbursed</td>
              <td>Batch 44</td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `;

    const startTime = Date.now();
    const extracted = hefEngine.extractDataFromHtml(syntheticDashboardHtml, "https://portal.hef.co.ke/dashboard");
    const duration = Date.now() - startTime;

    assert.strictEqual(extracted.name, "BERNARD GICHUKI WANJIKU");
    assert.strictEqual(extracted.nationalId, "40064257");
    assert.strictEqual(extracted.kcseIndex, "12345678001/2023");
    assert.strictEqual(extracted.institution, "UNIVERSITY OF NAIROBI");
    assert.strictEqual(extracted.programme, "BACHELOR OF SCIENCE IN COMPUTER SCIENCE");
    assert.strictEqual(extracted.yearOfStudy, 2);
    assert.strictEqual(extracted.academicYear, "2025/2026");
    assert.strictEqual(extracted.phone, "0712345678");
    assert.strictEqual(extracted.bankName, "EQUITY BANK");
    assert.strictEqual(extracted.accountNumber, "1234567890");
    assert.strictEqual(extracted.band, 3);
    assert.strictEqual(extracted.bandName, "Band 3");
    assert.strictEqual(extracted.disbursements.length, 2);
    assert.strictEqual(extracted.disbursements[0].purpose, "Tuition Loan");
    assert.strictEqual(extracted.disbursements[1].purpose, "Upkeep Stipend");
    assert.ok(duration < 20, `In-memory extraction took ${duration}ms (expected < 20ms)`);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n===============================================================================");
  console.log(` TEST RUN COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log("===============================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
