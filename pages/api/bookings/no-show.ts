// pages/api/bookings/no-show.ts
// POST — mark a booking as a no-show
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import Booking from "@/models/Booking";

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

  return res.status(200).json({ ok: true, booking });
}
