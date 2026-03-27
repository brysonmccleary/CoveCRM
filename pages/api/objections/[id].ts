// pages/api/objections/[id].ts
// PUT  — update a user's own objection
// DELETE — delete a user's own objection
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import ObjectionEntry from "@/models/ObjectionEntry";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  const userEmail = session.user.email.toLowerCase();
  const { id } = req.query as { id: string };

  if (req.method === "PUT") {
    const { objection, response, category } = req.body as {
      objection?: string;
      response?: string;
      category?: string;
    };

    const updated = await ObjectionEntry.findOneAndUpdate(
      { _id: id, userEmail, isGlobal: false },
      { $set: { ...(objection && { objection }), ...(response && { response }), ...(category && { category }) } },
      { new: true }
    );

    if (!updated) return res.status(404).json({ error: "Not found or not yours" });
    return res.status(200).json({ ok: true, entry: updated });
  }

  if (req.method === "DELETE") {
    const deleted = await ObjectionEntry.findOneAndDelete({ _id: id, userEmail, isGlobal: false });
    if (!deleted) return res.status(404).json({ error: "Not found or not yours" });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
