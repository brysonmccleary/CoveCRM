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
    tags: ["google sheets", "sheet", "import", "webhook", "vendor"],
    content:
      "This is a real, working feature — never call it 'coming soon'. Click the 'Import Leads' button in the sidebar, then choose 'Connect Google Sheet' (not 'Import CSV'). Step 1: be logged into the same Google account used for CoveCRM; the lead vendor usually owns the sheet, the user just needs Editor access. Step 2: paste the full Google Sheet URL. Step 3: confirm the detected sheet and pick/create the destination folder. Step 4: check both acknowledgement boxes (Google's 'unverified app' warning is expected — Advanced -> Go to (unsafe) -> Allow; plus lead consent) and click 'Connect Sheet' to generate a custom Apps Script. Step 5: click 'Open Apps Script (New Project)', paste the generated script into Code.gs replacing everything, run it once. New rows then import automatically. Error 'owned by a service account' means they opened the vendor's script instead of a new one — send them back to Step 5.",
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
    tags: ["numbers", "twilio", "buy", "phone number", "price", "cost", "free"],
    content:
      "Numbers are managed from the Numbers screen. Search by US state or a specific three-digit area code, select a result, then click Confirm on that same result to purchase it. Every number costs $1.15/month, including the very first one — there is no free number, and usage (texts + calls) is billed on top. Calling is ready after a successful purchase; texting may remain unavailable until A2P registration is approved. If sending fails, confirm the number exists and is usable for the current flow.",
  },
  {
    title: "Importing leads",
    category: "imports",
    tags: ["import", "csv", "sheets", "leads"],
    content:
      "Lead imports can come from CSV ('Import Leads' -> 'Import CSV') or Google Sheets ('Import Leads' -> 'Connect Google Sheet' — see the separate Google Sheets doc for the exact steps). When troubleshooting imports, inspect recent import records, field mapping issues, and whether rows are landing in the intended folder.",
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
  {
    title: "Voicemail drops",
    category: "calling",
    tags: ["voicemail", "drop", "voicemail drop"],
    content:
      "This is a real, working feature — never call it 'coming soon'. From a lead's call screen, a pre-recorded voicemail can be dropped instead of leaving one live, letting an agent cover more calls per hour on no-answers.",
  },
  {
    title: "Team accounts",
    category: "team",
    tags: ["team", "invite", "teammate", "leaderboard"],
    content:
      "This is a real, working feature — never call it 'coming soon'. Found under the 'Team' section in the sidebar. A team leader invites teammates by email; the invitee accepts to join. Team leaders can see member stats and a leaderboard.",
  },
  {
    title: "Affiliate program",
    category: "billing",
    tags: ["affiliate", "referral", "payout", "commission"],
    content:
      "Every user has a referral link. Referring a new paying user earns a $15/month recurring credit for as long as that referred user stays subscribed — it is NOT a one-time $25 bonus. Each month's credit has a 30-day hold before it becomes payable. Payouts are processed once a month (the 1st of the month) via Stripe Connect — not weekly, and not gated behind a minimum balance.",
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
