import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

const AI_CALLING_CERTIFICATION_VERSION = "ai_calling_consent_v1";
const AI_CALLING_CERTIFICATION_TEXT =
  "I certify that I have obtained all consent required by applicable law before using CoveCRM's AI-assisted calling, artificial voice, prerecorded voice, automated calling, SMS, email, or similar outreach features. I understand that CoveCRM does not obtain or verify consent on my behalf and that I am solely responsible for compliance with applicable law.";

function getClientIp(req: NextApiRequest): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (Array.isArray(forwardedFor)) {
    return forwardedFor[0]?.split(",")[0]?.trim() || "";
  }
  if (typeof forwardedFor === "string") {
    return forwardedFor.split(",")[0]?.trim() || "";
  }
  return req.socket.remoteAddress || "";
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const email =
    typeof session?.user?.email === "string"
      ? session.user.email.toLowerCase()
      : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  await dbConnect();

  if (req.method === "GET") {
    const user = await User.findOne({ email })
      .select(
        "aiCallingCertificationAccepted aiCallingCertificationAcceptedAt aiCallingCertificationVersion",
      )
      .lean<any>();

    if (!user) return res.status(404).json({ error: "User not found" });

    const accepted =
      user.aiCallingCertificationAccepted === true &&
      user.aiCallingCertificationVersion === AI_CALLING_CERTIFICATION_VERSION;

    return res.status(200).json({
      accepted,
      version: AI_CALLING_CERTIFICATION_VERSION,
      acceptedAt: accepted
        ? user.aiCallingCertificationAcceptedAt?.toISOString?.() || null
        : null,
    });
  }

  const accepted =
    req.body?.accepted === true || req.body?.certified === true;
  if (!accepted) {
    return res.status(400).json({
      error: "AI_CALLING_CERTIFICATION_REQUIRED",
      code: "AI_CALLING_CERTIFICATION_REQUIRED",
    });
  }

  const existing = await User.findOne({ email })
    .select(
      "aiCallingCertificationAccepted aiCallingCertificationAcceptedAt aiCallingCertificationVersion",
    )
    .lean<any>();

  if (!existing) return res.status(404).json({ error: "User not found" });

  if (
    existing.aiCallingCertificationAccepted === true &&
    existing.aiCallingCertificationVersion === AI_CALLING_CERTIFICATION_VERSION
  ) {
    return res.status(200).json({
      ok: true,
      accepted: true,
      version: AI_CALLING_CERTIFICATION_VERSION,
      acceptedAt:
        existing.aiCallingCertificationAcceptedAt?.toISOString?.() || null,
    });
  }

  const acceptedAt = new Date();
  await User.updateOne(
    { email },
    {
      $set: {
        aiCallingCertificationAccepted: true,
        aiCallingCertificationAcceptedAt: acceptedAt,
        aiCallingCertificationVersion: AI_CALLING_CERTIFICATION_VERSION,
        aiCallingCertificationText: AI_CALLING_CERTIFICATION_TEXT,
        aiCallingCertificationIp: getClientIp(req),
        aiCallingCertificationUserAgent: String(
          req.headers["user-agent"] || "",
        ),
      },
    },
  );

  return res.status(200).json({
    ok: true,
    accepted: true,
    version: AI_CALLING_CERTIFICATION_VERSION,
    acceptedAt: acceptedAt.toISOString(),
  });
}
