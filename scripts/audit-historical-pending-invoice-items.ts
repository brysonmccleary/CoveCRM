/**
 * Read-only Stripe/Mongo audit for legacy invoice-item billing.
 * Usage: npx tsx scripts/audit-historical-pending-invoice-items.ts --output /tmp/billing-pending-items.csv
 */
import "dotenv/config";
import fs from "fs";
import mongoose from "mongoose";
import { stripe } from "../lib/stripe";

type Row = Record<string, string | number | boolean | null>;

function value(arg: string) {
  const index = process.argv.indexOf(arg);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function csv(value: unknown) {
  const string = value === undefined || value === null ? "" : String(value);
  return `"${string.replace(/"/g, '""')}"`;
}

async function listAll<T>(fetchPage: (startingAfter?: string) => Promise<{ data: T[]; has_more: boolean }>) {
  const output: T[] = [];
  let startingAfter: string | undefined;
  do {
    const page = await fetchPage(startingAfter);
    output.push(...page.data);
    startingAfter = page.has_more && page.data.length ? String((page.data[page.data.length - 1] as any).id) : undefined;
  } while (startingAfter);
  return output;
}

async function main() {
  const outputPath = value("--output") || `/tmp/billing-pending-item-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required");
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const users = await db.collection("users")
    .find({ stripeCustomerId: { $exists: true, $nin: [null, ""] } }, { projection: { email: 1, stripeCustomerId: 1 } })
    .toArray();
  const rows: Row[] = [];

  for (const user of users) {
    const customerId = String((user as any).stripeCustomerId);
    const userEmail = String((user as any).email || "").toLowerCase();
    const pendingItems = await listAll((startingAfter) => stripe.invoiceItems.list({
      customer: customerId,
      pending: true,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    }) as any);
    for (const item of pendingItems as any[]) {
      const billingEventId = String(item?.metadata?.billingEventId || "");
      const event = billingEventId && mongoose.isValidObjectId(billingEventId)
        ? await db.collection("billingevents").findOne({ _id: new mongoose.Types.ObjectId(billingEventId) })
        : null;
      const classifiedDuplicate = !item?.invoice && !!event && event.status === "paid";
      rows.push({
        kind: "pending_invoice_item",
        customerId,
        userEmail,
        stripeInvoiceItemId: item.id,
        stripeInvoiceId: item.invoice ? String(item.invoice) : null,
        amountCents: Number(item.amount || 0),
        currency: String(item.currency || ""),
        billingEventId: billingEventId || null,
        billingEventStatus: event ? String((event as any).status || "") : null,
        classification: classifiedDuplicate ? "already_settled_duplicate_candidate" : "manual_review",
      });
    }

    const invoices = await listAll((startingAfter) => stripe.invoices.list({
      customer: customerId,
      status: "paid",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    }) as any);
    for (const invoice of invoices as any[]) {
      if (Number(invoice.amount_paid || 0) !== 0 || !Object.keys(invoice.metadata || {}).length) continue;
      rows.push({
        kind: "zero_paid_invoice_with_metadata",
        customerId,
        userEmail,
        stripeInvoiceId: invoice.id,
        amountCents: Number(invoice.amount_due || 0),
        currency: String(invoice.currency || ""),
        billingEventId: String(invoice.metadata?.billingEventId || "") || null,
        classification: "manual_review",
      });
    }
  }

  const paidEvents = await db.collection("billingevents").find({
    status: "paid",
    stripeInvoiceItemId: { $exists: true, $nin: [null, ""] },
  }).toArray();
  for (const event of paidEvents) {
    const item = await stripe.invoiceItems.retrieve(String((event as any).stripeInvoiceItemId)).catch(() => null) as any;
    const eventInvoiceId = String((event as any).stripeInvoiceId || "");
    const itemInvoiceId = item?.invoice ? String(item.invoice) : "";
    rows.push({
      kind: "paid_billing_event_legacy_item",
      customerId: String((event as any).stripeCustomerId || ""),
      userEmail: String((event as any).userEmail || ""),
      stripeInvoiceItemId: String((event as any).stripeInvoiceItemId),
      stripeInvoiceId: eventInvoiceId || null,
      actualItemInvoiceId: itemInvoiceId || null,
      amountCents: Number((event as any).amountCents || 0),
      billingEventId: String((event as any)._id),
      classification: !item ? "stripe_item_missing" : !itemInvoiceId ? "unattached_paid_event_item" : itemInvoiceId !== eventInvoiceId ? "item_on_different_invoice" : "attached_matches_event",
    });
  }

  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  fs.writeFileSync(outputPath, [columns.join(","), ...rows.map((row) => columns.map((column) => csv(row[column])).join(","))].join("\n"));
  console.log(JSON.stringify({ readOnly: true, outputPath, rows: rows.length, customers: users.length }, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
