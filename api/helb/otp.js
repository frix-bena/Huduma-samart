/**
 * Huduma Smart — /api/helb/otp
 * Vercel Serverless Function
 *
 * OTP submission placeholder.
 * Full implementation requires persistent browser sessions (store context
 * state between requests — use Vercel KV or a Redis store in production).
 */
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const { otp, sessionToken } = req.body || {};
  if (!otp || !sessionToken) {
    return res.status(400).json({ ok: false, message: "otp and sessionToken are required." });
  }

  // TODO: Resume saved browser context and submit OTP
  // For now, return a graceful message
  return res.status(200).json({
    ok: false,
    message: "OTP submission requires a persistent session. Please log in again from the HELB portal directly if OTP is triggered.",
  });
};
