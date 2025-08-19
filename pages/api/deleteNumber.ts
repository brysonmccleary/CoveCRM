import type { NextApiRequest, NextApiResponse } from "next";
import twilioClient from "../../lib/twilioClient";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "DELETE") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { sid } = req.body;

  if (!sid) {
    return res.status(400).json({ message: "Missing SID" });
  }

  try {
    await twilioClient.incomingPhoneNumbers(sid).remove();
    res.status(200).json({ message: "Number deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error deleting number" });
  }
}
