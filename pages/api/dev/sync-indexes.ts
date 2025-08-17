import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import Message from "@/models/Message";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.replace("Bearer ", "");
    if (!process.env.INTERNAL_API_TOKEN || token !== process.env.INTERNAL_API_TOKEN) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    await mongooseConnect();
    const synced = await Message.syncIndexes(); // creates collection + fixes indexes
    const indexes = await Message.collection.indexes();
    return res.status(200).json({ success: true, synced, indexes });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || "Unknown error" });
  }
}
