// /scripts/repair-orphaned-messages.ts
import "@/lib/mongooseConnect";
import mongoose from "mongoose";
import Lead from "@/models/Lead";
import Message from "@/models/Message";

function digits(x: string) { return (x || "").replace(/\D/g, ""); }
function last10(x: string) { const d = digits(x); return d.slice(-10); }

async function main() {
  await (await import("@/lib/mongooseConnect")).default();

  const msgs = await Message.find({
    $or: [
      { leadId: { $exists: false } },
      { leadId: null },
    ],
  }).limit(100000).lean();

  console.log(`Found ${msgs.length} messages with null/missing leadId`);

  let fixed = 0, created = 0;

  for (const m of msgs) {
    try {
      const userEmail = (m as any).userEmail;
      if (!userEmail) continue;

      const phone = (m as any).direction === "inbound" ? (m as any).from : (m as any).to;
      const norm10 = last10(String(phone || ""));
      if (!norm10) continue;

      const plus1 = `+1${norm10}`;

      let lead = await Lead.findOne({ userEmail, $or: [
        { Phone: plus1 }, { phone: plus1 }, { "phones.value": plus1 } as any,
      ] });

      if (!lead) {
        lead = await Lead.create({
          userEmail,
          Phone: plus1,
          phone: plus1,
          "First Name": "SMS",
          "Last Name": "Lead",
          source: "repair_script",
          status: "New",
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);
        created++;
      }

      await Message.updateOne({ _id: (m as any)._id }, { $set: { leadId: lead._id } });
      fixed++;
    } catch (e) {
      console.warn("repair failed for message", (m as any)._id, e);
    }
  }

  console.log(`Repair complete. Reattached=${fixed}, New leads=${created}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
