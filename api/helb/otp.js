/**
 * Huduma Smart — /api/helb/otp
 * Vercel Serverless Function
 *
 * OTP submission endpoint for Vercel serverless deployment.
 * Serverless functions cannot maintain persistent Playwright browser instances
 * across stateless HTTP requests.
 */
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, success: false, message: "Method not allowed." });

  return res.status(200).json({
    ok: false,
    success: false,
    message: "OTP is not supported on this deployment, please complete login at portal.hef.co.ke directly."
  });
};
