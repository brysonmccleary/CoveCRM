import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";
import dbConnect from "@/lib/mongooseConnect";
import A2PProfile, { IA2PProfile, A2PRegistrationStatus } from "@/models/A2PProfile";
import User from "@/models/User";
import { sendA2PApprovedEmail } from "@/lib/email";

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  CRON_SECRET,
  NEXT_PUBLIC_BASE_URL,
  BASE_URL,
} = process.env;

const client =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

type Json = Record<string, unknown>;

function appBase(): string {
  const raw = (NEXT_PUBLIC_BASE_URL || BASE_URL || "").replace(/\/$/, "");
  return raw || ""; // if empty, we still provision but skip webhook update
}

function mapBrandStatus(s?: string): A2PRegistrationStatus | undefined {
  switch ((s || "").toUpperCase()) {
    case "APPROVED": return "brand_approved";
    case "PENDING":
    case "IN_REVIEW": return "brand_submitted";
    case "FAILED":
    case "SUSPENDED":
    case "DELETION_FAILED": return "rejected";
    default: return undefined;
  }
}

function mapCampaignStatus(s?: string): { stage?: A2PRegistrationStatus; ready: boolean } {
  switch ((s || "").toUpperCase()) {
    case "VERIFIED": return { stage: "campaign_approved", ready: true };
    case "PENDING":
    case "IN_PROGRESS": return { stage: "campaign_submitted", ready: false };
    case "FAILED": return { stage: "rejected", ready: false };
    default: return { ready: false };
  }
}

/** Get all E.164 numbers for a user from typical shapes we’ve seen. */
function extractUserNumbers(user: any): string[] {
  const nums: string[] = [];
  const arr = Array.isArray(user?.numbers) ? user.numbers : [];
  for (const n of arr) {
    const v = n?.phoneNumber || n?.value || n?.number;
    if (typeof v === "string" && /^\+?\d{8,20}$/.test(v)) {
      const e164 = v.startsWith("+") ? v : `+${v.replace(/\D/g, "")}`;
      nums.push(e164);
    }
  }
  // Also consider top-level fields some apps store
  if (typeof user?.phone === "string" && user.phone.startsWith("+")) nums.push(user.phone);
  return [...new Set(nums)];
}

/** Find a PN SID by exact phone number (live lookup). */
async function lookupPnSidByNumber(e164: string): Promise<string | null> {
  if (!client) return null;
  const list = await client.incomingPhoneNumbers.list({ phoneNumber: e164, limit: 20 });
  const exact = list.find((p) => p.phoneNumber === e164);
  return exact?.sid || null;
}

/** Ensure a Messaging Service exists for the user; set inbound webhook. */
async function ensureMessagingService(profile: IA2PProfile, user: any): Promise<string | null> {
  if (!client) return null;

  if (profile.messagingServiceSid) {
    // Keep webhook fresh if we know our base URL
    const base = appBase();
    if (base) {
      try {
        await client.messaging.v1.services(profile.messagingServiceSid).update({
          inboundRequestUrl: `${base}/api/twilio/inbound-sms`,
        } as any);
      } catch { /* don’t block on webhook */ }
    }
    return profile.messagingServiceSid;
  }

  try {
    const svc = await client.messaging.v1.services.create({
      friendlyName: `MS for ${user?.email || profile.userId}`,
      // Keep simple; we set webhook below
    } as any);

    const base = appBase();
    if (base) {
      try {
        await client.messaging.v1.services(svc.sid).update({
          inboundRequestUrl: `${base}/api/twilio/inbound-sms`,
        } as any);
      } catch {/* non-fatal */}
    }

    profile.messagingServiceSid = svc.sid;
    return svc.sid;
  } catch (e: any) {
    profile.lastError = `Create MS failed: ${e?.message || String(e)}`;
    return null;
  }
}

/** Link the A2P campaign to the Messaging Service via USA2P compliance object. */
async function ensureUsa2pLinked(msid: string, campaignSid?: string | null): Promise<void> {
  if (!client || !msid || !campaignSid) return;

  // Check existing
  const list: any[] = await (client as any).messaging.v1
    .services(msid)
    .compliance.usa2p.list({ limit: 50 });

  const linked = list.find((r: any) => r?.campaignSid === campaignSid);
  if (linked) return;

  // Try create; if already exists (different resource), swallow 409
  try {
    await (client as any).messaging.v1
      .services(msid)
      .compliance.usa2p.create({ campaignSid });
  } catch (e: any) {
    const m = (e?.message || "").toLowerCase();
    if (!m.includes("already") && !m.includes("exist") && e?.status !== 409) {
      throw e;
    }
  }
}

/** Attach all of the user’s phone numbers to the Messaging Service (idempotent). */
async function ensureNumbersAttached(msid: string, user: any): Promise<void> {
  if (!client || !msid) return;
  const want = extractUserNumbers(user);
  if (!want.length) return;

  // Get already-attached numbers
  const attached = await client.messaging.v1.services(msid).phoneNumbers.list({ limit: 1000 });
  const attachedSet = new Set(attached.map((p) => p.phoneNumberSid));

  for (const e164 of want) {
    try {
      // If we already know the PN SID on the user object, prefer it
      let pnSid: string | null = null;
      const hit = (Array.isArray(user?.numbers) ? user.numbers : []).find(
        (n: any) => n?.sid && (n?.phoneNumber === e164 || n?.value === e164 || n?.number === e164),
      );
      pnSid = hit?.sid || (await lookupPnSidByNumber(e164));
      if (!pnSid) continue;
      if (attachedSet.has(pnSid)) continue;

      await client.messaging.v1.services(msid).phoneNumbers.create({ phoneNumberSid: pnSid });
      attachedSet.add(pnSid);
    } catch (e: any) {
      // If it's a duplicate/409, ignore; otherwise note but don’t throw
      if (e?.status !== 409) {
        // Optional: log somewhere central
      }
    }
  }
}

/** Poll Twilio brand/campaign status; update profile fields. */
async function refreshStatus(profile: IA2PProfile): Promise<{ changed: boolean; approvedNow: boolean; details: Json }> {
  let changed = false;
  let approvedNow = false;
  const details: Json = {};

  // BRAND
  if (client && profile.brandSid) {
    try {
      const brand: any = await (client as any).messaging.v1.brandRegistrations(profile.brandSid).fetch();
      const newStage = mapBrandStatus(brand?.status);
      details.brandStatus = brand?.status;
      if (newStage && newStage !== profile.registrationStatus) {
        profile.approvalHistory = profile.approvalHistory || [];
        profile.approvalHistory.push({ stage: newStage, at: new Date(), note: "Brand status update" });
        profile.registrationStatus = newStage;
        changed = true;
      }
    } catch (e: any) {
      profile.lastError = `Brand fetch failed: ${e?.message || String(e)}`; changed = true;
    }
  }

  // CAMPAIGN via USA2P listing on the service (if we have one)
  if (client && profile.messagingServiceSid) {
    try {
      const list: any[] = await (client as any).messaging.v1
        .services(profile.messagingServiceSid)
        .compliance.usa2p.list({ limit: 20 });

      const row =
        (profile.campaignSid && list.find((r: any) => r?.campaignSid === profile.campaignSid)) ||
        list[0];

      if (row) {
        details.campaignStatus = row.campaignStatus;
        details.campaignSid = row.campaignSid;
        if (!profile.campaignSid && row.campaignSid) { profile.campaignSid = row.campaignSid; changed = true; }

        const mapped = mapCampaignStatus(row.campaignStatus);
        if (mapped.stage && mapped.stage !== profile.registrationStatus) {
          profile.approvalHistory = profile.approvalHistory || [];
          profile.approvalHistory.push({ stage: mapped.stage, at: new Date(), note: "Campaign status update" });
          profile.registrationStatus = mapped.stage;
          changed = true;
        }
        if (mapped.ready && !profile.messagingReady) {
          profile.messagingReady = true;
          if (profile.registrationStatus !== "ready") {
            profile.approvalHistory = profile.approvalHistory || [];
            profile.approvalHistory.push({ stage: "ready", at: new Date(), note: "A2P verified & wired" });
            profile.registrationStatus = "ready";
          }
          changed = true;
          approvedNow = true;
        }
      }
    } catch (e: any) {
      profile.lastError = `Campaign fetch failed: ${e?.message || String(e)}`; changed = true;
    }
  }

  return { changed, approvedNow, details };
}

/** Full provisioning for a user when campaign gets approved (idempotent). */
async function provisionForUser(profile: IA2PProfile): Promise<void> {
  if (!client) return;

  const user = await User.findById(profile.userId).lean();
  if (!user?._id) return;

  // 1) Ensure Messaging Service (create if needed) + webhook
  const msid = await ensureMessagingService(profile, user);
  if (!msid) return;

  // 2) Link the verified A2P campaign (if known) to the MS
  if (profile.campaignSid) {
    try { await ensureUsa2pLinked(msid, profile.campaignSid); }
    catch (e) { /* keep going; status poll will surface failures */ }
  }

  // 3) Attach all owned numbers (if any)
  try { await ensureNumbersAttached(msid, user); }
  catch { /* non-fatal */ }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Protect cron
    if (CRON_SECRET) {
      const token = (req.query.token || req.headers["x-cron-token"]) as string | undefined;
      if (token !== CRON_SECRET) return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    if (!client) return res.status(500).json({ ok: false, error: "Twilio credentials not configured" });

    await dbConnect();

    // Profiles that aren’t fully ready, or had errors recently
    const profiles = await A2PProfile.find({
      $or: [
        { registrationStatus: { $ne: "ready" } },
        { messagingReady: { $ne: true } },
        { lastError: { $exists: true, $ne: "" } },
      ],
    });

    let updated = 0;
    let approved = 0;
    let provisioned = 0;
    const results: Json[] = [];

    for (const profile of profiles) {
      const beforeReady = !!profile.messagingReady;

      // Ensure service + linking + numbers (safe to run any time)
      try {
        await provisionForUser(profile as IA2PProfile);
        provisioned++;
      } catch (e: any) {
        profile.lastError = `Provisioning failed: ${e?.message || String(e)}`;
      }

      // Refresh status after provisioning attempt
      const { changed, approvedNow, details } = await refreshStatus(profile as IA2PProfile);

      if (changed) { await profile.save(); updated++; }

      // Notify once when it flips to ready
      if (approvedNow && !beforeReady) {
        const user = await User.findById(profile.userId).lean();
        if (user?.email) {
          try {
            await sendA2PApprovedEmail({ to: user.email, name: user.name || user.firstName || undefined });
            approved++;
          } catch { /* ignore email failure */ }
        }
      }

      results.push({
        userId: profile.userId,
        registrationStatus: profile.registrationStatus,
        messagingReady: profile.messagingReady,
        messagingServiceSid: profile.messagingServiceSid,
        campaignSid: profile.campaignSid,
        lastError: profile.lastError || undefined,
        details,
      });
    }

    return res.status(200).json({ ok: true, checked: profiles.length, updated, approved, provisioned, results });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "check-a2p failed" });
  }
}
