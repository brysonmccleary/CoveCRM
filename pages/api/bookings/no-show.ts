// pages/api/bookings/no-show.ts
// POST — mark a booking as a no-show
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import Booking from "@/models/Booking";
import Lead from "@/models/Lead";
import { recordLeadOutcome } from "@/lib/analytics/recordLeadOutcome";

function last10(phone: string) {
  return String(phone || "").replace(/\D/g, "").slice(-10);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  const { bookingId, reengagementDripId } = req.body as {
    bookingId?: string;
    reengagementDripId?: string;
  };

  if (!bookingId) return res.status(400).json({ error: "bookingId required" });

  const booking = await Booking.findOneAndUpdate(
    { _id: bookingId, agentEmail: session.user.email },
    {
      $set: {
        noShow: true,
        noShowMarkedAt: new Date(),
        ...(reengagementDripId && { reengagementDripId }),
      },
    },
    { new: true }
  );

  if (!booking) return res.status(404).json({ error: "Booking not found" });

  try {
    const userEmail = session.user.email.toLowerCase();
    const bookingAny = booking as any;
    let lead: any = bookingAny.leadId
      ? await Lead.findOne({ _id: bookingAny.leadId, userEmail }).select("_id").lean()
      : null;
    if (!lead) {
      const phoneLast10 = last10(bookingAny.leadPhone || "");
      const leadEmail = String(bookingAny.leadEmail || "").trim();
      const matchers = [
        ...(phoneLast10
          ? [
              { phone: { $regex: phoneLast10 } },
              { Phone: { $regex: phoneLast10 } },
            ]
          : []),
        ...(leadEmail
          ? [
              { email: { $regex: `^${leadEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } },
              { Email: { $regex: `^${leadEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } },
            ]
          : []),
      ];
      lead = matchers.length
        ? await Lead.findOne({ userEmail, $or: matchers }).select("_id").lean()
        : null;
    }
    const leadDoc = lead;

    if (leadDoc?._id) {
      recordLeadOutcome({
        leadId: String(leadDoc._id),
        userEmail,
        rawDisposition: "no_show",
        source: "calendar_no_show",
        metadata: {
          bookingId: String(booking._id),
          appointmentTime: bookingAny.date || null,
        },
      }).catch((err) => {
        console.warn("[bookings/no-show] outcome event failed (non-fatal):", err?.message || err);
      });
    }
  } catch (err: any) {
    console.warn("[bookings/no-show] outcome lookup failed (non-fatal):", err?.message || err);
  }

  return res.status(200).json({ ok: true, booking });
}
