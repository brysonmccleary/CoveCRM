import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Conversation from "@/models/Conversation";
import { ObjectId } from "mongodb";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const session = await getServerSession(req, res, authOptions);

    if (!session?.user?.email) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const userEmail = session.user.email;
    const { leadId } = req.query;

    if (!leadId) {
      return res.status(400).json({ message: "Missing leadId" });
    }

    await dbConnect();
    const conversations = await Conversation.find({
      leadId: new ObjectId(leadId as string),
      user: userEmail,
    }).sort({ createdAt: 1 }); // optional: order oldest → newest

    res.status(200).json(conversations);
  } catch (error) {
    console.error("Get conversations error:", error);
    res.status(500).json({ message: "Failed to fetch conversations" });
  }
}
