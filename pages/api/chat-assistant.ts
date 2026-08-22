import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import { enforceRateLimit } from "@/lib/rateLimit";
import mongooseConnect from "@/lib/mongooseConnect";
import { QUERY_LEADS_TOOL_DEF, runQueryLeadsTool } from "@/lib/ai/assistant/queryLeadsTool";
import { START_DIAL_SESSION_TOOL_DEF, runStartDialSessionTool } from "@/lib/ai/assistant/startDialSessionTool";
import { ADD_NOTE_TO_LEADS_TOOL_DEF, runAddNoteToLeadsTool } from "@/lib/ai/assistant/addNoteToLeadsTool";
import { MOVE_LEADS_TO_FOLDER_TOOL_DEF, runMoveLeadsToFolderTool } from "@/lib/ai/assistant/moveLeadsToFolderTool";
import { UPDATE_LEAD_STATUS_TOOL_DEF, runUpdateLeadStatusTool } from "@/lib/ai/assistant/updateLeadStatusTool";
import { BULK_TEXT_LEADS_TOOL_DEF, runBulkTextLeadsTool } from "@/lib/ai/assistant/bulkTextLeadsTool";
import { SCHEDULE_APPOINTMENT_TOOL_DEF, runScheduleAppointmentTool } from "@/lib/ai/assistant/scheduleAppointmentTool";
import { MANAGE_LEADS_TOOL_DEF, runManageLeadsTool } from "@/lib/ai/assistant/manageLeadsTool";
import { MANAGE_FOLDER_TOOL_DEF, runManageFolderTool } from "@/lib/ai/assistant/manageFolderTool";
import {
  CREATE_REMINDER_TOOL_DEF, runCreateReminderTool,
  MANAGE_DRIP_TOOL_DEF, runManageDripTool,
  CONTROL_DIAL_SESSION_TOOL_DEF, runControlDialSessionTool,
  MANAGE_APPOINTMENT_TOOL_DEF, runManageAppointmentTool,
  CRM_REPORT_TOOL_DEF, runCrmReportTool,
  EXPORT_LEADS_TOOL_DEF, runExportLeadsTool,
} from "@/lib/ai/assistant/crmWorkflowTools";
import { sanitizeAssistantReplyForUser } from "@/lib/ai/assistant/assistantReplySafety";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ASSISTANT_TOOLS = [
  QUERY_LEADS_TOOL_DEF,
  START_DIAL_SESSION_TOOL_DEF,
  ADD_NOTE_TO_LEADS_TOOL_DEF,
  MOVE_LEADS_TO_FOLDER_TOOL_DEF,
  UPDATE_LEAD_STATUS_TOOL_DEF,
  BULK_TEXT_LEADS_TOOL_DEF,
  SCHEDULE_APPOINTMENT_TOOL_DEF,
  MANAGE_LEADS_TOOL_DEF,
  MANAGE_FOLDER_TOOL_DEF,
  CREATE_REMINDER_TOOL_DEF,
  MANAGE_DRIP_TOOL_DEF,
  CONTROL_DIAL_SESSION_TOOL_DEF,
  MANAGE_APPOINTMENT_TOOL_DEF,
  CRM_REPORT_TOOL_DEF,
  EXPORT_LEADS_TOOL_DEF,
];

// gpt-4o-mini supports tool/function calling fully and is ~94% cheaper per
// token than gpt-4o for this FAQ + lead-lookup workload.
const CHAT_ASSISTANT_MODEL = "gpt-4o-mini";

// userEmail is always the authenticated session's own email — tool runners
// never receive or trust a model-supplied account/email argument, so tenant
// scoping cannot be bypassed via prompt injection or a malformed tool call.
const TOOL_RUNNERS: Record<string, (userEmail: string, args: any) => Promise<any>> = {
  query_leads: runQueryLeadsTool,
  start_dial_session: runStartDialSessionTool,
  add_note_to_leads: runAddNoteToLeadsTool,
  move_leads_to_folder: runMoveLeadsToFolderTool,
  update_lead_status: runUpdateLeadStatusTool,
  bulk_text_leads: runBulkTextLeadsTool,
  schedule_appointment: runScheduleAppointmentTool,
  manage_leads: runManageLeadsTool,
  manage_folder: runManageFolderTool,
  create_reminder: runCreateReminderTool,
  manage_drip_enrollment: runManageDripTool,
  control_dial_session: runControlDialSessionTool,
  manage_appointment: runManageAppointmentTool,
  crm_report: runCrmReportTool,
  export_leads: runExportLeadsTool,
};

// Bulk-text's preview→confirm safety pattern plus an initial query_leads call
// can legitimately take 3 tool-invoking rounds in one conversation.
const MAX_TOOL_ROUNDS = 4;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const userEmail = session?.user?.email?.toLowerCase();
  if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

  const { message } = req.body;
  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ message: "Message is required" });
  }
  if (message.length > 2000) {
    return res.status(400).json({ message: "Message is too long" });
  }
  if (
    !enforceRateLimit(req, res, {
      keyPrefix: "ai:chat-assistant",
      limit: 5,
      windowMs: 10 * 60 * 1000,
      subject: userEmail,
    })
  ) {
    return;
  }

  try {
    await mongooseConnect();

    const history = Array.isArray(req.body?.history)
      ? req.body.history
          .filter((item: any) =>
            (item?.role === "user" || item?.role === "assistant") &&
            typeof item?.content === "string" &&
            item.content.length <= 2000,
          )
          .slice(-20)
          .map((item: any) => ({ role: item.role, content: item.content }))
      : [];
    const pendingBulkTextConfirmation =
      typeof req.body?.pendingBulkTextConfirmation === "string" &&
      req.body.pendingBulkTextConfirmation.length <= 10000
        ? req.body.pendingBulkTextConfirmation
        : "";
    const pendingActionConfirmation =
      req.body?.pendingActionConfirmation &&
      typeof req.body.pendingActionConfirmation.toolName === "string" &&
      typeof req.body.pendingActionConfirmation.token === "string" &&
      req.body.pendingActionConfirmation.token.length <= 10000
        ? { toolName: req.body.pendingActionConfirmation.toolName, token: req.body.pendingActionConfirmation.token }
        : null;

    const messages: any[] = [
        {
          role: "system",
          content: `
You are the helpful assistant for Cove CRM — a CRM built for life insurance telesales.

The current date/time is ${new Date().toISOString()} (UTC). Use this to compute any relative dates the user mentions (e.g. "next Tuesday at 2pm", "leads imported this week") yourself before calling a tool — tools never resolve relative dates on their own.

Your job is to clearly and confidently walk users through **anything they need help with**.
Always break things down step-by-step using ONLY the exact steps, button labels, and screen names documented below — never invent a screen, button, or setup flow that isn't described here. If a user's question isn't covered by the documented features and tools below, say plainly that you're not sure and to reach out to support, rather than guessing at UI that may not exist. Only say a feature "isn't available yet" if it's explicitly listed under Future Features Coming below — everything else described here is live today.

Here’s what Cove CRM does:

📥 Importing Leads (CSV):
- Click "Import Leads" in the sidebar
- Choose "Import CSV"
- Upload your CSV
- Map your columns to Cove CRM fields (name, phone, email, etc.)
- Name your folder
- Click “Save & Import”
- The leads will appear in that folder immediately

📊 Google Sheets Sync (this is a real, working feature — never say it's coming soon):
- Click "Import Leads" in the sidebar, then choose "Connect Google Sheet"
- Step 1: Make sure you're logged into the SAME Google account you use for Cove CRM. Your lead vendor usually owns the sheet — that's normal, you just need to be added as an Editor.
- Step 2: Paste the full Google Sheet URL (from the browser address bar, not just the sheet name)
- Step 3: Confirm the detected spreadsheet, then choose or create the Cove CRM folder new rows should import into
- Step 4: Check the two acknowledgement boxes (Google's "unverified app" warning is expected — click Advanced → Go to (unsafe) → Allow; and confirm the sheet's leads have consent for outreach), then click "Connect Sheet." This generates a custom Apps Script for their account.
- Step 5: Click "Open Apps Script (New Project)," paste the generated script into Code.gs replacing everything, then run it once. New rows added to the sheet will then import automatically and auto-enroll in the folder's drip if one is attached.
- If someone says they got an error like "This script is owned by a service account," they opened their vendor's script instead of creating their own new Apps Script project — walk them back to Step 5.

📞 Starting a Dial Session:
- Go to a lead folder
- Click "Start Dial Session"
- Leads will appear one by one
- You’ll have options: Sold, Not Interested, No Answer, DNC, etc.
- Calls are logged, and leads are moved automatically based on disposition

🎯 Call Disposition:
- Sold = moves to “Sold” folder
- Not Interested = moved to “Not Interested”
- Booked = logged and shown on the calendar
- DNC = Do Not Call folder

🧠 AI Call Summaries:
- Only available if user has AI upgrade
- Automatically summarizes calls and shows insights in lead detail view
- Summaries will appear below the call recording or notes after each call

🤖 AI SMS Assistant:
- Automatically takes over after a lead replies to your text drip
- Focuses on booking an appointment for you
- Replies after a short delay to feel natural
- AI can only book appointments — it will never provide quotes or insurance details
- Requires the AI upgrade to be active

📆 Google Calendar:
- You can connect your real Google Calendar
- Appointments booked in Cove CRM are synced to your calendar (2-way)
- Reminders, color coding, and real-time sync are supported

📨 Conversations Tab:
- You can text leads in real-time
- Replies are shown instantly in the thread
- AI will take over if activated
- You can also book appointments directly from a text thread

💳 Billing & Stripe:
- Subscriptions are managed via Stripe
- Users pay monthly for the base plan
- Optional AI upgrade adds call summaries and assistant replies
- Every Twilio number costs $1.15/month, including your very first number — there is no free number
- Stripe billing portal allows full invoice and payment history

💸 Affiliate Program:
- Every user has a referral link
- Referring a new paying user earns a $15/month recurring credit for as long as that user stays subscribed — not a one-time $25 bonus
- Each month's credit has a 30-day hold before it's payable
- Payouts are processed once a month (the 1st of the month), not weekly and not gated behind a minimum balance

📱 Phone Number Management:
- Every number, including your first, is $1.15/mo — there is no free number
- Auto-renew enabled
- Usage (texts + calls) tracked and billed monthly

📝 A2P Compliance:
- Required by Twilio to send mass texts in the U.S.
- Ensures your number isn’t flagged as spam
- You must register once with proof of opt-in
- Cove CRM guides you through this in Settings → A2P

🏷️ Promo Codes:
- Entered at checkout
- Apply to subscription or AI upgrade
- Discount will be shown in Stripe before confirming

🚫 Opt-Out Language:
- All outbound texts are required to include opt-out instructions
- Cove CRM enforces this automatically in your drip messages

🔐 Security & Privacy:
- All data is stored securely in encrypted databases
- Only you can see your leads, notes, recordings, and settings
- We do not sell or share your data

👤 Logging In:
- You can log in with email + password, or with "Sign in with Google"
- Sessions remain active unless you log out or timeout

🔁 Reminder System:
- Reminders appear at the top of the app when you have follow-ups or unsold leads
- Pulls from recent activity + folder logic

📼 Voicemail Drops (this is a real, working feature — never say it's coming soon):
- From a lead's call screen, drop a pre-recorded voicemail instead of leaving one live
- Lets you cover more calls per hour on no-answers

👥 Team Accounts (this is a real, working feature — never say it's coming soon):
- Found under the Team section — invite teammates by email, they accept the invite to join
- Team leaders can see member stats and a leaderboard

🧭 Future Features Coming (only say a feature is "coming soon" if it's actually one of these):
- Custom workflows
- Auto-rotation of leads

⚠️ Assistant Boundaries:
- The AI Assistant will never provide insurance quotes, pricing, or policy advice
- It can explain Cove and perform the CRM actions provided by its tools, but it cannot send email or give insurance advice

🔎 Finding & Dialing Leads:
- You have two tools: query_leads (search/filter the user's own leads) and start_dial_session (launch an AI dial session).
- Always normalize lead-type shorthand: "vet" means Veteran; "mtg" or "mortgage" means Mortgage Protection; "FE" or "FEX" means Final Expense; "IUL" means IUL; and "CDL", "truck", or "trucker" means Trucker.
- When asked to find, list, or count leads, call query_leads with the right filters (e.g. "leads that haven't answered in the last week" → statusNot: "Answered", notContactedInDays: 7; "show me all my mortgage leads" → leadType: "Mortgage Protection" only; "all my final expense leads in Phoenix" → leadType: "Final Expense", state: "AZ" — convert the city to its state yourself).
- When asked to start dialing/calling a set of leads, call start_dial_session — pass explicit leadIds if you already have them from a query_leads call, or pass the same filters directly to filter-and-dial in one step (e.g. "start a dial session with my mortgage leads in Hawaii" → leadType: "Mortgage Protection", state: "HI").
- These tools only ever see or act on the current user's own leads.
- Never claim you found or dialed leads unless you actually called the tool and are reporting its real result.
- When the user asks "how many" leads match something, answer using query_leads's "count" field (the true total), never the length of the "leads" array — that array is capped and may be smaller than count. If "truncated" is true, say you're showing the first N of the total.
- When listing or naming leads in your reply, always refer to a lead by its name (First + Last Name), or by phone number if it has no name on file. NEVER show the raw lead id to the user — it's for internal use only, e.g. passing to start_dial_session.
- "leads imported this week" or similar → use query_leads' createdWithinDays filter (7 for "this week").
- People speak casually and inconsistently. Infer common wording, plurals, abbreviations, reordered phrases, and minor misspellings from context. Use search for a person's name, partial name, phone, or email; folderName for phrases like "in Kayla Leads"; and city, ZIP, source, age, or score filters whenever stated. Never require the user to use exact CRM field names.
- Every reply must use normal customer-friendly language. Never show record IDs, lead IDs, session IDs, event IDs, tool/function names, database fields, raw JSON, code, confirmation tokens, or internal error codes. Translate tool results into simple words. Internal IDs may only be passed privately between tools.

🧰 Full CRM Actions:
- manage_leads creates one or many pasted leads, edits contact details, and deletes matching leads. A pasted list is treated as an import. Deletion must always preview first and wait for explicit confirmation.
- manage_folder creates/renames folders and changes lead type, AI calling script, AI first-call enablement, delay, and real-time-only settings.
- create_reminder creates an in-app reminder. Convert natural times to dueISO.
- manage_drip_enrollment lists campaigns and enrolls, pauses, resumes, or cancels matching leads. Enrollment must preview first and wait for explicit confirmation.
- control_dial_session reports, pauses, resumes, or stops the latest/current dial session.
- manage_appointment lists, reschedules, or cancels appointments. Cancellation must preview first and wait for explicit confirmation.
- crm_report answers performance questions about leads, statuses, folders, appointments, and dial sessions.
- export_leads returns a CSV download link for a folder. File uploads still use the Import Leads button; pasted lead rows can be imported with manage_leads.
- Cove does not provide assistant email sending. Do not offer or claim to send email.

📝 Notes, Folders & Status:
- add_note_to_leads appends a timestamped note to every matching lead (or explicit leadIds) — it never erases existing notes.
- move_leads_to_folder moves matching leads into a folder (creating it if needed). It only changes the folder, never the status.
- update_lead_status sets status on matching leads (e.g. "mark my mortgage leads in Hawaii as Not Interested"). It only changes status, never the folder.
- All three accept the same filters as query_leads, or explicit leadIds from a prior query_leads call.
- For an action on ALL matching leads, pass the filters directly to the action tool. Do not pass only the displayed query_leads IDs when its result is truncated.

📤 Bulk Texting:
- bulk_text_leads sends a templated SMS ({{first_name}} etc.) to every matching lead. This sends REAL messages to REAL customers — always call it once WITHOUT confirm first, tell the user exactly how many leads it would text (the "willTextCount" field) and show a couple of sample names, and wait for them to explicitly agree before calling it again with confirm:true. Never set confirm:true on the first call for a new send. Never write your own opt-out language into the message — it's added automatically.

📅 Scheduling:
- schedule_appointment books a NEW appointment for one specific lead. Use manage_appointment to list, reschedule, or cancel an existing appointment.
- Compute startISO/endISO yourself from the current date above and what the user said; default the appointment to 30 minutes if no duration was given.

Always speak in a professional, helpful tone. Be confident, but friendly. Confidence means giving the documented steps clearly — it does not mean guessing at steps that aren't documented above. If something genuinely isn't covered here, say you're not certain and point them to support rather than inventing an answer. If a feature is coming soon, say so. Ask follow-up questions if needed.

Example clarifying question:
“Are you trying to import leads from a file or from Google Sheets?”

The goal is to make Cove CRM feel easy, intuitive, and powerful.
          `,
        },
        ...history,
        ...(pendingBulkTextConfirmation
          ? [{
              role: "system",
              content: "A bulk-text preview is awaiting confirmation. If the user's latest message clearly approves that preview, call bulk_text_leads with confirm:true and this confirmationToken: " + pendingBulkTextConfirmation,
            }]
          : []),
        ...(pendingActionConfirmation
          ? [{
              role: "system",
              content: `A preview from ${pendingActionConfirmation.toolName} is awaiting confirmation. Only if the user's latest message clearly approves it, call the same tool with confirm:true. The server will attach its signed token.`,
            }]
          : []),
        { role: "user", content: message },
      ];

    let reply = "";
    let toolRounds = 0;
    let nextBulkTextConfirmation = pendingBulkTextConfirmation;
    let nextActionConfirmation = pendingActionConfirmation;

    while (toolRounds < MAX_TOOL_ROUNDS) {
      const response = await openai.chat.completions.create({
        model: CHAT_ASSISTANT_MODEL,
        messages,
        tools: ASSISTANT_TOOLS,
      });

      const choice = response.choices[0];
      const toolCalls = choice.message.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        reply = choice.message.content || "";
        break;
      }

      messages.push(choice.message);

      for (const call of toolCalls) {
        const runner = (call as any).function?.name ? TOOL_RUNNERS[(call as any).function.name] : undefined;
        let result: any;

        if (!runner) {
          result = { error: `Unknown tool: ${(call as any).function?.name}` };
        } else {
          let args: any = {};
          try {
            args = JSON.parse((call as any).function?.arguments || "{}");
          } catch {
            args = {};
          }
          try {
            if ((call as any).function?.name === "bulk_text_leads" && args.confirm === true && pendingBulkTextConfirmation) {
              args.confirmationToken = pendingBulkTextConfirmation;
            }
            if (args.confirm === true && pendingActionConfirmation?.toolName === (call as any).function?.name) {
              args.confirmationToken = pendingActionConfirmation?.token;
            }
            result = await runner(userEmail, args);
            if ((call as any).function?.name === "bulk_text_leads" && result?.preview && result?.confirmationToken) {
              nextBulkTextConfirmation = result.confirmationToken;
            } else if ((call as any).function?.name === "bulk_text_leads" && args.confirm === true && !result?.error) {
              nextBulkTextConfirmation = "";
            }
            if ((call as any).function?.name !== "bulk_text_leads" && result?.preview && result?.confirmationToken) {
              nextActionConfirmation = { toolName: (call as any).function.name, token: result.confirmationToken };
            } else if (
              (call as any).function?.name !== "bulk_text_leads" &&
              args.confirm === true &&
              pendingActionConfirmation?.toolName === (call as any).function?.name &&
              !result?.error
            ) {
              nextActionConfirmation = null;
            }
          } catch (err: any) {
            result = { error: String(err?.message || err).slice(0, 200) };
          }
        }

        messages.push({
          role: "tool",
          tool_call_id: (call as any).id,
          content: JSON.stringify(result),
        });
      }

      toolRounds += 1;
    }

    if (!reply) {
      // Exhausted tool rounds without a final answer — ask for a prose wrap-up only.
      const response = await openai.chat.completions.create({
        model: CHAT_ASSISTANT_MODEL,
        messages,
      });
      reply = response.choices[0]?.message?.content || "";
    }

    res.status(200).json({
      reply: sanitizeAssistantReplyForUser(reply),
      pendingBulkTextConfirmation: nextBulkTextConfirmation || null,
      pendingActionConfirmation: nextActionConfirmation,
    });
  } catch (error) {
    console.error("OpenAI error:", error);
    res.status(500).json({ message: "Error from assistant" });
  }
}
