import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import Message from "@/models/Message";
import CallLog from "@/models/CallLog";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const allow = token && token === process.env.INTERNAL_API_TOKEN;
  if (!allow) return res.status(401).json({ error: "Unauthorized" });

  try {
    await mongooseConnect();
    await Promise.all([
      (Message as any).createIndexes(),
      (CallLog as any).createIndexes(),
    ]);
    return res.json({ ok: true, message: "Indexes ensured." });
  } catch (e: any) {
    console.error("ensure-indexes error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "failed" });
  }
}
