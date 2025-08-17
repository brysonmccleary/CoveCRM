// /pages/api/leads/search.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  const or: any[] = [];
  const rx = new RegExp(q, "i");
  const digits = q.replace(/\D+/g, "");

  // Name/email (support both legacy "First Name"/"Last Name" and camelCase)
  or.push({ "First Name": rx });
  or.push({ "Last Name": rx });
  or.push({ firstName: rx });
  or.push({ lastName: rx });
  or.push({ Email: rx });
  or.push({ email: rx });

  // Phone (raw + last10 if present)
  if (digits.length >= 4) {
    const last = digits.slice(-10);
    or.push({ Phone: new RegExp(digits, "i") });
    or.push({ phone: new RegExp(digits, "i") });
    or.push({ phoneLast10: new RegExp(`${last}$`, "i") }); // ok if field doesn't exist
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

  const shaped = results.map((r: any) => {
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
