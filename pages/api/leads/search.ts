// /pages/api/leads/search.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.status(405).json({ message: "Method not allowed" });
    return;
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const userEmail = String(session.user.email).toLowerCase();
  const q = String(req.query.q || "").trim();
  if (!q) {
    res.status(200).json({ results: [] });
    return;
  }

  await dbConnect();

  const rx = new RegExp(escapeRegex(q), "i");
  const digits = q.replace(/\D+/g, "");

  const or: any[] = [
    { "First Name": rx },
    { "Last Name": rx },
    { firstName: rx },
    { lastName: rx },
    { Email: rx },
    { email: rx },
  ];

  if (digits.length >= 2) {
    or.push({ Phone: { $regex: digits, $options: "i" } });
    or.push({ phone: { $regex: digits, $options: "i" } });
    or.push({ normalizedPhone: { $regex: digits, $options: "i" } });
    or.push({ phoneLast10: { $regex: digits, $options: "i" } });
  }

  const results = await Lead.find({ userEmail, $or: or })
    .select({
      State: 1,
      state: 1,
      Phone: 1,
      phone: 1,
      Email: 1,
      email: 1,
      folderId: 1,
      status: 1,
      updatedAt: 1,
      "First Name": 1,
      "Last Name": 1,
      firstName: 1,
      lastName: 1,
    })
    .sort({ updatedAt: -1 })
    .limit(20)
    .lean();

  const shaped = (results as any[]).map((r) => {
    const first = r["First Name"] || r.firstName || "";
    const last = r["Last Name"] || r.lastName || "";
    const phone = r.Phone || r.phone || "";
    const email = r.Email || r.email || "";
    const state = r.State || r.state || "";
    return {
      _id: String(r._id),
      firstName: first,
      lastName: last,
      phone,
      email,
      state,
      folderId: r.folderId ? String(r.folderId) : null,
      status: r.status || "New",
      updatedAt: r.updatedAt,
      displayName: [first, last].filter(Boolean).join(" ").trim(),
    };
  });

  res.status(200).json({ results: shaped });
}
