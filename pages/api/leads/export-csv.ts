import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { Types } from "mongoose";

function csvCell(val: any): string {
  const s = String(val ?? "").replace(/\r?\n/g, " ").replace(/"/g, '""');
  return `"${s}"`;
}

const HEADERS = [
  "First Name", "Last Name", "Phone", "Email", "State", "Age",
  "Beneficiary", "Coverage Amount", "Lead Type", "Status",
  "Notes", "Source", "Created At", "Score"
];

function buildRow(lead: any): string {
  const cells = [
    lead.firstName ?? lead["First Name"] ?? "",
    lead.lastName ?? lead["Last Name"] ?? "",
    lead.phone ?? lead.Phone ?? lead.normalizedPhone ?? "",
    lead.email ?? lead.Email ?? "",
    lead.state ?? lead.State ?? lead.rawRow?.State ?? lead.rawRow?.state ?? "",
    lead.age ?? lead.Age ?? lead.rawRow?.Age ?? "",
    lead.Beneficiary ?? lead.beneficiary ?? lead.rawRow?.Beneficiary ?? "",
    lead["Coverage Amount"] ?? lead.coverageAmount ?? lead.rawRow?.["Coverage Amount"] ?? "",
    lead.leadType ?? "",
    lead.status ?? "",
    lead.Notes ?? lead.notes ?? "",
    lead.leadSource ?? lead.source ?? lead.sourceType ?? "",
    lead.createdAt ? new Date(lead.createdAt).toLocaleDateString("en-US") : "",
    typeof lead.score === "number"
      ? String(lead.score)
      : typeof lead.aiPriorityScore === "number"
      ? String(lead.aiPriorityScore)
      : "",
  ];
  return cells.map(csvCell).join(",");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method Not Allowed" });

  const session = await getServerSession(req, res, authOptions as any) as any;
  const email = String(session?.user?.email ?? "").toLowerCase();
  if (!email) return res.status(401).json({ message: "Unauthorized" });

  const { folderId } = req.query as { folderId?: string };
  if (!folderId) return res.status(400).json({ message: "Missing folderId" });

  try {
    await dbConnect();

    let query: any;

    if (folderId === "unsorted") {
      query = {
        userEmail: email,
        $or: [{ folderId: { $exists: false } }, { folderId: null }],
      };
    } else {
      // Mirror exact folder resolution from get-leads-by-folder:
      // Try ObjectId first, then name-based lookup
      let canonicalId: Types.ObjectId | null = null;
      let canonicalIdStr = folderId;

      if (Types.ObjectId.isValid(folderId)) {
        canonicalId = new Types.ObjectId(folderId);
      } else {
        // name-based lookup
        const folderDoc = await Folder.findOne({
          userEmail: email,
          name: { $regex: new RegExp(`^${folderId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
        }).lean();
        if (folderDoc) {
          canonicalId = (folderDoc as any)._id;
          canonicalIdStr = String((folderDoc as any)._id);
        }
      }

      if (!canonicalId) {
        return res.status(404).json({ message: "Folder not found" });
      }

      query = {
        userEmail: email,
        $or: [
          { folderId: canonicalId },
          { folderId: canonicalIdStr },
          { $expr: { $eq: [{ $toString: "$folderId" }, canonicalIdStr] } },
        ],
      };
    }

    const leads = await Lead.find(query).lean().limit(10000).exec();

    if (leads.length === 0) {
      // Still return a valid CSV with just headers — don't error
    }

    const rows = [
      HEADERS.map(csvCell).join(","),
      ...leads.map(buildRow),
    ];

    const csv = rows.join("\r\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="leads-export.csv"`);
    res.status(200).send(csv);
  } catch (err: any) {
    console.error("export-csv error:", err?.message || err);
    res.status(500).json({ message: "Export failed" });
  }
}
