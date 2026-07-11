import BillingEvent, { type BillingEventSource } from "@/models/BillingEvent";
import { stripe } from "@/lib/stripe";
import { assertStripeWritesEnabled } from "@/lib/billing/assertStripeWritesEnabled";

export type ThresholdBucket = "regular" | "ai_voice" | "a2p";

type SettleStandaloneInvoiceParams = {
  customerId: string;
  amountCents: number;
  description: string;
  source: BillingEventSource;
  sourceId: string;
  userEmail?: string;
  userId?: string;
  bucket: ThresholdBucket;
  metadata?: Record<string, unknown>;
};

function metadata(values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value).slice(0, 500)]),
  );
}

function id(value: unknown): string {
  return typeof value === "string" ? value : String((value as any)?.id || "");
}

async function validateInvoice(args: {
  invoice: any;
  invoiceId: string;
  invoiceItemId: string;
  eventId: string;
  customerId: string;
  amountCents: number;
  bucket: ThresholdBucket;
  paid: boolean;
}) {
  const { invoice, invoiceId, invoiceItemId, eventId, customerId, amountCents, bucket, paid } = args;
  const lines = await stripe.invoices.listLineItems(invoiceId, { limit: 100 });
  const items = (lines as any)?.data || [];
  const expected = items.filter((line: any) => id(line?.invoice_item) === invoiceItemId);
  const failures: string[] = [];
  if (String(invoice?.id || "") !== invoiceId) failures.push("invoice_id");
  if (id(invoice?.customer) !== customerId) failures.push("customer");
  if (String(invoice?.currency || "").toLowerCase() !== "usd") failures.push("currency");
  if (Number(invoice?.amount_due) !== amountCents) failures.push("amount_due");
  if (paid && (String(invoice?.status || "").toLowerCase() !== "paid" || Number(invoice?.amount_paid) !== amountCents)) {
    failures.push("paid_status_or_amount");
  }
  if (items.length !== 1 || expected.length !== 1 || Number(expected[0]?.amount) !== amountCents) {
    failures.push("invoice_items");
  }
  const itemMetadata = expected[0]?.metadata || {};
  const invoiceMetadata = invoice?.metadata || {};
  for (const [label, value] of Object.entries({ billingEventId: eventId, bucket, amountCents: String(amountCents) })) {
    if (String(itemMetadata[label] || "") !== value || String(invoiceMetadata[label] || "") !== value) {
      failures.push(`metadata.${label}`);
    }
  }
  if (failures.length) throw new Error(`Standalone invoice validation failed: ${failures.join(", ")}`);
}

/** Validates a stored standalone invoice without any Stripe write. */
export async function validateStoredStandaloneInvoice(event: any, paid: boolean) {
  const invoiceId = String(event?.stripeInvoiceId || "");
  const invoiceItemId = String(event?.stripeInvoiceItemId || "");
  const customerId = String(event?.stripeCustomerId || "");
  const eventId = String(event?._id || "");
  const amountCents = Number(event?.amountCents || 0);
  const bucket = String(event?.metadata?.bucket || "") as ThresholdBucket;
  if (!invoiceId || !invoiceItemId || !customerId || !eventId || !amountCents || !["regular", "ai_voice", "a2p"].includes(bucket)) {
    throw new Error("Paid BillingEvent is missing required standalone invoice identity");
  }
  const invoice = await stripe.invoices.retrieve(invoiceId);
  await validateInvoice({ invoice, invoiceId, invoiceItemId, eventId, customerId, amountCents, bucket, paid });
  return invoice;
}

/** Validates an already-paid event's stored standalone invoice without any Stripe write. */
export async function validatePaidStandaloneInvoice(event: any) {
  await validateStoredStandaloneInvoice(event, true);
}

/**
 * Creates exactly one empty standalone invoice and attaches exactly one item to it.
 * A BillingEvent is the durable idempotency boundary; every Stripe write key is
 * derived from that immutable document id.
 */
export async function settleStandaloneThresholdInvoice(params: SettleStandaloneInvoiceParams) {
  const normalizedEmail = String(params.userEmail || "").trim().toLowerCase();
  const eventMetadata = metadata({
    billingEventId: undefined,
    userEmail: normalizedEmail,
    userId: params.userId || "",
    source: params.source,
    sourceId: params.sourceId,
    bucket: params.bucket,
    amountCents: params.amountCents,
    ...(params.metadata || {}),
  });
  const idempotencyKey = `billing_${params.source}_${params.sourceId}_${params.amountCents}`;

  const event = await BillingEvent.findOneAndUpdate(
    { source: params.source, sourceId: params.sourceId, amountCents: params.amountCents },
    {
      $setOnInsert: {
        userEmail: normalizedEmail,
        userId: params.userId || "",
        stripeCustomerId: params.customerId,
        description: params.description,
        status: "pending",
        idempotencyKey,
        metadata: eventMetadata,
      },
      $set: { updatedAt: new Date() },
    },
    { upsert: true, new: true },
  );
  if (!event) throw new Error("Could not create BillingEvent");
  const wasCharging = String(event.status) === "charging";
  if ((event as any).needsManualReview === true) {
    throw new Error("BillingEvent requires manual review; refusing automatic Stripe work");
  }
  if (String(event.status) === "applied" || String(event.status) === "paid") return event;

  const claimed = await BillingEvent.findOneAndUpdate(
    { _id: event._id, status: { $in: ["pending", "charging"] } },
    { $set: { status: "charging", updatedAt: new Date() } },
    { new: true },
  );
  if (!claimed) throw new Error("BillingEvent is being settled by another request");

  let invoiceId = String((claimed as any).stripeInvoiceId || "");
  let invoiceItemId = String((claimed as any).stripeInvoiceItemId || "");
  if (wasCharging && !invoiceId) {
    throw new Error("BillingEvent has no persisted Stripe invoice reference; manual review required");
  }
  if (!invoiceId && invoiceItemId) throw new Error("BillingEvent has an incomplete Stripe reference; manual review required");

  const eventId = String(claimed._id);
  const stripeMetadata = metadata({ ...eventMetadata, billingEventId: eventId });
  if (!invoiceId) {
    assertStripeWritesEnabled();
    const invoice = await stripe.invoices.create(
      {
        customer: params.customerId,
        collection_method: "charge_automatically",
        auto_advance: false,
        pending_invoice_items_behavior: "exclude",
        metadata: stripeMetadata,
      } as any,
      { idempotencyKey: `billing_invoice_${eventId}` },
    );
    invoiceId = String(invoice.id || "");
    if (!invoiceId) throw new Error("Stripe did not return an invoice id");
    await BillingEvent.updateOne(
      { _id: eventId, status: "charging" },
      { $set: { stripeInvoiceId: invoiceId, updatedAt: new Date() } },
    );
  }

  if (!invoiceItemId) {
    const item = await stripe.invoiceItems.create(
      {
        customer: params.customerId,
        invoice: invoiceId,
        amount: params.amountCents,
        currency: "usd",
        description: params.description,
        discountable: false,
        metadata: stripeMetadata,
      },
      { idempotencyKey: `billing_invoice_item_${eventId}` },
    );
    invoiceItemId = String(item.id || "");
    if (!invoiceItemId) throw new Error("Stripe did not return an invoice item id");
    await BillingEvent.updateOne(
      { _id: eventId, status: "charging" },
      { $set: { stripeInvoiceItemId: invoiceItemId, updatedAt: new Date() } },
    );
  }

  let invoice = await stripe.invoices.retrieve(invoiceId);
  if (String((invoice as any)?.status || "").toLowerCase() === "draft") {
    await validateInvoice({ invoice, invoiceId, invoiceItemId, eventId, customerId: params.customerId, amountCents: params.amountCents, bucket: params.bucket, paid: false });
    invoice = await stripe.invoices.finalizeInvoice(invoiceId, {}, { idempotencyKey: `billing_invoice_finalize_${eventId}` });
  }
  if (String((invoice as any)?.status || "").toLowerCase() !== "paid") {
    await stripe.invoices.pay(invoiceId, {}, { idempotencyKey: `billing_invoice_pay_${eventId}` });
  }
  invoice = await stripe.invoices.retrieve(invoiceId);
  await validateInvoice({ invoice, invoiceId, invoiceItemId, eventId, customerId: params.customerId, amountCents: params.amountCents, bucket: params.bucket, paid: true });
  await BillingEvent.updateOne(
    { _id: eventId, status: "charging" },
    { $set: { status: "paid", paidAt: new Date(), stripeInvoiceId: invoiceId, stripeInvoiceItemId: invoiceItemId, updatedAt: new Date() } },
  );
  return BillingEvent.findById(eventId);
}
