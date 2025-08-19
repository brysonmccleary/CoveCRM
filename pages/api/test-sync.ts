import type { NextApiRequest, NextApiResponse } from "next";
// ✅ Use your existing helper’s path
import { syncSheetRow } from "@/lib/utils/syncSheetRow";

type Body = {
  "First Name"?: string;
  "Last Name"?: string;
  Email?: string;
  Phone?: string;
  Notes?: string;
  State?: string;
  Age?: string | number;
  Beneficiary?: string;
  "Coverage Amount"?: string | number;
  folderName?: string;
  userEmail?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const {
      "First Name": firstName,
      "Last Name": lastName,
      Email,
      Phone,
      Notes,
      State,
      Age,
      Beneficiary,
      "Coverage Amount": coverage,
      folderName,
      userEmail,
    } = (req.body || {}) as Body;

    const fullName = `${firstName || ""} ${lastName || ""}`.trim();

    const lead = await syncSheetRow({
      name: fullName,
      email: Email || "",
      phone: Phone || "",
      notes: Notes || "",
      folderName: folderName || "",
      userEmail: userEmail || "",
      additionalFields: {
        State,
        Age,
        Beneficiary,
        "Coverage Amount": coverage,
        "First Name": firstName,
        "Last Name": lastName,
      },
    });

    return res.status(200).json({ success: true, lead });
  } catch (err: any) {
    console.error("Sync Error:", err?.message || err);
    return res
      .status(500)
      .json({ success: false, error: err?.message || "Sync failed" });
  }
}
