// /pages/api/register.ts
import type { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcrypt"; // ✅ use bcrypt (already used in NextAuth)
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import PromoUsage from "@/models/PromoUsage";
import { sendWelcomeEmail } from "@/lib/email";

type RegisterBody = {
  name: string;
  email: string;
  password: string;
  usedCode?: string;
  affiliateEmail?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  const { name, email, password, usedCode, affiliateEmail } =
    req.body as RegisterBody;
  if (!name || !email || !password) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    await dbConnect();

    const normalizedEmail = String(email).toLowerCase().trim();
    const normalizedCode = usedCode?.trim().toLowerCase() || null;
    const normalizedAffiliate = affiliateEmail?.trim().toLowerCase() || null;

    const existing = await User.findOne({ email: normalizedEmail });
    if (existing)
      return res.status(409).json({ message: "Email already in use" });

    const hashed = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      name,
      email: normalizedEmail,
      password: hashed,
      referredBy: normalizedCode,
      affiliateCode: normalizedAffiliate,
      // other defaults come from the model
    });

    // Track referral usage if a code was used
    if (normalizedCode) {
      await PromoUsage.updateOne(
        { code: normalizedCode },
        {
          $addToSet: { users: normalizedEmail },
          $set: { lastUsed: new Date() },
        },
        { upsert: true },
      );
    }

    // Fire-and-log welcome email; don’t block signup on failure
    try {
      const r = await sendWelcomeEmail({ to: normalizedEmail, name });
      if (!r.ok) console.warn("[signup] welcome email failed:", r.error);
      else console.log("[signup] welcome email sent id:", r.id);
    } catch (e: any) {
      console.warn("[signup] welcome email error:", e?.message || e);
    }

    return res
      .status(200)
      .json({ message: "User created", userId: newUser._id });
  } catch (err) {
    console.error("Registration error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}
