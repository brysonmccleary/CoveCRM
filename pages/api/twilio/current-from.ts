import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { pickFromNumberForUser } from "@/lib/twilio/pickFromNumber";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method Not Allowed" });

  const session = await getServerSession(req, res, authOptions as any);
  // TS-safe access (session is inferred as {} sometimes in API routes)
  const email = String((session as any)?.user?.email || "").toLowerCase();
  if (!email) return res.status(401).json({ message: "Unauthorized" });

  try {
    const from = await pickFromNumberForUser(email);
    return res.status(200).json({ from: from || null });
  } catch (e: any) {
    return res.status(500).json({ message: e?.message || "Failed to resolve from number" });
  }
}
