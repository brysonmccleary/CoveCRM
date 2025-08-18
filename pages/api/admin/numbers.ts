// pages/api/admin/numbers.ts

import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";

type Usage = {
  callsMade: number;
  callsReceived: number;
  textsSent: number;
  textsReceived: number;
  cost: number;
};

type Row = {
  userEmail: string;
  phoneNumber: string;
  status: string;
  nextBillingDate: string | null;
  usage: Usage;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") return res.status(405).end("Method Not Allowed");

  try {
    await dbConnect();
    const users = await User.find().lean();

    const rows = await Promise.all<Row>(
      (users || []).flatMap((user: any) => {
        const numbers: any[] = Array.isArray(user?.numbers) ? user.numbers : [];
        return numbers.map(async (num: any) => {
          let status: string = "unknown";
          let nextBillingDate: string | null = null;

          if (num?.subscriptionId) {
            try {
              // stripe-node v16 returns Stripe.Response<T> (with .data); older returns T
              const resp = await stripe.subscriptions.retrieve(
                String(num.subscriptionId),
              );
              const sub: any = (resp as any)?.data ?? resp;

              status = String(sub?.status ?? "unknown");
              nextBillingDate = sub?.current_period_end
                ? new Date(sub.current_period_end * 1000).toISOString()
                : null;
            } catch (err) {
              console.warn(
                `⚠️ Stripe sub fetch failed for ${num.subscriptionId}`,
              );
            }
          }

          const usage: Usage = {
            callsMade: Number(num?.usage?.callsMade || 0),
            callsReceived: Number(num?.usage?.callsReceived || 0),
            textsSent: Number(num?.usage?.textsSent || 0),
            textsReceived: Number(num?.usage?.textsReceived || 0),
            cost: Number(num?.usage?.cost || 0),
          };

          return {
            userEmail: String(user?.email || "").toLowerCase(),
            phoneNumber: String(num?.phoneNumber || ""),
            status,
            nextBillingDate,
            usage,
          };
        });
      }),
    );

    rows.sort((a, b) => a.userEmail.localeCompare(b.userEmail));
    res.status(200).json({ numbers: rows });
  } catch (err) {
    console.error("❌ Admin numbers error:", err);
    res.status(500).end("Server error");
  }
}
