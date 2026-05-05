// scripts/a2p-audit.ts
// READ-ONLY audit: checks which user numbers are (or are not) attached to their Messaging Service.
// No writes. No mutations. Print-only.
//
// Usage:
//   npx tsx scripts/a2p-audit.ts

import "dotenv/config";
import twilio from "twilio";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

function normalize(p: string): string {
  const digits = (p || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return (p || "").startsWith("+") ? p : `+${digits}`;
}

async function main() {
  await dbConnect();

  const accountSid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = (process.env.TWILIO_AUTH_TOKEN || "").trim();

  if (!accountSid || !authToken) {
    console.error("ERROR: TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set.");
    process.exit(1);
  }

  const client = twilio(accountSid, authToken, { accountSid });

  // --- Prefetch: all incoming phone numbers under this account ---
  console.log("Fetching all incoming phone numbers from Twilio...");
  const allTwilioNumbers = await client.incomingPhoneNumbers.list({ limit: 1000 });
  const twilioNumberSet = new Set(
    allTwilioNumbers.map((n) => normalize(n.phoneNumber))
  );
  console.log(`  Found ${twilioNumberSet.size} numbers in Twilio account.\n`);

  // --- Prefetch: service → Set<phoneNumber> (cached per unique service SID) ---
  const serviceNumberCache = new Map<string, Set<string>>();

  async function getServiceNumbers(mgSid: string): Promise<Set<string>> {
    if (serviceNumberCache.has(mgSid)) return serviceNumberCache.get(mgSid)!;
    try {
      const nums = await client.messaging.v1.services(mgSid).phoneNumbers.list({ limit: 200 });
      const set = new Set(nums.map((n) => normalize(n.phoneNumber)));
      serviceNumberCache.set(mgSid, set);
      return set;
    } catch {
      // Service SID not found or inaccessible
      serviceNumberCache.set(mgSid, new Set());
      return new Set();
    }
  }

  // --- Load all users that have at least one number ---
  const users = await User.find(
    { "numbers.0": { $exists: true } },
    { email: 1, "a2p.messagingServiceSid": 1, numbers: 1 }
  ).lean<any[]>();

  console.log(`Auditing ${users.length} users with at least one number...\n`);
  console.log("=".repeat(72));

  let totalOk = 0;
  let totalMissingOnService = 0;
  let totalNotFound = 0;
  let totalNoService = 0;

  for (const user of users) {
    const email: string = user.email || "(unknown)";
    const mgSid: string = String(user?.a2p?.messagingServiceSid || "").trim();
    const numbers: any[] = Array.isArray(user.numbers) ? user.numbers : [];

    if (!numbers.length) continue;

    console.log(`\nUSER: ${email}`);

    if (!mgSid) {
      for (const entry of numbers) {
        const phone = normalize(String(entry?.phoneNumber || ""));
        if (!phone) continue;
        console.log(`  NUMBER: ${phone}`);
        console.log(`  STATUS: NO_SERVICE`);
        totalNoService++;
      }
      continue;
    }

    console.log(`SERVICE: ${mgSid}`);

    const serviceNums = await getServiceNumbers(mgSid);

    for (const entry of numbers) {
      const phone = normalize(String(entry?.phoneNumber || ""));
      if (!phone) continue;

      console.log(`  NUMBER: ${phone}`);

      if (!twilioNumberSet.has(phone)) {
        console.log(`  STATUS: NUMBER_NOT_FOUND`);
        totalNotFound++;
      } else if (serviceNums.has(phone)) {
        console.log(`  STATUS: OK`);
        totalOk++;
      } else {
        console.log(`  STATUS: MISSING_ON_SERVICE`);
        totalMissingOnService++;
      }
    }
  }

  console.log("\n" + "=".repeat(72));
  console.log("AUDIT SUMMARY");
  console.log(`  OK:                 ${totalOk}`);
  console.log(`  MISSING_ON_SERVICE: ${totalMissingOnService}`);
  console.log(`  NUMBER_NOT_FOUND:   ${totalNotFound}`);
  console.log(`  NO_SERVICE:         ${totalNoService}`);
  console.log("=".repeat(72));

  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e?.message || e);
  process.exit(1);
});
