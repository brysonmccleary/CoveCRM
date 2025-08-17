export default function handler(req, res) {
  console.log("✅ CRON JOB TRIGGERED");
  res.status(200).json({ ok: true });
}
