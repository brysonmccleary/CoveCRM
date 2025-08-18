import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import { handleAIResponse } from "@/lib/ai/handleairesponse";
import mongoose from "mongoose";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).end("Method not allowed");

  const { Body, From } = req.body;
  if (!Body || !From)
    return res.status(400).json({ message: "Missing message or sender." });

  try {
    if (!mongoose.connection.readyState) {
      await dbConnect();
    }

    const sanitizedPhone = From.replace(/\D/g, "").slice(-10); // Extract last 10 digits
    const lead = await Lead.findOne({
      phone: { $regex: sanitizedPhone + "$" },
    });

    if (!lead) {
      console.warn(`No lead found for incoming SMS from ${From}`);
      return res.status(200).end(); // Exit silently to avoid Twilio retries
    }

    // Drop from drip if they're still in one
    if (lead.assignedDrip) {
      lead.assignedDrip = null;
      lead.droppedFromDrip = true;
      lead.droppedFromDripAt = new Date();
      await lead.save();
    }

    // Now hand off to AI
    await handleAIResponse(lead._id.toString(), Body);

    return res.status(200).end();
  } catch (err) {
    console.error("Error in AI response handler:", err);
    return res.status(500).end("Internal Server Error");
  }
}
