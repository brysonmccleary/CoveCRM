import type { NextApiRequest, NextApiResponse } from "next";
import mongoose from "mongoose";
import dbConnect from "@/lib/mongooseConnect";

export default async function handler(_: NextApiRequest, res: NextApiResponse) {
  try {
    if (mongoose.connection.readyState === 0) await dbConnect();
    return res.status(200).json({
      ok: true,
      state: mongoose.connection.readyState, // 1 = connected
      db: mongoose.connection?.name,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "unknown" });
  }
}
