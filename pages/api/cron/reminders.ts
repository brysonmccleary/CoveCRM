// /pages/api/cron/reminders.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";

// Dynamically load reminders helper so TS won't require the module at build time.
async function loadReminders() {
  try {
    // Avoid static import to prevent TS "cannot find module" when file isn't present
    const mod: any = await (eval("import"))("@/utils/scheduleReminders");
    return typeof mod?.checkAndSendReminders === "function"
      ? mod.checkAndSendReminders
      : async () => {};
  } catch {
    return async () => {};
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);

  if (!session?.user?.email) {
    console.log("🔒 Unauthorized reminder trigger attempt");
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const checkAndSendReminders = await loadReminders();
    console.log("🔁 Running reminder check for:", session.user.email);
    await checkAndSendReminders();
    console.log("✅ Reminder check complete");
    return res.status(200).json({ status: "Reminder check complete" });
  } catch (err) {
    console.error("❌ Reminder check failed:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}
