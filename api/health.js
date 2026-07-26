/** GET /api/health — service health check */
module.exports = (req, res) => {
  res.json({
    ok: true,
    service: "Huduma Smart — HELB AI Consultant",
    version: "2.0.0",
    runtime: "Vercel Serverless",
    ts: new Date().toISOString(),
  });
};
