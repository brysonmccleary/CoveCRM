import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import mongoose from "mongoose";

type Resp =
  | { message: string }
  | { lastIndex: number | null; total: number | null; updatedAt: string | null }
  | { ok: true };

async function getCollection() {
  await dbConnect();
  const coll = mongoose.connection.collection("dial_progress");
  // create the unique key once; ignored on subsequent calls
  try {
    await coll.createIndex({ userEmail: 1, key: 1 }, { unique: true });
  } catch {}
  return coll;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  const session = await getServerSession(req, res, authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email) return res.status(401).json({ message: "Unauthorized" });

  const coll = await getCollection();

  if (req.method === "GET") {
    const key = String(req.query.key || "").trim();
    if (!key) return res.status(400).json({ message: "Missing key" });

    const doc = await coll.findOne<{ lastIndex?: number; total?: number; updatedAt?: Date }>({ userEmail: email, key });
    return res.status(200).json({
      lastIndex: typeof doc?.lastIndex === "number" ? doc!.lastIndex : null,
      total: typeof doc?.total === "number" ? doc!.total : null,
      updatedAt: doc?.updatedAt ? doc.updatedAt.toISOString() : null,
    });
  }

  if (req.method === "POST") {
    const { key, lastIndex, total } = (req.body || {}) as { key?: string; lastIndex?: number; total?: number };
    if (!key || typeof lastIndex !== "number") {
      return res.status(400).json({ message: "Missing key or lastIndex" });
    }

    await coll.updateOne(
      { userEmail: email, key },
      {
        $set: {
          lastIndex,
          ...(typeof total === "number" ? { total } : {}),
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );

    return res.status(200).json({ ok: true });
  }

  // Optional but useful for “Start Fresh” button: clear saved progress for this key
  if (req.method === "DELETE") {
    const { key } = (req.body || {}) as { key?: string };
    if (!key) return res.status(400).json({ message: "Missing key" });
    await coll.deleteOne({ userEmail: email, key });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ message: "Method not allowed" });
}
