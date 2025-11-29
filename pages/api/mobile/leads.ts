// pages/api/mobile/leads.ts
import type { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";

const JWT_SECRET =
  process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET || "dev-mobile-secret";

type DecodedToken = {
  sub?: string;
  email?: string;
  role?: string;
};

function pick(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return String(v).trim();
    }
  }
  return "";
}

function normalizeUSPhone(raw?: string): string {
  const s = String(raw || "").replace(/[^\d+]/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return s;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // Expect: Authorization: Bearer <token>
  const authHeader =
    (req.headers.authorization as string | undefined) ||
    ((req.headers as any).Authorization as string | undefined);

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, error: "Missing token" });
  }

  const token = authHeader.slice("Bearer ".length).trim();

  let email: string | undefined;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as DecodedToken;
    email = decoded.email;
  } catch (err) {
    console.warn("mobile/leads invalid token:", err);
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }

  if (!email) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    await dbConnect();

    const userEmail = email.toLowerCase();

    // Same scoping as /api/get-leads.ts, but return a lightweight payload
    const leads = await Lead.find({ userEmail })
      .sort({ createdAt: -1 })
      .limit(200);

    const mapped = leads.map((lead: any) => {
      const firstName =
        lead.firstName ??
        pick(lead, [
          "First Name",
          "First_Name",
          "First",
          "Given Name",
          "FName",
        ]);
      const lastName =
        lead.lastName ??
        pick(lead, ["Last Name", "Last_Name", "Last", "Surname", "LName"]);
      const phone =
        lead.phone ??
        normalizeUSPhone(
          pick(lead, [
            "phone",
            "Phone",
            "Phone Number",
            "Primary Phone",
            "Mobile",
            "Cell",
          ])
        );
      const status = lead.status || "New";

      return {
        id: String(lead._id),
        firstName: firstName || "",
        lastName: lastName || "",
        phone: phone || "",
        status,
        folderId: lead.folderId ? String(lead.folderId) : null,
        createdAt: lead.createdAt || null,
      };
    });

    return res.status(200).json({
      ok: true,
      leads: mapped,
    });
  } catch (error) {
    console.error("mobile/leads error:", error);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
