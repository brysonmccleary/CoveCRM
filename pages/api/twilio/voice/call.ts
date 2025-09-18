import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import { getUserByEmail } from "@/models/User";
import Call from "@/models/Call";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { DateTime } from "luxon";

/* --- server-side tz helpers --- */
const STATE_TZ: Record<string, string> = {
  AL:"America/Chicago",AK:"America/Anchorage",AZ:"America/Phoenix",AR:"America/Chicago",CA:"America/Los_Angeles",
  CO:"America/Denver",CT:"America/New_York",DC:"America/New_York",DE:"America/New_York",FL:"America/New_York",
  GA:"America/New_York",HI:"Pacific/Honolulu",IA:"America/Chicago",ID:"America/Boise",IL:"America/Chicago",
  IN:"America/Indiana/Indianapolis",KS:"America/Chicago",KY:"America/New_York",LA:"America/Chicago",MA:"America/New_York",
  MD:"America/New_York",ME:"America/New_York",MI:"America/Detroit",MN:"America/Chicago",MO:"America/Chicago",
  MS:"America/Chicago",MT:"America/Denver",NC:"America/New_York",ND:"America/Chicago",NE:"America/Chicago",
  NH:"America/New_York",NJ:"America/New_York",NM:"America/Denver",NV:"America/Los_Angeles",NY:"America/New_York",
  OH:"America/New_York",OK:"America/Chicago",OR:"America/Los_Angeles",PA:"America/New_York",RI:"America/New_York",
  SC:"America/New_York",SD:"America/Chicago",TN:"America/Chicago",TX:"America/Chicago",UT:"America/Denver",
  VA:"America/New_York",VT:"America/New_York",WA:"America/Los_Angeles",WI:"America/Chicago",WV:"America/New_York",WY:"America/Denver",
};
function pick(obj: any, keys: string[]): string {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}
function normalizeState(val?: string): string | null {
  if (!val) return null;
  const s = String(val).trim().toUpperCase();
  if (STATE_TZ[s]) return s;
  const map: Record<string, string> = {
    "ALABAMA":"AL","ALASKA":"AK","ARIZONA":"AZ","ARKANSAS":"AR","CALIFORNIA":"CA","COLORADO":"CO","CONNECTICUT":"CT","DELAWARE":"DE",
    "DISTRICT OF COLUMBIA":"DC","WASHINGTON DC":"DC","FLORIDA":"FL","GEORGIA":"GA","HAWAII":"HI","IDAHO":"ID","ILLINOIS":"IL","INDIANA":"IN",
    "IOWA":"IA","KANSAS":"KS","KENTUCKY":"KY","LOUISIANA":"LA","MAINE":"ME","MARYLAND":"MD","MASSACHUSETTS":"MA","MICHIGAN":"MI","MINNESOTA":"MN",
    "MISSISSIPPI":"MS","MISSOURI":"MO","MONTANA":"MT","NEBRASKA":"NE","NEVADA":"NV","NEW HAMPSHIRE":"NH","NEW JERSEY":"NJ",
    "NEW MEXICO":"NM","NEW YORK":"NY","NORTH CAROLINA":"NC","NORTH DAKOTA":"ND","OHIO":"OH","OKLAHOMA":"OK","OREGON":"OR","PENNSYLVANIA":"PA",
    "RHODE ISLAND":"RI","SOUTH CAROLINA":"SC","SOUTH DAKOTA":"SD","TENNESSEE":"TN","TEXAS":"TX","UTAH":"UT","VERMONT":"VT","VIRGINIA":"VA",
    "WASHINGTON":"WA","WEST VIRGINIA":"WV","WISCONSIN":"WI","WYOMING":"WY"
  };
  const full = map[s] || map[s.replace(/\./g, "")];
  return full || null;
}
function resolveLeadTimezoneServer(lead: any): string | null {
  const explicit = pick(lead, ["timezone","timeZone","tz","ianaTimezone"]);
  if (explicit) return explicit;
  const stateRaw = pick(lead, ["state","State","STATE","st","St","ST"]);
  const abbr = normalizeState(stateRaw);
  if (abbr && STATE_TZ[abbr]) return STATE_TZ[abbr];
  return null;
}
function withinWindow(zone: string, startHour = 8, endHour = 21) {
  const now = DateTime.now().setZone(zone || "UTC");
  const hr = now.hour;
  return hr >= startHour && hr < endHour;
}
/* ------------------------------------------ */

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");
const CALL_AI_SUMMARY_ENABLED = (process.env.CALL_AI_SUMMARY_ENABLED || "").toString() === "1";

function e164(num: string) {
  if (!num) return "";
  const d = num.replace(/\D+/g, "");
  if (!d) return "";
  if (d.startsWith("1") && d.length === 11) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  if (num.startsWith("+")) return num.trim();
  return `+${d}`;
}
function uniq<T>(arr: T[]) { return Array.from(new Set(arr.filter(Boolean))); }

function collectOwnedTwilioNumbers(user: any): string[] {
  const raw: string[] = uniq([
    ...(Array.isArray(user?.numbers) ? user.numbers.map((n: any) => n?.phoneNumber) : []),
    process.env.TWILIO_CALLER_ID || "",
  ]);
  return uniq(raw.map((x) => e164(String(x || ""))));
}

function extractLeadPhones(lead: any): string[] {
  const out: string[] = [];
  const pushIfPhone = (val: any) => {
    if (!val) return;
    if (typeof val === "string") {
      const n = e164(val);
      if (n.length >= 11) out.push(n);
    } else if (Array.isArray(val)) {
      val.forEach(pushIfPhone);
    }
  };

  const priority = [
    "phone","Phone","mobile","Mobile","cell","Cell",
    "workPhone","homePhone","Phone Number","phone_number",
    "primaryPhone","contactNumber"
  ];
  priority.forEach((k) => pushIfPhone(lead?.[k]));

  Object.entries(lead || {}).forEach(([k, v]) => {
    const kl = k.toLowerCase();
    if (kl.includes("phone") || kl.includes("mobile") || kl.includes("cell") || kl.includes("number")) pushIfPhone(v);
  });

  return uniq(out);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  const { leadId, allowSelfDial } = req.body || {};
  if (!leadId) return res.status(400).json({ message: "Missing leadId" });

  await dbConnect();

  const userEmail = String(session.user.email).toLowerCase();
  const user = await getUserByEmail(userEmail);
  if (!user) return res.status(404).json({ message: "User not found" });

  const lead: any = await Lead.findOne({ _id: leadId, userEmail }).lean();
  if (!lead) return res.status(404).json({ message: "Lead not found" });

  // Quiet-hours guard (8am–9pm in lead-local if known)
  const zone = resolveLeadTimezoneServer(lead);
  if (zone && !withinWindow(zone, 8, 21)) {
    const now = DateTime.now().setZone(zone);
    return res.status(423).json({
      message: `Quiet hours: lead local time is ${now.toFormat("ccc L/d @ h:mm a")} ${now.offsetNameShort}`,
      zone,
    });
  }

  const ownedNumbers: any[] = Array.isArray((user as any).numbers) ? (user as any).numbers : [];
  const fromNumber = e164(ownedNumbers?.[0]?.phoneNumber || process.env.TWILIO_CALLER_ID || "");
  if (!fromNumber) return res.status(400).json({ message: "No Twilio number on account (fromNumber)" });

  const ownedDIDs = collectOwnedTwilioNumbers(user);
  const excludedSet = new Set<string>([fromNumber, ...ownedDIDs].map(e164));

  const rawCandidates = extractLeadPhones(lead).map(e164);
  const filtered = rawCandidates.filter((n) => !excludedSet.has(n));

  const allowOverride = Boolean(allowSelfDial) || process.env.ALLOW_SELF_DIAL === "1";

  const finalCandidates = filtered.length > 0 ? filtered : (allowOverride ? rawCandidates : []);
  if (finalCandidates.length === 0) {
    console.warn("🚫 Refusing to dial: all candidate numbers are excluded (Twilio-owned).", {
      leadId, rawCandidates, excluded: Array.from(excludedSet),
    });
    return res.status(422).json({
      message: "Lead has no dialable number (appears to match your Twilio-owned numbers).",
      blockedCandidates: rawCandidates,
    });
  }

  const toLead = finalCandidates.find((n) => n && n !== fromNumber) || finalCandidates[0];
  if (!toLead || toLead === fromNumber) {
    return res.status(422).json({ message: "Resolved lead number is invalid or equals caller ID." });
  }

  const conferenceName = `ds-${leadId}-${Date.now().toString(36)}`;
  const aiActiveForThisUser = Boolean((user as any)?.hasAI) && CALL_AI_SUMMARY_ENABLED;

  try {
    const twimlUrl = `${BASE_URL}/api/voice/lead-join?conferenceName=${encodeURIComponent(conferenceName)}`;

    const createOpts: any = {
      to: toLead,
      from: fromNumber,
      url: twimlUrl,
      statusCallback: `${BASE_URL}/api/twilio/status-callback`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      timeout: 25,
      machineDetection: "DetectMessageEnd",
      amdStatusCallback: `${BASE_URL}/api/twilio/amd-callback`,
      amdStatusCallbackMethod: "POST",
      asyncAmd: "true",
    };

    const { client } = await getClientForUser(userEmail);
    const call = await client.calls.create(createOpts);

    await Call.updateOne(
      { callSid: call.sid },
      {
        $setOnInsert: {
          callSid: call.sid,
          userEmail,
          direction: "outbound",
          startedAt: new Date(),
          aiEnabledAtCallTime: aiActiveForThisUser,
        },
        $set: {
          leadId,
          ownerNumber: fromNumber,
          otherNumber: toLead,
          from: fromNumber,
          to: toLead,
          conferenceName,
        },
      },
      { upsert: true },
    );

    console.log("📞 voice/call placed (conference lead-only)", {
      from: fromNumber, toLead, callSid: call.sid, conferenceName,
    });

    return res.status(200).json({
      success: true,
      callSid: call.sid,
      toLead,
      from: fromNumber,
      conferenceName,
    });
  } catch (err: any) {
    console.error("❌ voice/call error:", err?.message || err);
    return res.status(500).json({ message: "Failed to initiate call", error: err?.message });
  }
}
