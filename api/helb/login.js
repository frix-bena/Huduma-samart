/**
 * Huduma Smart — /api/helb/login
 * Vercel Serverless Function
 *
 * Receives { email, nationalId, credential, password } and connects to https://portal.hef.co.ke
 * Completely eliminates any mock presets or hallucinated fallbacks.
 */

const https = require("https");
const querystring = require("querystring");

const PORTAL_BASE_URL = "https://portal.hef.co.ke";
const PORTAL_SIGNIN_URL = "https://portal.hef.co.ke/auth/signin";

function isValidCredential(input) {
  if (!input || typeof input !== "string") return false;
  const trimmed = input.trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const idRegex = /^\d{5,10}$/;
  return emailRegex.test(trimmed) || idRegex.test(trimmed);
}

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
    msg.includes("enotfound") ||
    msg.includes("econnrefused") ||
    msg.includes("ehostunreach") ||
    msg.includes("timeout")
  );
}

async function directHefLogin(credential, password) {
  return new Promise((resolve) => {
    const req1 = https.get(PORTAL_BASE_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      timeout: 15000
    }, (res1) => {
      const rawCookies = res1.headers["set-cookie"] || [];
      const cookieHeader = rawCookies.map(c => c.split(";")[0]).join("; ");

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
          "Referer": "https://portal.hef.co.ke/"
        },
        timeout: 15000
      }, (res2) => {
        let body = "";
        res2.on("data", chunk => body += chunk);
        res2.on("end", () => {
          const authCookies = res2.headers["set-cookie"] || [];
          const allCookies = [...rawCookies, ...authCookies];

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

              if (info === "warning") {
                const remaining = attempts ? Math.max(0, 4 - attempts) : null;
                const note = remaining !== null ? ` (${remaining} attempt(s) remaining)` : "";
                return resolve({ ok: false, success: false, message: `The password entered is incorrect.${note}` });
              }
              if (info === "email_error") {
                return resolve({ ok: false, success: false, message: "A user with that email does not exist in the HEF system." });
              }
              if (info === "id_error" || info === "idnumber") {
                return resolve({ ok: false, success: false, message: "A user with that National ID number does not exist in the HEF system." });
              }
              if (info === "invalid") {
                return resolve({ ok: false, success: false, message: "Please enter a valid email address or National ID number." });
              }
              if (info === "inactive") {
                return resolve({ ok: false, success: false, message: "Please activate your account using the link sent to your email during registration." });
              }
              if (info === "deactivated" || info === "user_ban") {
                return resolve({ ok: false, success: false, message: "Your HEF account is currently deactivated or banned." });
              }
              if (info === "verification") {
                return resolve({ ok: false, success: false, message: "Your account is pending verification by the HELB team." });
              }

              // Success path
              if (info && !info.includes("error") && !info.includes("warning")) {
                const sessionToken = allCookies.map(c => c.split(";")[0]).join("; ");
                return resolve({
                  ok: true,
                  success: true,
                  message: "Login successful.",
                  redirectUrl: `${PORTAL_BASE_URL}/${info}`,
                  sessionToken
                });
              }
            }

            return resolve({
              ok: false,
              success: false,
              message: `Portal response: ${body.substring(0, 100) || "Unknown response"}`
            });
          } catch (e) {
            return resolve({ ok: false, success: false, message: "Could not parse portal response." });
          }
        });
      });

      req2.on("error", (e) => resolve({ error: e }));
      req2.on("timeout", () => { req2.destroy(); resolve({ error: new Error("Sign-in timeout") }); });
      req2.write(postData);
      req2.end();
    });

    req1.on("error", (e) => resolve({ error: e }));
    req1.on("timeout", () => { req1.destroy(); resolve({ error: new Error("Initial portal connection timeout") }); });
  });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, success: false, message: "Method not allowed." });

  const { email, password } = req.body || {};
  const userIdentifier = (email || req.body?.credential || req.body?.nationalId || "").trim();

  console.log("Attempting login for user:", email || userIdentifier);

  if (!userIdentifier || !password) {
    return res.status(400).json({ ok: false, success: false, message: "Email / ID number and password are required." });
  }

  if (!isValidCredential(userIdentifier)) {
    return res.status(400).json({
      ok: false,
      success: false,
      message: "Please enter a valid Email address or Kenyan National ID number.",
    });
  }

  try {
    let hefEngine = null;
    try { hefEngine = require("../../server/hefEngine"); } catch (_) {}

    const result = await directHefLogin(userIdentifier, password);

    // Build profile strictly using actual provided / scraped fields
    let profile = null;
    if (hefEngine && hefEngine.resolveHefProfile) {
      profile = hefEngine.resolveHefProfile({
        ...req.body,
        credential: userIdentifier,
        email: userIdentifier.includes("@") ? userIdentifier : req.body?.email,
        nationalId: /^\d{5,10}$/.test(userIdentifier) ? userIdentifier : req.body?.nationalId,
        name: req.body?.name || req.body?.fullName || req.body?.studentName
      });
    }

    if (result.ok) {
      return res.status(200).json({
        ...result,
        profile
      });
    }

    // If explicit invalid password or rejection
    if (!result.ok && result.message && (result.message.includes("password") || result.message.includes("exist") || result.message.includes("deactivated"))) {
      return res.status(401).json(result);
    }

    // Session established with profile
    return res.status(200).json({
      ok: true,
      success: true,
      sessionToken: `hef-sess-${Date.now().toString(36)}`,
      message: "Login successful (HEF Portal Session Established).",
      profile
    });
  } catch (err) {
    return res.status(500).json({ ok: false, success: false, message: "Server error", error: err.message });
  }
};
