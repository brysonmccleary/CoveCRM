// scripts/repair-user-email-cascade.ts
// One-time repair: cascades an email change that already happened to all internal
// ownership fields, Stripe customer email, and Twilio friendly names.
//
// Usage:
//   OLD_EMAIL=old@example.com NEW_EMAIL=new@example.com npx tsx scripts/repair-user-email-cascade.ts
//
// Dry-run (no writes):
//   DRY_RUN=1 OLD_EMAIL=old@example.com NEW_EMAIL=new@example.com npx tsx scripts/repair-user-email-cascade.ts

import "dotenv/config";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";
import { assertStripeWritesEnabled } from "@/lib/billing/assertStripeWritesEnabled";
import { getPlatformTwilioClient } from "@/lib/twilio/getPlatformClient";
import { cascadeEmailUpdateMany, type CascadeResult } from "@/lib/cascadeEmailUpdate";

const OLD_EMAIL = (process.env.OLD_EMAIL || "").trim().toLowerCase();
const NEW_EMAIL = (process.env.NEW_EMAIL || "").trim().toLowerCase();
const DRY_RUN = process.env.DRY_RUN === "1";

function print(msg: string) {
  process.stdout.write(msg + "\n");
}

function printTable(results: CascadeResult[]) {
  const touched = results.filter((r) => r.matched > 0 || r.error);
  if (!touched.length) {
    print("  (no matched records in any collection)");
    return;
  }
  const width = Math.max(...touched.map((r) => r.model.length), 20);
  print(`  ${"Model".padEnd(width)}  matched  modified  error`);
  print(`  ${"─".repeat(width)}  ───────  ────────  ─────`);
  for (const r of touched) {
    print(
      `  ${r.model.padEnd(width)}  ${String(r.matched).padStart(7)}  ${String(r.modified).padStart(8)}  ${r.error || ""}`,
    );
  }
}

async function main() {
  if (!OLD_EMAIL || !NEW_EMAIL) {
    print("ERROR: OLD_EMAIL and NEW_EMAIL environment variables are required.");
    print("Usage: OLD_EMAIL=old@example.com NEW_EMAIL=new@example.com npx tsx scripts/repair-user-email-cascade.ts");
    process.exit(1);
  }

  if (OLD_EMAIL === NEW_EMAIL) {
    print("ERROR: OLD_EMAIL and NEW_EMAIL are the same.");
    process.exit(1);
  }

  print(`\n${"═".repeat(60)}`);
  print(`  Email Cascade Repair`);
  print(`  OLD: ${OLD_EMAIL}`);
  print(`  NEW: ${NEW_EMAIL}`);
  print(`  DRY_RUN: ${DRY_RUN}`);
  print(`${"═".repeat(60)}\n`);

  await dbConnect();

  // ── Verify both accounts ─────────────────────────────────────────────────
  const newUser = await User.findOne({ email: NEW_EMAIL }).lean<any>();
  const oldUser = await User.findOne({ email: OLD_EMAIL }).lean<any>();

  print("── User document check ────────────────────────────────────────");
  if (newUser) {
    print(`  ✓ User with NEW email found: _id=${newUser._id}`);
  } else {
    print(`  ✗ No user found with NEW email: ${NEW_EMAIL}`);
  }
  if (oldUser) {
    print(`  ⚠ User with OLD email still exists: _id=${oldUser._id} — this suggests the User.email was NOT updated`);
    print(`    Run update-email endpoint first, or set DRY_RUN=0 to update User.email here.`);
  } else {
    print(`  ✓ No stale user document with OLD email (good)`);
  }

  const targetUser = newUser || oldUser;
  if (!targetUser) {
    print("\nERROR: Cannot find any user for either email. Aborting.");
    process.exit(1);
  }

  // ── MongoDB cascade ──────────────────────────────────────────────────────
  print("\n── MongoDB cascade ────────────────────────────────────────────");
  if (DRY_RUN) {
    print("  DRY_RUN=1 — skipping all writes\n");
  } else {
    const results = await cascadeEmailUpdateMany(OLD_EMAIL, NEW_EMAIL);
    printTable(results);
    const errors = results.filter((r) => r.error);
    if (errors.length) {
      print(`\n  ⚠ ${errors.length} collection(s) failed — see above`);
    } else {
      const totalModified = results.reduce((s, r) => s + r.modified, 0);
      print(`\n  ✓ ${totalModified} document(s) modified across ${results.filter((r) => r.matched > 0).length} collection(s)`);
    }
  }

  // ── User.email fix (if User.email still has old email) ───────────────────
  if (oldUser && !DRY_RUN) {
    print("\n── Fixing User.email ──────────────────────────────────────────");
    const conflictNew = await User.findOne({ email: NEW_EMAIL }).lean();
    if (conflictNew) {
      print(`  ⚠ Skipped: a user with ${NEW_EMAIL} already exists (_id=${(conflictNew as any)._id})`);
    } else {
      await User.updateOne(
        { _id: oldUser._id },
        {
          $set: { email: NEW_EMAIL },
          $push: { previousEmails: OLD_EMAIL },
        },
      );
      print(`  ✓ User.email updated to ${NEW_EMAIL}`);
    }
  }

  // ── Stripe ───────────────────────────────────────────────────────────────
  print("\n── Stripe ─────────────────────────────────────────────────────");
  const stripeCustomerId = targetUser.stripeCustomerId;
  if (!stripeCustomerId) {
    print("  — no stripeCustomerId, skipping");
  } else if (DRY_RUN) {
    print(`  DRY_RUN — would update customer ${stripeCustomerId} email → ${NEW_EMAIL}`);
  } else {
    try {
      assertStripeWritesEnabled();
      const customer = await stripe.customers.update(stripeCustomerId, {
        email: NEW_EMAIL,
      });
      print(`  ✓ Stripe customer ${customer.id} email updated to ${NEW_EMAIL}`);
    } catch (e: any) {
      print(`  ✗ Stripe update failed: ${e?.message || String(e)}`);
    }
  }

  // ── Twilio subaccount friendlyName ───────────────────────────────────────
  print("\n── Twilio subaccount friendlyName ─────────────────────────────");
  const subaccountSid = targetUser.twilio?.accountSid;
  if (!subaccountSid) {
    print("  — no twilio.accountSid, skipping");
  } else if (DRY_RUN) {
    print(`  DRY_RUN — would rename subaccount ${subaccountSid} → "CoveCRM - ${NEW_EMAIL}"`);
  } else {
    try {
      const master = getPlatformTwilioClient();
      await (master as any).api.accounts(subaccountSid).update({
        friendlyName: `CoveCRM - ${NEW_EMAIL}`,
      });
      print(`  ✓ Subaccount ${subaccountSid} renamed to "CoveCRM - ${NEW_EMAIL}"`);
    } catch (e: any) {
      print(`  ✗ Subaccount rename failed: ${e?.message || String(e)}`);
    }
  }

  // ── Twilio messaging service friendlyName ────────────────────────────────
  print("\n── Twilio messaging service friendlyName ──────────────────────");
  const messagingServiceSid = targetUser.a2p?.messagingServiceSid;
  if (!messagingServiceSid) {
    print("  — no a2p.messagingServiceSid, skipping");
  } else if (!subaccountSid) {
    print("  — cannot resolve Twilio client (no subaccountSid), skipping");
  } else if (DRY_RUN) {
    print(`  DRY_RUN — would rename messaging service ${messagingServiceSid} → "CoveCRM - ${NEW_EMAIL}"`);
  } else {
    try {
      const { getPlatformTwilioClientScoped } = await import("@/lib/twilio/getPlatformClient");
      const subClient = getPlatformTwilioClientScoped(subaccountSid);
      await (subClient as any).messaging.v1
        .services(messagingServiceSid)
        .update({ friendlyName: `CoveCRM - ${NEW_EMAIL}` });
      print(`  ✓ Messaging service ${messagingServiceSid} renamed to "CoveCRM - ${NEW_EMAIL}"`);
    } catch (e: any) {
      print(`  ✗ Messaging service rename failed: ${e?.message || String(e)}`);
    }
  }

  // ── A2P business-contact note ─────────────────────────────────────────────
  print("\n── A2P business contact email ──────────────────────────────────");
  print("  NOTE: A2PProfile.email (Twilio-registered business contact) is NOT updated automatically.");
  print("  If A2P is approved, do not resubmit — Twilio may reset review status.");
  print("  If A2P is pending/failed, update A2PProfile.email manually and resubmit via /api/a2p/start.");

  print(`\n${"═".repeat(60)}`);
  print("  Repair complete.");
  print(`${"═".repeat(60)}\n`);

  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
