import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongodb";
import Number from "@/models/Number";
import User from "@/models/User";
import twilioClient from "@/lib/twilioClient";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await dbConnect();
  const userEmail = session.user.email;
  const { id, force } = req.query;

  try {
    const number = await Number.findOne({ _id: id, user: userEmail });

    if (!number) {
      return res.status(404).json({ message: "Number not found or access denied" });
    }

    if (req.method === "DELETE") {
      const forceRelease = force === "true";

      if (!forceRelease) {
        // Check if this is the user's default SMS number
        const user = await User.findOne({ email: userEmail }).select("defaultSmsNumberId").lean();
        const defaultId = String((user as any)?.defaultSmsNumberId || "");
        const isDefault = defaultId && (defaultId === String(id) || defaultId === number.twilioSid);

        if (isDefault) {
          return res.status(409).json({
            requiresConfirmation: true,
            message: "This is your default SMS number. Releasing it will stop outbound SMS from using this number. Are you sure?",
          });
        }

        // Check for active drip enrollments (if DripEnrollment model exists)
        try {
          const DripEnrollment = (await import("@/models/DripEnrollment")).default;
          const activeCount = await (DripEnrollment as any).countDocuments({
            userEmail,
            status: "active",
          });
          if (activeCount > 0) {
            return res.status(409).json({
              requiresConfirmation: true,
              message: `This account has ${activeCount} active drip campaign(s). Releasing this number may stop those drips from sending. Are you sure?`,
            });
          }
        } catch {
          // DripEnrollment model may not exist in this build — skip check
        }
      }

      await twilioClient.incomingPhoneNumbers(number.twilioSid).remove();
      await number.deleteOne();
      res.status(200).json({ message: "Number deleted" });
    } else {
      res.status(405).json({ message: "Method not allowed" });
    }
  } catch (error) {
    console.error("Delete number error:", error);
    res.status(500).json({ message: "Failed to delete number" });
  }
}
