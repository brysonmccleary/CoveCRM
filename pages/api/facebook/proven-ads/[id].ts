import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import ProvenAd from "@/models/ProvenAd";

function buildSearchableText(payload: any) {
  return [
    payload?.title || "",
    payload?.sourceBrand || "",
    payload?.leadType || "",
    payload?.format || "",
    payload?.audience || "",
    ...(Array.isArray(payload?.angleTags) ? payload.angleTags : []),
    payload?.hookType || "",
    payload?.headline || "",
    payload?.primaryText || "",
    payload?.description || "",
    payload?.transcript || "",
    payload?.visualNotes || "",
    payload?.landingPageNotes || "",
    payload?.whyItWorks || "",
    payload?.cloneNotes || "",
  ]
    .join(" \n ")
    .toLowerCase()
    .trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  const { id } = req.query as { id: string };
  if (!id) return res.status(400).json({ error: "Missing id" });

  const userEmail = session.user.email.toLowerCase();

  if (req.method === "GET") {
    const doc = await ProvenAd.findOne({
      _id: id,
      $or: [{ userEmail }, { scope: "global" }],
    }).lean();

    if (!doc) return res.status(404).json({ error: "Not found" });
    return res.status(200).json({ ad: doc });
  }

  if (req.method === "PATCH") {
    const existing = await ProvenAd.findOne({ _id: id, userEmail });
    if (!existing) return res.status(404).json({ error: "Not found or not editable" });

    const payload = req.body || {};
    const nextPayload = {
      ...existing.toObject(),
      ...payload,
    };

    nextPayload.searchableText = buildSearchableText(nextPayload);

    const updated = await ProvenAd.findByIdAndUpdate(
      id,
      { $set: nextPayload },
      { new: true }
    );

    return res.status(200).json({ ok: true, ad: updated });
  }

  if (req.method === "DELETE") {
    const deleted = await ProvenAd.findOneAndDelete({ _id: id, userEmail });
    if (!deleted) return res.status(404).json({ error: "Not found or not deletable" });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
