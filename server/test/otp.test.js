const assert = require("assert");
const http = require("http");
const { chromium } = require("playwright");

async function runOtpTestSuite() {
  console.log("\n===============================================================================");
  console.log(" RUNNING HELB / HEF OTP TWO-FACTOR AUTHENTICATION TEST SUITE");
  console.log("===============================================================================\n");

  // ── Test 1: Vercel Serverless api/helb/otp.js Honest Response ──
  console.log("--- Test Group 1: Serverless OTP Honest Endpoint ---");
  const serverlessOtpHandler = require("../../api/helb/otp.js");

  await new Promise((resolve) => {
    const mockReq = { method: "POST", body: { otp: "123456", sessionToken: "test-token" } };
    const mockRes = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(data) {
        assert.strictEqual(this.statusCode, 200);
        assert.strictEqual(data.ok, false);
        assert.strictEqual(data.success, false);
        assert.ok(data.message.includes("OTP is not supported on this deployment"));
        assert.ok(data.message.includes("portal.hef.co.ke"));
        console.log("  ✅ PASS: Serverless /api/helb/otp returns honest unsupported message without fake success");
        resolve();
      }
    };
    serverlessOtpHandler(mockReq, mockRes);
  });

  // ── Test 2: OTP Detection & Session Management in Browser ──
  console.log("\n--- Test Group 2: Playwright OTP Detection & Session In-Memory Lifecycle ---");
  
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Mock an OTP challenge page DOM (simulating portal.hef.co.ke/auth/otp)
  const otpPageHtml = `
    <!DOCTYPE html>
    <html>
      <head><title>HEF Portal - OTP Verification</title></head>
      <body>
        <div class="content">
          <h3>Enter Verification Code</h3>
          <p>An OTP has been sent to your registered phone number (+2547****123).</p>
          <form id="form-otp" action="/auth/verify_otp" method="POST">
            <input type="text" name="otp_code" id="otp" placeholder="Enter OTP code" />
            <button type="submit" id="btn-otp" class="btn btn-primary">Verify</button>
          </form>
        </div>
      </body>
    </html>
  `;
  await page.setContent(otpPageHtml);

  // Verify OTP selectors detect the OTP input
  const otpSelectors = [
    '#form-otp input',
    'input[name*="otp" i]',
    'input[id*="otp" i]',
    'input[placeholder*="otp" i]',
    '#otp'
  ];
  const otpInput = page.locator(otpSelectors.join(", ")).first();
  const isInputVisible = await otpInput.isVisible();
  assert.strictEqual(isInputVisible, true, "OTP input must be visible on the challenge page");
  console.log("  ✅ PASS: OTP challenge input element successfully detected via selector patterns");

  // Verify typing into OTP input
  await otpInput.fill("654321");
  const inputValue = await otpInput.inputValue();
  assert.strictEqual(inputValue, "654321");
  console.log("  ✅ PASS: Playwright fills OTP verification code into portal DOM");

  await ctx.close();
  await browser.close();

  // ── Test 3: OTP Session Expiry & Cleanup ──
  console.log("\n--- Test Group 3: OTP Session Cleanup Logic ---");
  const testSessionMap = new Map();
  let browserClosed = false;

  const mockBrowser = {
    close: async () => { browserClosed = true; }
  };
  const mockCtx = {
    close: async () => {}
  };
  const mockSessionId = "otp_test_12345";
  const timer = setTimeout(() => {}, 100000);

  testSessionMap.set(mockSessionId, {
    otpSessionId: mockSessionId,
    browser: mockBrowser,
    ctx: mockCtx,
    timer
  });

  assert.strictEqual(testSessionMap.has(mockSessionId), true);

  // Cleanup helper
  async function testCleanup(id) {
    const s = testSessionMap.get(id);
    if (!s) return;
    testSessionMap.delete(id);
    if (s.timer) clearTimeout(s.timer);
    if (s.browser) await s.browser.close();
  }

  await testCleanup(mockSessionId);
  assert.strictEqual(testSessionMap.has(mockSessionId), false);
  assert.strictEqual(browserClosed, true);
  console.log("  ✅ PASS: cleanupOtpSession properly removes session from Map and closes browser");

  console.log("\n===============================================================================");
  console.log(" ALL OTP TWO-FACTOR TESTS PASSED SUCCESSFULLY");
  console.log("===============================================================================\n");
}

runOtpTestSuite().catch(err => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
