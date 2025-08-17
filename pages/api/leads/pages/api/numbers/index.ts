import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongodb";
import Number from "@/models/Number"; // Your number model

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await dbConnect();

  const userEmail = session.user.email;

  if (req.method === "GET") {
    try {
      const numbers = await Number.find({ user: userEmail });
      res.status(200).json(numbers);
    } catch (error) {
      console.error("Get numbers error:", error);
      res.status(500).json({ message: "Failed to fetch numbers" });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
}
