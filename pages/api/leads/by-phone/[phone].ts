import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";

/** Pull last 10 digits; if not 10 digits, we treat as invalid */
function last10(raw?: string): string | undefined {
  const d = String(raw || "").replace(/\D+/g, "");
  if (d.length < 10) return undefined;
  return d.slice(-10);
}

/** Build some common string variants to try (exact match or endsWith) */
function variantsFromLast10(l10: string) {
  const dashed = `${l10.slice(0, 3)}-${l10.slice(3, 6)}-${l10.slice(6)}`;
  return [l10, `1${l10}`, `+1${l10}`, dashed, `1-${dashed}`, `+1-${dashed}`];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET")
    return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const headerEmail = String(req.headers["x-user-email"] || "").toLowerCase();
  const userEmail = (session?.user?.email || headerEmail || "").toLowerCase();

  if (!userEmail) {
    // No auth context provided
    return res.status(401).json({ message: "Unauthorized" });
  }

  const raw = String(req.query.phone || "");
  const l10 = last10(raw);

  // If phone is garbage, just return a safe "no lead" payload so the UI stays quiet
  if (!l10) {
    return res.status(200).json({ lead: null });
  }

  try {
    await dbConnect();

    // Fast path: use normalized column
    let lead =
      (await Lead.findOne({ userEmail, phoneLast10: l10 }).lean()) ||
      // Fallback: ends-with scans on common fields
      (await Lead.findOne({
        userEmail,
        $or: [
          { Phone: new RegExp(`${l10}$`) },
          { phone: new RegExp(`${l10}$`) },
          { "Phone Number": new RegExp(`${l10}$`) },
        ],
      }).lean()) ||
      // Extra fallback: try a small set of common exact variants
      (await Lead.findOne({
        userEmail,
        $or: [
          { Phone: { $in: variantsFromLast10(l10) } },
          { phone: { $in: variantsFromLast10(l10) } },
        ],
      }).lean());

    // Return 200 with null if nothing found (UI handles gracefully)
    return res.status(200).json({ lead: lead || null });
  } catch (err) {
    console.error("❌ Error looking up phone:", err);
    return res.status(500).json({ message: "Server error" });
  }
}
