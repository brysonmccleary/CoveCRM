// pages/api/numbers/spam-check.ts
// POST — check spam status for a phone number
// GET  — get cached spam status for all user numbers
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import NumberSpamStatus from "@/models/NumberSpamStatus";
import { checkSpamStatus } from "@/lib/twilio/checkSpamStatus";

function normalizePhone(value: unknown): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (String(value || "").trim().startsWith("+")) return `+${digits}`;
  return digits;
}

function toUnknownStatus(phoneNumber: string, checkedAt?: unknown) {
  return {
    phoneNumber,
    spamScore: 0,
    spamLabel: "Unknown",
    isSpam: false,
    checkedAt: checkedAt || null,
    rawResponse: {
      provider: "twilio",
      status: "not_configured",
      reason: "Twilio Voice Integrity reputation checks are not implemented yet.",
    },
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  const userEmail = session.user.email.toLowerCase();

  if (req.method === "GET") {
    const statuses = await NumberSpamStatus.find({ userEmail }).lean();
    return res.status(200).json({
      statuses: statuses.map((status: any) =>
        toUnknownStatus(String(status.phoneNumber || ""), status.checkedAt),
      ),
    });
  }

  if (req.method === "POST") {
    const { phoneNumber } = req.body as { phoneNumber?: string };
    if (!phoneNumber) return res.status(400).json({ error: "phoneNumber required" });

    const user = await User.findOne({ email: userEmail }).select("numbers").lean();
    const ownedNumber = ((user as any)?.numbers || []).find(
      (num: any) => normalizePhone(num?.phoneNumber) === normalizePhone(phoneNumber),
    );
    if (!ownedNumber?.phoneNumber) {
      return res.status(403).json({ error: "Number is not assigned to this account" });
    }

    const canonicalPhoneNumber = String(ownedNumber.phoneNumber);
    const result = await checkSpamStatus(canonicalPhoneNumber);

    return res.status(200).json({
      ok: true,
      status: {
        ...toUnknownStatus(canonicalPhoneNumber),
        rawResponse: result.raw,
      },
    });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
