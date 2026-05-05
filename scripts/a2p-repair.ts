// scripts/a2p-repair.ts
// ONE-TIME repair: attach all existing user numbers to their Messaging Service
// in the SAME Twilio account the number lives in (subaccount or master).
//
// Rules:
//   - Reads user.a2p.messagingServiceSid — skips users with none
//   - Uses getClientForUser() so each user gets the correct Twilio client
//   - Never moves numbers between accounts
//   - Skips numbers not found in that client's account
//   - Only writes to Twilio (attach); no DB modifications
//
// Usage:
//   npx tsx scripts/a2p-repair.ts [--dry-run]

import "dotenv/config";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

const DRY_RUN = process.argv.includes("--dry-run");
const ONLY_EMAIL = (process.env.ONLY_EMAIL || "").toLowerCase().trim();

function normalize(p: string): string {
  const digits = (p || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return (p || "").startsWith("+") ? p : `+${digits}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (DRY_RUN) console.log("[DRY RUN] No Twilio writes will be made.\n");
  if (ONLY_EMAIL) console.log(`[FILTER] Processing only: ${ONLY_EMAIL}\n`);

  await dbConnect();

  const emailFilter = ONLY_EMAIL ? { email: ONLY_EMAIL } : {};

  const users = await User.find(
    {
      ...emailFilter,
      "numbers.0": { $exists: true },
      "a2p.messagingServiceSid": { $exists: true, $ne: "" },
    },
    {
      email: 1,
      "a2p.messagingServiceSid": 1,
      "a2p.messagingReady": 1,
      numbers: 1,
    },
  ).lean<any[]>();

  console.log(`Found ${users.length} users with numbers + a2p.messagingServiceSid.\n`);
  console.log("=".repeat(72));

  let totalAttached = 0;
  let totalAlreadyAttached = 0;
  let totalNotFound = 0;
  let totalNoService = 0;
  let totalErrors = 0;

  for (const user of users) {
    const email: string = user.email || "(unknown)";
    const mgSid: string = String(user?.a2p?.messagingServiceSid || "").trim();
    const numbers: any[] = Array.isArray(user.numbers) ? user.numbers : [];

    console.log(`\nUSER: ${email}`);

    if (!mgSid) {
      console.log(`  STATUS: NO_SERVICE`);
      for (const entry of numbers) {
        const phone = normalize(String(entry?.phoneNumber || ""));
        if (!phone) continue;
        console.log(`  NUMBER: ${phone}  ACTION: NO_SERVICE`);
        totalNoService++;
      }
      continue;
    }

    console.log(`SERVICE: ${mgSid}`);

    // Resolve Twilio client scoped to this user's account
    let client: any;
    let accountSid: string;
    try {
      const resolved = await getClientForUser(email);
      client = resolved.client;
      accountSid = resolved.accountSid;
    } catch (e: any) {
      console.warn(`  ERROR resolving client: ${e?.message || e}`);
      totalErrors++;
      continue;
    }

    console.log(`ACCOUNT: ${accountSid}`);

    // Fetch numbers already attached to this Messaging Service (cache per script run)
    let serviceNumberSids: Set<string>;
    try {
      const attached = await client.messaging.v1
        .services(mgSid)
        .phoneNumbers.list({ limit: 200 });
      serviceNumberSids = new Set(attached.map((n: any) => String(n.sid)));
    } catch (e: any) {
      console.warn(`  ERROR fetching service numbers: ${e?.message || e}`);
      totalErrors++;
      continue;
    }

    for (const entry of numbers) {
      const phone = normalize(String(entry?.phoneNumber || ""));
      const sid: string = String(entry?.sid || "").trim();

      if (!phone) continue;

      console.log(`  NUMBER: ${phone}`);

      if (!sid) {
        console.log(`  ACTION: NOT_FOUND_IN_ACCOUNT (no sid stored)`);
        totalNotFound++;
        continue;
      }

      // Verify the number SID actually exists in this account
      let existsInAccount = false;
      try {
        const matches = await client.incomingPhoneNumbers.list({
          phoneNumber: phone,
          limit: 1,
        });
        existsInAccount = Array.isArray(matches) && matches.length > 0;
        // small delay to avoid rate limiting
        await sleep(120);
      } catch (e: any) {
        console.warn(`  ACTION: ERROR verifying number — ${e?.message || e}`);
        totalErrors++;
        continue;
      }

      if (!existsInAccount) {
        console.log(`  ACTION: NOT_FOUND_IN_ACCOUNT`);
        totalNotFound++;
        continue;
      }

      if (serviceNumberSids.has(sid)) {
        console.log(`  ACTION: ALREADY_ATTACHED`);
        totalAlreadyAttached++;
        continue;
      }

      // Attach
      if (DRY_RUN) {
        console.log(`  ACTION: ATTACHED (dry-run — skipped actual write)`);
        totalAttached++;
        continue;
      }

      try {
        await client.messaging.v1.services(mgSid).phoneNumbers.create({
          phoneNumberSid: sid,
        });
        // Add to local cache so duplicate entries in user.numbers don't re-attach
        serviceNumberSids.add(sid);
        console.log(`  ACTION: ATTACHED`);
        totalAttached++;
        await sleep(250);
      } catch (e: any) {
        // 21710 = already in this service, 21712 = already in another service
        if (e?.code === 21710) {
          console.log(`  ACTION: ALREADY_ATTACHED (Twilio 21710)`);
          totalAlreadyAttached++;
        } else if (e?.code === 21712) {
          console.warn(
            `  ACTION: ERROR — number is in a different service (21712). Manual move required.`,
          );
          totalErrors++;
        } else {
          console.warn(`  ACTION: ERROR attaching — ${e?.message || e} (code ${e?.code ?? "?"})`);
          totalErrors++;
        }
      }
    }

    // Brief pause between users to avoid bursting Twilio rate limits
    await sleep(300);
  }

  console.log("\n" + "=".repeat(72));
  console.log("REPAIR SUMMARY");
  console.log(`  ATTACHED:          ${totalAttached}${DRY_RUN ? " (dry-run)" : ""}`);
  console.log(`  ALREADY_ATTACHED:  ${totalAlreadyAttached}`);
  console.log(`  NOT_FOUND:         ${totalNotFound}`);
  console.log(`  NO_SERVICE:        ${totalNoService}`);
  console.log(`  ERRORS:            ${totalErrors}`);
  console.log("=".repeat(72));

  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e?.message || e);
  process.exit(1);
});
