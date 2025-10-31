import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import { handleAIResponse } from "@/lib/ai/handleAIResponse";
import mongoose from "mongoose";

/** Safely convert a lead's id (_id | id | string) to a string */
const leadIdString = (lead: any): string => {
  const raw = lead?._id ?? lead?.id;
  return typeof raw === "string" ? raw : raw?.toString?.() ?? "";
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).end("Method not allowed");

  const { Body, From } = req.body as { Body?: string; From?: string };
  if (!Body || !From)
    return res.status(400).json({ message: "Missing message or sender." });

  try {
    if (!mongoose.connection.readyState) {
      await dbConnect();
    }

    // Normalize sender to last 10 digits
    const sanitizedPhone = String(From).replace(/\D/g, "").slice(-10);

    // Match numbers that end with the last 10 digits
    const lead = await Lead.findOne({
      phone: { $regex: sanitizedPhone + "$" },
    });

    if (!lead) {
      console.warn(`No lead found for incoming SMS from ${From}`);
      // Return 200 so Twilio doesn't retry; we just don't know this number.
      return res.status(200).end();
    }

    // If this lead is still in a drip, drop them now
    if ((lead as any).assignedDrip) {
      (lead as any).assignedDrip = null;
      (lead as any).droppedFromDrip = true;
      (lead as any).droppedFromDripAt = new Date();
      await lead.save();
    }

    // Handoff to AI (robust id-to-string)
    await handleAIResponse(leadIdString(lead), Body);

    return res.status(200).end();
  } catch (err) {
    console.error("Error in AI response handler:", err);
    return res.status(500).end("Internal Server Error");
  }
}
