// pages/api/a2p/hosted-compliance.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";

type Resp =
  | {
      optInUrl: string;
      tosUrl: string;
      privacyUrl: string;
      selectedFlow: "lead_generation";
      leadGeneration: { optInUrl: string; tosUrl: string; privacyUrl: string };
      servicing: { optInUrl: string; tosUrl: string; privacyUrl: string };
    }
  | { error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email || !session?.user?.id) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    ((req.headers["referer"] as string)?.startsWith("https://") ? "https" : "http") ||
    "https";

  const host =
    (req.headers["x-forwarded-host"] as string) ||
    (req.headers["host"] as string) ||
    "";

  const baseUrl = host ? `${proto}://${host}` : "";

  const userId = String((session.user as any).id);
  const leadGeneration = {
    optInUrl: `${baseUrl}/sms/lead-optin/${userId}`,
    tosUrl: `${baseUrl}/sms/lead-optin-terms/${userId}`,
    privacyUrl: `${baseUrl}/sms/lead-optin-privacy/${userId}`,
  };
  const servicing = {
    optInUrl: `${baseUrl}/sms/optin/${userId}`,
    tosUrl: `${baseUrl}/sms/optin-terms/${userId}`,
    privacyUrl: `${baseUrl}/sms/optin-privacy/${userId}`,
  };

  return res.status(200).json({
    ...leadGeneration,
    selectedFlow: "lead_generation",
    leadGeneration,
    servicing,
  });
}
