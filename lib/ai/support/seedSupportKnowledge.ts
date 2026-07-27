import mongooseConnect from "@/lib/mongooseConnect";
import SupportKnowledgeDoc from "@/models/SupportKnowledgeDoc";

const SUPPORT_DOCS = [
  {
    title: "Microphone and browser calling",
    category: "calling",
    tags: ["microphone", "mic", "permission", "browser", "speaker", "audio", "call"],
    content:
      "Before a browser call, CoveCRM checks microphone access. To fix microphone issues: use the browser site-controls icon beside the CoveCRM address and set Microphone to Allow, reload CoveCRM, select the correct microphone in computer sound settings, and quit Zoom, Teams, FaceTime, or other apps that may be using it. Safari users should also check Safari > Settings for This Website > Microphone. CoveCRM will explain whether permission was blocked, no device was found, or another app is using the device.",
  },
  {
    title: "Getting started with calls",
    category: "calling",
    tags: ["first call", "getting started", "number", "call", "dialer", "setup"],
    content:
      "For a first call: buy or select a voice-capable number in Numbers, test the microphone when prompted, import or add a lead with a valid phone number, then start a call from the lead or dial session. A purchased number can make calls right away. Texting may remain unavailable until A2P registration is approved.",
  },
  {
    title: "How to connect Facebook",
    category: "integrations",
    tags: ["facebook", "meta", "lead ads", "integration"],
    content:
      "To connect Facebook, open the Facebook lead or ads connection flow, authenticate the correct Meta account, and confirm the right business assets are selected. After connecting, verify that new Meta leads are appearing inside the CRM.",
  },
  {
    title: "How to connect Google Sheets",
    category: "imports",
    tags: ["google sheets", "sheet", "import", "webhook"],
    content:
      "To connect Google Sheets, paste the sheet URL, choose the target folder, then install the generated Apps Script webhook. After setup, new rows should flow into the selected folder automatically.",
  },
  {
    title: "How AI calling works",
    category: "ai",
    tags: ["ai calling", "dialer", "voice", "calls"],
    content:
      "AI calling depends on AI access being enabled, a valid sending number, the correct session script and voice settings, and a reachable lead. If calls are not starting, inspect AI access, the configured numbers, and any recent call-status failures.",
  },
  {
    title: "How AI SMS works",
    category: "ai",
    tags: ["ai sms", "sms", "assistant", "messages"],
    content:
      "AI SMS uses the lead's recent thread, lead memory, and tenant messaging readiness. If AI SMS is not replying, inspect inbound delivery, A2P readiness, and whether AI features are enabled for the user.",
  },
  {
    title: "A2P approval steps",
    category: "messaging",
    tags: ["a2p", "10dlc", "campaign", "messaging service"],
    content:
      "A2P requires successful brand and campaign approval plus a working messaging service. If SMS sending is blocked or restricted, inspect registration status, campaign status, messaging service presence, and messagingReady.",
  },
  {
    title: "Buying numbers",
    category: "messaging",
    tags: ["numbers", "twilio", "buy", "phone number"],
    content:
      "Numbers are managed from the Numbers screen. Search by US state or a specific three-digit area code, select a result, then click Confirm on that same result to purchase it. Calling is ready after a successful purchase; texting may remain unavailable until A2P registration is approved. If sending fails, confirm the number exists and is usable for the current flow.",
  },
  {
    title: "Importing leads",
    category: "imports",
    tags: ["import", "csv", "sheets", "leads"],
    content:
      "Lead imports can come from CSV, Google Sheets, or connected lead sources. When troubleshooting imports, inspect recent import records, field mapping issues, and whether rows are landing in the intended folder.",
  },
  {
    title: "Drip campaigns",
    category: "automation",
    tags: ["drip", "campaigns", "folders", "automation"],
    content:
      "Drip behavior is often controlled by folder mappings and assigned campaigns. If a lead is not receiving expected messages, inspect the folder mapping, assigned drips, pause state, and any inbound reply behavior that may stop automation.",
  },
  {
    title: "Booking appointments",
    category: "calendar",
    tags: ["booking", "appointments", "calendar", "google calendar"],
    content:
      "Booking requires a working calendar connection plus valid lead details. If appointment creation or reminders fail, inspect Google Calendar connectivity, booking settings, and any SMS confirmation failures.",
  },
];

export async function ensureSupportKnowledgeSeeded() {
  await mongooseConnect();

  for (const doc of SUPPORT_DOCS) {
    await SupportKnowledgeDoc.findOneAndUpdate(
      { title: doc.title },
      {
        $set: {
          category: doc.category,
          content: doc.content,
          tags: doc.tags,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
}
