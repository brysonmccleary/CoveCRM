import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongodb";
import Number from "@/models/Number";
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

  if (req.method === "POST") {
    try {
      const { areaCode } = req.body;

      const availableNumbers = await twilioClient
        .availablePhoneNumbers("US")
        .local.list({
          areaCode,
          limit: 1,
        });

      if (availableNumbers.length === 0) {
        return res
          .status(404)
          .json({ message: "No numbers available for this area code" });
      }

      const purchasedNumber = await twilioClient.incomingPhoneNumbers.create({
        phoneNumber: availableNumbers[0].phoneNumber,
      });

      const newNumber = new Number({
        phoneNumber: purchasedNumber.phoneNumber,
        friendlyName: purchasedNumber.friendlyName,
        twilioSid: purchasedNumber.sid,
        user: userEmail,
      });

      await newNumber.save();

      res.status(201).json(newNumber);
    } catch (error) {
      console.error("Buy number error:", error);
      res.status(500).json({ message: "Failed to buy number" });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
}
