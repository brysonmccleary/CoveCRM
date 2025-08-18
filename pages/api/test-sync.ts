// pages/api/test-sync.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { syncSheetRow } from "@/utils/syncSheetRow";

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
    } = req.body;

    const fullName = `${firstName} ${lastName}`.trim();

    const lead = await syncSheetRow({
      name: fullName,
      email: Email,
      phone: Phone,
      notes: Notes,
      folderName,
      userEmail,
      additionalFields: {
        State,
        Age,
        Beneficiary,
        "Coverage Amount": coverage,
        "First Name": firstName,
        "Last Name": lastName,
      },
    });

    res.status(200).json({ success: true, lead });
  } catch (err: any) {
    console.error("Sync Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}
