// /pages/api/leads/pages/api/numbers/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import dbConnect from "@/lib/mongodb";
import Number from "@/models/number"; // Your number model

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = (await getServerSession(
    req,
    res,
    authOptions as any,
  )) as Session | null;

  const userEmail =
    typeof session?.user?.email === "string"
      ? session.user.email.toLowerCase()
      : "";

  if (!userEmail) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await dbConnect();

  if (req.method === "GET") {
    try {
      const numbers = await Number.find({ user: userEmail }).lean();
      res.status(200).json(numbers || []);
    } catch (error) {
      console.error("Get numbers error:", error);
      res.status(500).json({ message: "Failed to fetch numbers" });
    }
    return;
  }

  res.status(405).json({ message: "Method not allowed" });
}
