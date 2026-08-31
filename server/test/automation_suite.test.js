const assert = require("assert");
const { chromium } = require("playwright");
const hefEngine = require("../hefEngine");
const { getOrCreateSessionPage, cleanupActiveSession, ACTIVE_SESSIONS } = require("../index");

// HTML Mock Fixtures mimicking real portal.hef.co.ke pages
const HTML_LOAN_APP = `
<!DOCTYPE html>
<html>
<head><title>Undergraduate Loan Application - HEF Portal</title></head>
<body>
  <form id="frm_apply" action="/service/index/submit_app" method="POST">
    <input type="text" id="kcse_index" name="kcse_index" value="" />
    <input type="text" id="institution" name="institution" value="" />
    <input type="text" id="programme" name="programme" value="" />
    <input type="text" id="bank_name" name="bank_name" value="" />
    <input type="text" id="account_number" name="account_number" value="" />
    <button type="submit" id="btn_submit_app">Submit Application</button>
  </form>
</body>
</html>
`;

const HTML_STATUS_TRACKING = `
<!DOCTYPE html>
<html>
<head><title>My Applications - HEF Portal</title></head>
<body>
  <div class="card">
    <div class="card-title">Application Lifecycle</div>
    <span class="badge badge-success">Approved &amp; Band Assigned</span>
    <div id="mti_score">MTI Score: 642.50 (Band 2 - Extremely Needy)</div>
    <div id="sub_date">Submitted: 15-Aug-2024</div>
    <div id="app_date">Approved: 28-Aug-2024</div>
    <table id="tbl_apps">
      <thead><tr><th>Ref</th><th>Type</th><th>Academic Year</th><th>Stage</th><th>Status</th></tr></thead>
      <tbody>
        <tr>
          <td>HEF-2024-001</td>
          <td>Undergraduate Loan &amp; Scholarship</td>
          <td>2024/2025</td>
          <td>Stage 4: Admission Verified</td>
          <td><span class="badge">Approved</span></td>
        </tr>
      </tbody>
    </table>
  </div>
</body>
</html>
`;

const HTML_DISBURSEMENTS = `
<!DOCTYPE html>
<html>
<head><title>Disbursement Schedule - HEF Portal</title></head>
<body>
  <div class="allocation-summary">
    <div id="total_alloc">KES 140,000</div>
    <div id="tuition_alloc">KES 85,000</div>
    <div id="upkeep_alloc">KES 55,000</div>
  </div>
  <table id="tbl_disb">
    <thead><tr><th>Date</th><th>Tranche</th><th>Category</th><th>Amount</th><th>Status</th></tr></thead>
    <tbody>
      <tr>
        <td>10-Sep-2024</td>
        <td>Semester 1 Tranche 1</td>
        <td>Upkeep Loan</td>
        <td>KES 27,500</td>
        <td><span class="badge badge-success">Disbursed</span></td>
      </tr>
      <tr>
        <td>15-Sep-2024</td>
        <td>Semester 1 Tuition</td>
        <td>Tuition Loan &amp; Scholarship</td>
        <td>KES 42,500</td>
        <td><span class="badge badge-success">Disbursed</span></td>
      </tr>
    </tbody>
  </table>
</body>
</html>
`;

const HTML_EMPTY_DISBURSEMENTS = `
<!DOCTYPE html>
<html>
<head><title>Disbursement Schedule - HEF Portal</title></head>
<body>
  <table id="tbl_disb">
    <thead><tr><th>Date</th><th>Tranche</th><th>Category</th><th>Amount</th><th>Status</th></tr></thead>
    <tbody>
      <tr><td colspan="5" class="dataTables_empty">No records found</td></tr>
    </tbody>
  </table>
</body>
</html>
`;

const HTML_REPAYMENT_FORM = `
<!DOCTYPE html>
<html>
<head><title>Loan Repayment - HEF Portal</title></head>
<body>
  <form id="frm_repay">
    <input type="number" id="repay_amount" name="amount" value="" />
    <input type="text" id="phone_no" name="phone" value="" />
    <button type="submit" id="btn_submit_repay">Pay via M-PESA</button>
  </form>
</body>
</html>
`;

const HTML_STATEMENT = `
<!DOCTYPE html>
<html>
<head><title>Official Loan Statement - HEF Portal</title></head>
<body>
  <div class="stmt-summary">
    <div id="opening_bal">KES 0.00</div>
    <div id="closing_bal">KES 70,000.00</div>
    <div id="stmt_date">31-Aug-2024</div>
  </div>
  <table id="tbl_ledger">
    <thead><tr><th>Date</th><th>Ref</th><th>Description</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead>
    <tbody>
      <tr>
        <td>10-Sep-2024</td>
        <td>DISB-001</td>
        <td>Upkeep Disbursement Sem 1</td>
        <td>27,500.00</td>
        <td>0.00</td>
        <td>27,500.00</td>
      </tr>
      <tr>
        <td>15-Sep-2024</td>
        <td>DISB-002</td>
        <td>Tuition Loan Sem 1</td>
        <td>42,500.00</td>
        <td>0.00</td>
        <td>70,000.00</td>
      </tr>
    </tbody>
  </table>
</body>
</html>
`;

const HTML_EMPLOYER_PORTAL = `
<!DOCTYPE html>
<html>
<head><title>Employer Remittances - HEF Portal</title></head>
<body>
  <div id="emp_name">SAFARICOM PLC</div>
  <div id="emp_pin">P051123456Z</div>
  <form id="frm_upload">
    <input type="file" id="schedule_file" name="schedule_file" />
    <button type="submit" id="btn_upload_schedule">Upload Remittance File</button>
  </form>
  <table id="tbl_remittances">
    <thead><tr><th>Period</th><th>Batch Ref</th><th>Employees</th><th>Total Deducted</th><th>Payment Status</th></tr></thead>
    <tbody>
      <tr>
        <td>July 2024</td>
        <td>EMP-SCH-2024-771</td>
        <td>448</td>
        <td>KES 1,344,000</td>
        <td><span class="badge badge-success">Remitted</span></td>
      </tr>
    </tbody>
  </table>
</body>
</html>
`;

async function runAutomationTests() {
  console.log("\n" + "=".repeat(79));
  console.log(" RUNNING COMPREHENSIVE HEF PORTAL PLAYWRIGHT AUTOMATION TEST SUITE");
  console.log("=".repeat(79) + "\n");

  let passed = 0;
  let failed = 0;
  let browser = null;

  try {
    browser = await chromium.launch({ headless: true });

    // ── Test Group 1: Loan & Scholarship Applications ──
    console.log("--- Test Group 1: Loan & Scholarship Applications ---");
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      // Missing required fields validation
      const invalidRes = await hefEngine.submitLoanApplication(page, "undergraduate", {});
      assert.strictEqual(invalidRes.ok, false, "Should fail when required fields are missing");
      assert.ok(invalidRes.error.toLowerCase().includes("kcse"), "Should specify missing KCSE Index");
      console.log("  ✅ PASS: submitLoanApplication rejects missing required fields without guessing");
      passed++;

      // Set form DOM
      await page.setContent(HTML_LOAN_APP);
      page.url = () => "https://portal.hef.co.ke/service/index/frm_apply_undergraduate";
      page.goto = async () => ({ status: () => 200 });

      // On submit, update DOM to confirmation
      await page.evaluate(() => {
        const form = document.querySelector("#frm_apply") || document.querySelector("form");
        if (form) {
          form.addEventListener("submit", (e) => {
            e.preventDefault();
            document.body.innerHTML = `
              <div class="alert alert-success">
                Application submitted successfully. Reference: <strong>HEF-UG-2024-984712</strong>
              </div>
              <div id="application_ref">HEF-UG-2024-984712</div>
            `;
          });
        }
      });

      const validRes = await hefEngine.submitLoanApplication(page, "undergraduate", {
        kcseIndex: "12345678001/2023",
        institution: "University of Nairobi",
        programme: "Bachelor of Science in Computer Science",
        bankName: "Equity Bank",
        accountNumber: "0123456789"
      });

      assert.strictEqual(validRes.ok, true, `Should succeed with valid application details: ${validRes.error}`);
      assert.ok(validRes.reference.includes("HEF-UG-2024"), "Should extract real portal application reference");
      assert.ok(validRes.section.includes("Loan Application"), "Should include data provenance section");
      console.log("  ✅ PASS: submitLoanApplication extracts authentic confirmation reference and provenance");
      passed++;

      await ctx.close();
    }

    // ── Test Group 2: Status Tracking ──
    console.log("\n--- Test Group 2: Status Tracking ---");
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.setContent(HTML_STATUS_TRACKING);
      page.url = () => "https://portal.hef.co.ke/service/index/frm_loan_status";
      page.goto = async () => ({ status: () => 200 });

      const statusRes = await hefEngine.getApplicationStatus(page);
      assert.strictEqual(statusRes.ok, true, "Should succeed extracting status");
      assert.ok(statusRes.status.includes("Approved"), "Should extract authentic status badge text");
      assert.ok(statusRes.mtiScore.includes("642.50"), "Should extract verbatim MTI score from DOM");
      assert.strictEqual(statusRes.applications.length, 1, "Should extract application table row");
      assert.strictEqual(statusRes.applications[0].ref, "HEF-2024-001");
      assert.strictEqual(statusRes.section, "My Applications / Status Tracking", "Should record provenance");
      console.log("  ✅ PASS: getApplicationStatus extracts verbatim status, MTI score, and table rows");
      passed++;

      await ctx.close();
    }

    // ── Test Group 3: Allocation & Disbursements ──
    console.log("\n--- Test Group 3: Allocation & Disbursements ---");
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.setContent(HTML_DISBURSEMENTS);
      page.url = () => "https://portal.hef.co.ke/service/index/frm_loans";
      page.goto = async () => ({ status: () => 200 });

      const disbRes = await hefEngine.getDisbursements(page);
      assert.strictEqual(disbRes.ok, true, "Should succeed extracting disbursements");
      assert.strictEqual(disbRes.disbursements.length, 2, "Should extract exactly 2 tranche rows");
      assert.strictEqual(disbRes.disbursements[0].date, "10-Sep-2024");
      assert.ok(disbRes.disbursements[0].amount.includes("27,500"), "Should extract authentic tranche amount");
      assert.strictEqual(disbRes.disbursements[0].status, "Disbursed");
      assert.strictEqual(disbRes.section, "My Loans & Disbursement Schedule");
      console.log("  ✅ PASS: getDisbursements extracts real allocation breakdown and tranche amounts");
      passed++;

      // Test true empty state
      await page.setContent(HTML_EMPTY_DISBURSEMENTS);
      const emptyRes = await hefEngine.getDisbursements(page);
      assert.strictEqual(emptyRes.ok, true);
      assert.strictEqual(emptyRes.disbursements.length, 0, "Empty table should yield 0 rows, no placeholder data");
      console.log("  ✅ PASS: getDisbursements yields true empty list when portal has no disbursements");
      passed++;

      await ctx.close();
    }

    // ── Test Group 4: Self-Serve Repayment ──
    console.log("\n--- Test Group 4: Self-Serve Repayment ---");
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      // Zero or invalid amount validation
      const badAmtRes = await hefEngine.initiateRepayment(page, 0, "mpesa_stk");
      assert.strictEqual(badAmtRes.ok, false, "Should reject invalid amount");
      console.log("  ✅ PASS: initiateRepayment rejects invalid amounts");
      passed++;

      // Valid repayment with mock form & success response
      await page.setContent(HTML_REPAYMENT_FORM);
      page.url = () => "https://portal.hef.co.ke/service/index/frm_loan_repayment";
      page.goto = async () => ({ status: () => 200 });

      await page.evaluate(() => {
        const form = document.querySelector("#frm_repay") || document.querySelector("form");
        if (form) {
          form.addEventListener("submit", (e) => {
            e.preventDefault();
            document.body.innerHTML = `
              <div class="alert alert-success">
                Payment request received. Please check your phone for the M-PESA STK prompt. Transaction Ref: <strong>HEF-REP-918234</strong>.
              </div>
              <div id="tx_ref">HEF-REP-918234</div>
            `;
          });
        }
      });

      const repRes = await hefEngine.initiateRepayment(page, 1500, "mpesa_stk", { phone: "0712345678" });
      assert.strictEqual(repRes.ok, true, `Should succeed with valid repayment request: ${repRes.error}`);
      assert.strictEqual(repRes.amount, 1500);
      assert.ok(repRes.reference.includes("HEF-REP-918234"), "Should extract authentic transaction ref");
      assert.ok(repRes.section.includes("Loan Repayment"), "Should include data provenance");
      console.log("  ✅ PASS: initiateRepayment extracts authentic reference from portal confirmation DOM");
      passed++;

      await ctx.close();
    }

    // ── Test Group 5: Statements & Receipts ──
    console.log("\n--- Test Group 5: Statements & Receipts ---");
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.setContent(HTML_STATEMENT);
      page.url = () => "https://portal.hef.co.ke/service/index/frm_loan_statement";
      page.goto = async () => ({ status: () => 200 });

      const stmtRes = await hefEngine.getLoanStatement(page);
      assert.strictEqual(stmtRes.ok, true, "Should succeed extracting loan statement");
      assert.strictEqual(stmtRes.ledger.length, 2, "Should extract 2 ledger entries");
      assert.strictEqual(stmtRes.ledger[0].debit, 27500);
      assert.strictEqual(stmtRes.ledger[1].balance, 70000);
      assert.strictEqual(stmtRes.summary.closingBalance, 70000);
      assert.strictEqual(stmtRes.section, "Official Statement of Loan Account");
      console.log("  ✅ PASS: getLoanStatement extracts authentic ledger rows and balances");
      passed++;

      await ctx.close();
    }

    // ── Test Group 6: Employer Remittances ──
    console.log("\n--- Test Group 6: Employer Remittances ---");
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.setContent(HTML_EMPLOYER_PORTAL);
      page.url = () => "https://portal.hef.co.ke/employer/index/frm_remittance_upload";
      page.goto = async () => ({ status: () => 200 });

      await page.evaluate(() => {
        const form = document.querySelector("#frm_upload") || document.querySelector("form");
        if (form) {
          form.addEventListener("submit", (e) => {
            e.preventDefault();
            document.body.innerHTML = `
              <div class="alert alert-success" id="upload_success">
                Remittance schedule uploaded successfully for period: <strong>August 2024</strong>. Total records: <strong>450</strong>. Batch Ref: <strong>EMP-SCH-2024-889</strong>.
              </div>
            `;
          });
        }
      });

      // Upload Remittance Schedule
      const uploadRes = await hefEngine.uploadRemittanceSchedule(page, {
        fileName: "safaricom_aug2024_deductions.csv",
        recordsCount: 450,
        period: "August 2024"
      });
      assert.strictEqual(uploadRes.ok, true, `Should extract upload confirmation: ${uploadRes.error}`);
      assert.ok(uploadRes.batchRef.includes("EMP-SCH-2024-889"), "Should extract batch reference");
      assert.strictEqual(uploadRes.recordsUploaded, 450);
      console.log("  ✅ PASS: uploadRemittanceSchedule scrapes real portal upload batch reference");
      passed++;

      // Remittance records
      await page.setContent(HTML_EMPLOYER_PORTAL);
      page.url = () => "https://portal.hef.co.ke/employer/index/frm_remittance_records";
      const recordsRes = await hefEngine.getRemittanceRecords(page);
      assert.strictEqual(recordsRes.ok, true, "Should extract remittance records");
      assert.strictEqual(recordsRes.records.length, 1);
      assert.strictEqual(recordsRes.records[0].period, "July 2024");
      assert.strictEqual(recordsRes.records[0].status, "Remitted");
      console.log("  ✅ PASS: getRemittanceRecords extracts employer remittance ledger table");
      passed++;

      await ctx.close();
    }

    // ── Test Group 7: Active Session Management & Page Reuse ──
    console.log("\n--- Test Group 7: Session Management & Page Reuse ---");
    {
      const testIdentifier = "28471923";
      ACTIVE_SESSIONS.set(testIdentifier, {
        identifier: testIdentifier,
        sessionToken: "test-token-active",
        scrapedData: {},
        profile: {},
        page: null,
        ctx: null,
        browser: null,
        loginTime: Date.now(),
        lastActive: Date.now()
      });

      // Spawn page via getOrCreateSessionPage
      const sessionRes1 = await getOrCreateSessionPage(testIdentifier);
      assert.strictEqual(sessionRes1.ok, true, "Should initialize page for active session");
      const activePage = sessionRes1.page;
      assert.ok(activePage && !activePage.isClosed(), "Page should be open and active");

      // Calling again should return the exact same page instance (session reuse)
      const sessionRes2 = await getOrCreateSessionPage(testIdentifier);
      assert.strictEqual(sessionRes2.ok, true);
      assert.strictEqual(sessionRes2.page, activePage, "Must reuse the identical page instance");
      console.log("  ✅ PASS: getOrCreateSessionPage reuses existing authenticated page instance");
      passed++;

      // Cleanup
      await cleanupActiveSession(testIdentifier);
      assert.strictEqual(ACTIVE_SESSIONS.has(testIdentifier), false, "Active session should be deleted on cleanup");
      assert.strictEqual(activePage.isClosed(), true, "Page must be cleanly closed after session cleanup");
      console.log("  ✅ PASS: cleanupActiveSession cleanly disposes of page and session state");
      passed++;
    }

  } catch (err) {
    console.error("\n❌ Test execution failed with error:", err);
    failed++;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  console.log("\n" + "=".repeat(79));
  console.log(` AUTOMATION SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log("=".repeat(79) + "\n");

  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  runAutomationTests();
}

module.exports = { runAutomationTests };
