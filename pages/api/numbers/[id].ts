import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongodb";
import Number from "@/models/number";
import twilioClient from "@/lib/twilioClient";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await dbConnect();
  const userEmail = session.user.email;
  const { id } = req.query;

  try {
    const number = await Number.findOne({ _id: id, user: userEmail });

    if (!number) {
      return res
        .status(404)
        .json({ message: "Number not found or access denied" });
    }

    if (req.method === "DELETE") {
      await twilioClient.incomingPhoneNumbers(number.twilioSid).remove();
      await number.deleteOne();
      res.status(200).json({ message: "Number deleted" });
    } else {
      res.status(405).json({ message: "Method not allowed" });
    }
  } catch (error) {
    console.error("Delete number error:", error);
    res.status(500).json({ message: "Failed to delete number" });
  }
}
