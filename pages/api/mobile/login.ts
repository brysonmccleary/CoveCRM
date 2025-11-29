// pages/api/mobile/login.ts
import type { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";
import { syncA2PForUser } from "@/lib/twilio/syncA2P";
import { sendWelcomeEmail } from "@/lib/email";
import twilio from "twilio";

// ---------- helpers copied from [...nextauth].ts (no changes to web auth) ----------

const isDev =
  process.env.NODE_ENV === "development" ||
  process.env.NEXTAUTH_URL?.includes("localhost") ||
  process.env.NEXTAUTH_URL?.includes("ngrok");

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;
const client = twilio(accountSid, authToken);

// Canonical public base URL (do NOT throw if missing)
function getBaseUrl() {
  const url =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  return url?.replace(/\/+$/, "") || "";
}

// case-insensitive email lookup
function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getUserByEmailCI(email: string) {
  const esc = escapeRegex(email);
  return User.findOne({ email: { $regex: `^${esc}$`, $options: "i" } });
}

/**
 * Create/attach a Twilio Messaging Service, but NEVER let errors break login.
 */
async function ensureMessagingService(userId: string, userEmail: string) {
  try {
    const existing = await A2PProfile.findOne({ userId }).lean();
    if (existing?.messagingServiceSid) return;

    const baseUrl = getBaseUrl();
    if (!baseUrl) {
      console.warn("ensureMessagingService (mobile): missing BASE URL, skipping");
      return;
    }

    const service = await client.messaging.services.create({
      friendlyName: `CoveCRM Service – ${userEmail}`,
      inboundRequestUrl: `${baseUrl}/api/twilio/inbound-sms`,
      statusCallback: `${baseUrl}/api/twilio/status-callback`,
    });

    await A2PProfile.updateOne(
      { userId },
      {
        $setOnInsert: { userId },
        $set: { messagingServiceSid: service.sid },
      },
      { upsert: true, runValidators: false, strict: false }
    );
  } catch (e: any) {
    console.warn("ensureMessagingService (mobile) skipped:", e?.message || String(e));
  }
}

async function safeSyncA2PByEmail(email: string, awaitIt = true) {
  try {
    await mongooseConnect();
    const user = await User.findOne({ email });
    if (!user) return;
    if (awaitIt) await syncA2PForUser(user as any);
    else syncA2PForUser(user as any).catch(() => {});
  } catch (e) {
    console.warn("safeSyncA2PByEmail (mobile) error:", e);
  }
}

// ---------- JWT helper for mobile ----------

const JWT_SECRET =
  process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET || "dev-mobile-secret";

function signMobileToken(payload: any) {
  // short-ish expiration; app can refresh later if needed
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: isDev ? "7d" : "2d",
  });
}

// ---------- API handler ----------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { email: rawEmail, password, affiliateCode } = req.body || {};

    if (!rawEmail || !password) {
      return res
        .status(400)
        .json({ ok: false, error: "Email and password are required" });
    }

    const emailRaw = String(rawEmail).trim();
    const email = emailRaw.toLowerCase();
    const pwd = String(password);

    await mongooseConnect();

    let user = await getUserByEmailCI(emailRaw);
    let isNewUser = false;

    // If user doesn't exist, mirror web behavior: create them + hash password
    if (!user) {
      const hashedPassword = await bcrypt.hash(pwd, 10);

      user = await User.create({
        email,
        password: hashedPassword,
        name: email.split("@")[0],
        role: "user",
        affiliateCode: affiliateCode || null,
        subscriptionStatus: "active",
      });

      isNewUser = true;

      try {
        await sendWelcomeEmail({ to: user.email, name: user.name });
      } catch (e) {
        console.warn("welcome email (mobile credentials) failed:", e);
      }
    } else if (user.email !== email) {
      // normalize casing
      await User.updateOne({ _id: user._id }, { $set: { email } });
      user.email = email;
    }

    const currentHash = ((user as any).password ?? "") as string;
    let isValid = false;

    if (!currentHash) {
      const hashed = await bcrypt.hash(pwd, 10);
      await User.updateOne({ _id: (user as any)._id }, { $set: { password: hashed } });
      isValid = true;
    } else {
      isValid = await bcrypt.compare(pwd, String(currentHash));
    }

    if (!isValid) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    // fire-and-forget side effects (don't block login)
    if (isNewUser) {
      Promise.resolve(
        ensureMessagingService(String((user as any)._id), user.email)
      ).catch(() => {});
    }
    Promise.resolve(safeSyncA2PByEmail(user.email, false)).catch(() => {});

    const publicUser = {
      id: user._id?.toString(),
      email: user.email,
      name: user.name || user.email,
      role: user.role || "user",
      affiliateCode: user.affiliateCode || null,
    };

    const token = signMobileToken({
      sub: publicUser.id,
      email: publicUser.email,
      role: publicUser.role,
    });

    return res.status(200).json({
      ok: true,
      token,
      user: publicUser,
    });
  } catch (err: any) {
    console.error("mobile/login error:", err);
    return res.status(500).json({
      ok: false,
      error: "Internal server error",
    });
  }
}
