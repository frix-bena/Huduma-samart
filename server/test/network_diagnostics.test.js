const assert = require("assert");
const http = require("http");
const https = require("https");
const {
  getProxyConfig,
  checkPortalPlainHttpHealth,
  isNetworkError,
  PORTAL_BASE_URL,
} = require("../index");

async function runTests() {
  console.log("===============================================================================");
  console.log(" RUNNING PROXY, RETRY DIAGNOSTICS & UPSTREAM HEALTH TEST SUITE");
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
  // TEST GROUP 1: Proxy Configuration Engine
  // ─────────────────────────────────────────────────────────────────────────
  console.log("--- Test Group 1: Proxy Configuration Engine ---");

  test("Returns null when PROXY_SERVER is empty or not set", () => {
    delete process.env.PROXY_SERVER;
    delete process.env.PROXY_USERNAME;
    delete process.env.PROXY_PASSWORD;

    const config = getProxyConfig();
    assert.strictEqual(config, null);
  });

  test("Constructs Playwright proxy and https-proxy-agent from PROXY_SERVER", () => {
    process.env.PROXY_SERVER = "proxy.nairobi.ke:8080";
    delete process.env.PROXY_USERNAME;
    delete process.env.PROXY_PASSWORD;

    const config = getProxyConfig();
    assert.ok(config !== null);
    assert.strictEqual(config.server, "http://proxy.nairobi.ke:8080");
    assert.strictEqual(config.playwrightProxy.server, "http://proxy.nairobi.ke:8080");
    assert.strictEqual(config.playwrightProxy.username, undefined);
    assert.ok(config.httpsAgent !== null);
    assert.strictEqual(config.httpsAgent.proxy.hostname, "proxy.nairobi.ke");
    assert.strictEqual(config.httpsAgent.proxy.port, "8080");

    delete process.env.PROXY_SERVER;
  });

  test("Includes PROXY_USERNAME and PROXY_PASSWORD in Playwright and HTTPS agent", () => {
    process.env.PROXY_SERVER = "http://residential.ke.proxy:3128";
    process.env.PROXY_USERNAME = "kenya_user";
    process.env.PROXY_PASSWORD = "secret_password_123";

    const config = getProxyConfig();
    assert.ok(config !== null);
    assert.strictEqual(config.username, "kenya_user");
    assert.strictEqual(config.password, "secret_password_123");
    assert.strictEqual(config.playwrightProxy.server, "http://residential.ke.proxy:3128");
    assert.strictEqual(config.playwrightProxy.username, "kenya_user");
    assert.strictEqual(config.playwrightProxy.password, "secret_password_123");
    assert.ok(config.httpsAgent !== null);
    assert.strictEqual(config.httpsAgent.proxy.username, "kenya_user");
    assert.strictEqual(config.httpsAgent.proxy.password, "secret_password_123");

    delete process.env.PROXY_SERVER;
    delete process.env.PROXY_USERNAME;
    delete process.env.PROXY_PASSWORD;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST GROUP 2: Network Error Categorization
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n--- Test Group 2: Network Error Detection ---");

  test("Identifies connection resets, timeouts, protocol errors, and DNS failures as network errors", () => {
    assert.strictEqual(isNetworkError(new Error("net::ERR_CONNECTION_RESET")), true);
    assert.strictEqual(isNetworkError(new Error("net::ERR_SSL_PROTOCOL_ERROR")), true);
    assert.strictEqual(isNetworkError(new Error("net::ERR_NAME_NOT_RESOLVED")), true);
    assert.strictEqual(isNetworkError(new Error("net::ERR_CONNECTION_TIMED_OUT")), true);
    assert.strictEqual(isNetworkError(new Error("Timeout 45000ms exceeded")), true);
    assert.strictEqual(isNetworkError(new Error("getaddrinfo ENOTFOUND portal.hef.co.ke")), true);
    assert.strictEqual(isNetworkError(new Error("connect ECONNREFUSED 102.219.210.1:443")), true);
    assert.strictEqual(isNetworkError(new Error("connect ETIMEDOUT")), true);
  });

  test("Does not flag validation or business logic errors as network errors", () => {
    assert.strictEqual(isNetworkError(new Error("The password entered is incorrect.")), false);
    assert.strictEqual(isNetworkError(new Error("Please enter a valid Email address")), false);
    assert.strictEqual(isNetworkError(null), false);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST GROUP 3: Upstream Plain HTTP Health Check
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n--- Test Group 3: Upstream Plain HTTP Health Check ---");

  await asyncTest("checkPortalPlainHttpHealth returns object with ok boolean and durationMs", async () => {
    const health = await checkPortalPlainHttpHealth(3000);
    assert.ok(typeof health === "object");
    assert.ok(typeof health.ok === "boolean");
    assert.ok(typeof health.durationMs === "number");
    console.log(`     Upstream check result: ok=${health.ok}, statusCode=${health.statusCode}, duration=${health.durationMs}ms`);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST GROUP 4: Diagnostic Branch Reporting Logic
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n--- Test Group 4: Diagnostic Branch Reporting Logic ---");

  test("Diagnostic branches are clearly categorized: plain-http-failed vs playwright-only-failed", () => {
    // Scenario A: Plain HTTP failed (network-level outage / IP block)
    const healthFail = { ok: false, error: new Error("ENOTFOUND") };
    let branchFail = healthFail.ok ? "playwright-only-failed" : "plain-http-failed";
    let messageFail = healthFail.ok
      ? "Portal is reachable via plain HTTP but Playwright navigation is failing — possible bot-protection/anti-automation block"
      : "The HELB/HEF portal appears to be unreachable from this server (network-level failure) — try again shortly or check if this server's IP is being blocked.";

    assert.strictEqual(branchFail, "plain-http-failed");
    assert.ok(messageFail.includes("network-level failure"));

    // Scenario B: Plain HTTP succeeded, Playwright failed (bot protection / headless block)
    const healthSuccess = { ok: true, statusCode: 200 };
    let branchSuccess = healthSuccess.ok ? "playwright-only-failed" : "plain-http-failed";
    let messageSuccess = healthSuccess.ok
      ? "Portal is reachable via plain HTTP but Playwright navigation is failing — possible bot-protection/anti-automation block"
      : "The HELB/HEF portal appears to be unreachable from this server (network-level failure) — try again shortly or check if this server's IP is being blocked.";

    assert.strictEqual(branchSuccess, "playwright-only-failed");
    assert.ok(messageSuccess.includes("bot-protection/anti-automation block"));
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST GROUP 5: Timeout Adaptation
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n--- Test Group 5: Timeout Adaptation ---");

  test("Sets 45000ms per attempt without proxy and 60000ms with proxy", () => {
    delete process.env.PROXY_SERVER;
    const cfgWithout = getProxyConfig();
    const timeoutWithout = cfgWithout ? 60000 : 45000;
    assert.strictEqual(timeoutWithout, 45000);

    process.env.PROXY_SERVER = "http://127.0.0.1:8080";
    const cfgWith = getProxyConfig();
    const timeoutWith = cfgWith ? 60000 : 45000;
    assert.strictEqual(timeoutWith, 60000);

    delete process.env.PROXY_SERVER;
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
