import OpenAI from "openai";
import mongooseConnect from "@/lib/mongooseConnect";
import SupportConversation from "@/models/SupportConversation";
import SupportKnowledgeDoc from "@/models/SupportKnowledgeDoc";
import { buildSupportContext } from "./supportContext";
import { ensureSupportKnowledgeSeeded } from "./seedSupportKnowledge";
import { priceOpenAIUsage } from "@/lib/billing/openaiPricing";
import {
  getA2PStatus,
  getAIFeatureStatus,
  getFolderMappings,
  getMetaStatus,
  getRecentImportErrors,
  getRecentSmsFailures,
  getTwilioStatus,
} from "./supportTools";

const SUPPORT_MODEL = process.env.OPENAI_SUPPORT_MODEL || "gpt-4.1-mini";
const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_ITEM_CHARS = 240;
const MAX_KNOWLEDGE_DOCS = 3;
const MAX_KNOWLEDGE_DOC_CHARS = 900;
const MAX_TOOL_RESULT_CHARS = 900;
const MAX_TOTAL_PROMPT_CHARS = 14000;
const MAX_SUPPORT_CONTEXT_CHARS = 7000;
const MAX_PAGE_CONTEXT_CHARS = 160;
const MAX_USER_MESSAGE_CHARS = 1200;

const SUPPORT_TOOL_DEFS = [
  { name: "getTwilioStatus", description: "Inspect Twilio and phone-number setup for the tenant." },
  { name: "getA2PStatus", description: "Inspect A2P registration and messaging readiness." },
  { name: "getMetaStatus", description: "Inspect Meta/Facebook integration state." },
  { name: "getRecentImportErrors", description: "Inspect recent lead import issues." },
  { name: "getRecentSmsFailures", description: "Inspect recent SMS delivery failures." },
  { name: "getFolderMappings", description: "Inspect folders, drip mappings, and folder AI settings." },
  { name: "getAIFeatureStatus", description: "Inspect AI feature availability for the tenant." },
];

const SUPPORT_TOOL_RUNNERS: Record<string, (userEmail: string) => Promise<any>> = {
  getTwilioStatus,
  getA2PStatus,
  getMetaStatus,
  getRecentImportErrors,
  getRecentSmsFailures,
  getFolderMappings,
  getAIFeatureStatus,
};

type HelpAssistantArgs = {
  userEmail: string;
  content: string;
  conversationId?: string;
  pageContext?: string;
};

function safeErrorMessage(err: any) {
  const message = String(err?.message || err || "internal_error").trim();
  return message.slice(0, 160) || "internal_error";
}

function truncateText(value: any, maxChars: number) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function jsonChars(value: any) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function summarizeRecentFailures(items: any[], limit: number) {
  return (Array.isArray(items) ? items : []).slice(0, limit).map((item: any) => ({
    status: String(item?.status || "").trim(),
    errorCode: String(item?.errorCode || "").trim(),
    errorMessage: truncateText(item?.errorMessage, 120),
    createdAt: item?.createdAt || null,
  }));
}

function compactSupportContextForPrompt(supportContext: any) {
  const compact = {
    integrations: {
      twilioConfigured: Boolean(supportContext?.integrations?.twilioConfigured),
      googleSheetsConnected: Boolean(supportContext?.integrations?.googleSheetsConnected),
      googleCalendarConnected: Boolean(supportContext?.integrations?.googleCalendarConnected),
      metaConnected: Boolean(supportContext?.integrations?.metaConnected),
    },
    messagingStatus: {
      numberCount: Number(supportContext?.messagingStatus?.numberCount || 0),
      a2p: supportContext?.messagingStatus?.a2p?.profile
        ? {
            registrationStatus: supportContext.messagingStatus.a2p.profile.registrationStatus || "",
            applicationStatus: supportContext.messagingStatus.a2p.profile.applicationStatus || "",
            messagingReady: Boolean(supportContext.messagingStatus.a2p.profile.messagingReady),
            brandStatus: supportContext.messagingStatus.a2p.profile.brandStatus || "",
            lastError: truncateText(supportContext.messagingStatus.a2p.profile.lastError, 120),
          }
        : null,
      recentSmsFailures: summarizeRecentFailures(supportContext?.messagingStatus?.recentSmsFailures, 3),
    },
    campaigns: {
      assignedDripsTotal: Number(supportContext?.campaigns?.assignedDripsTotal || 0),
    },
    folders: (Array.isArray(supportContext?.folders) ? supportContext.folders : []).slice(0, 5).map((folder: any) => ({
      id: String(folder?.id || ""),
      name: truncateText(folder?.name, 48),
      aiContactEnabled: Boolean(folder?.aiContactEnabled),
      aiFirstCallEnabled: Boolean(folder?.aiFirstCallEnabled),
    })),
    recentErrors: {
      smsFailures: summarizeRecentFailures(supportContext?.recentErrors?.smsFailures, 3),
      importErrors: (Array.isArray(supportContext?.recentErrors?.importErrors) ? supportContext.recentErrors.importErrors : [])
        .slice(0, 3)
        .map((item: any) => ({
          id: String(item?.id || ""),
          sourceType: String(item?.sourceType || ""),
          createdAt: item?.createdAt || null,
        })),
    },
    aiFeatures: {
      hasAI: Boolean(supportContext?.aiFeatures?.hasAI),
      aiAssistantName: truncateText(supportContext?.aiFeatures?.aiAssistantName, 40),
      aiDialerBalance: Number(supportContext?.aiFeatures?.aiDialerBalance || 0),
      usageBalance: Number(supportContext?.aiFeatures?.usageBalance || 0),
    },
    leadAssistant: supportContext?.leadAssistant
      ? {
          totals: {
            totalLeads: Number(supportContext.leadAssistant?.totals?.totalLeads || 0),
            hotLeads: Number(supportContext.leadAssistant?.totals?.hotLeads || 0),
            warmLeads: Number(supportContext.leadAssistant?.totals?.warmLeads || 0),
          },
          topLeads: (Array.isArray(supportContext?.leadAssistant?.topLeads) ? supportContext.leadAssistant.topLeads : [])
            .slice(0, 5)
            .map((lead: any) => ({
              id: String(lead?.id || ""),
              name: truncateText(lead?.name, 48),
              folder: truncateText(lead?.folder, 32),
              aiPriorityScore: typeof lead?.aiPriorityScore === "number" ? lead.aiPriorityScore : 0,
              aiPriorityCategory: String(lead?.aiPriorityCategory || ""),
              status: truncateText(lead?.status, 24),
              updatedAt: lead?.updatedAt || null,
            })),
        }
      : null,
    topLeads: (Array.isArray(supportContext?.topLeads) ? supportContext.topLeads : []).slice(0, 5).map((lead: any) => ({
      id: String(lead?.id || ""),
      name: truncateText(lead?.name, 48),
      folder: truncateText(lead?.folder, 32),
      aiPriorityScore: typeof lead?.aiPriorityScore === "number" ? lead.aiPriorityScore : 0,
      aiPriorityCategory: String(lead?.aiPriorityCategory || ""),
      status: truncateText(lead?.status, 24),
      updatedAt: lead?.updatedAt || null,
    })),
  };

  const compactChars = jsonChars(compact);
  return {
    compact:
      compactChars <= MAX_SUPPORT_CONTEXT_CHARS
        ? compact
        : {
            integrations: compact.integrations,
            messagingStatus: {
              numberCount: compact.messagingStatus.numberCount,
              a2p: compact.messagingStatus.a2p,
            },
            campaigns: compact.campaigns,
            folders: compact.folders.slice(0, 3),
            aiFeatures: compact.aiFeatures,
            leadAssistant: compact.leadAssistant
              ? {
                  totals: compact.leadAssistant.totals,
                  topLeads: compact.leadAssistant.topLeads.slice(0, 3),
                }
              : null,
            topLeads: compact.topLeads.slice(0, 3),
          },
    truncated: compactChars > MAX_SUPPORT_CONTEXT_CHARS,
    originalChars: compactChars,
  };
}

function compactKnowledgeDocsForPrompt(knowledgeDocs: any[]) {
  const docs = (Array.isArray(knowledgeDocs) ? knowledgeDocs : []).slice(0, MAX_KNOWLEDGE_DOCS).map((doc: any) => ({
    title: truncateText(doc?.title, 100),
    category: truncateText(doc?.category, 40),
    tags: Array.isArray(doc?.tags) ? doc.tags.slice(0, 6).map((tag: any) => truncateText(tag, 24)) : [],
    content: truncateText(doc?.content, MAX_KNOWLEDGE_DOC_CHARS),
  }));
  return {
    docs,
    truncated: (Array.isArray(knowledgeDocs) ? knowledgeDocs.length : 0) > docs.length,
  };
}

function compactHistoryForPrompt(messages: any[]) {
  const history = (Array.isArray(messages) ? messages : [])
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message: any) => ({
      role: String(message?.role || "user"),
      content: truncateText(message?.content, MAX_HISTORY_ITEM_CHARS),
      createdAt: message?.createdAt || null,
    }));
  return {
    history,
    truncated: (Array.isArray(messages) ? messages.length : 0) > history.length,
  };
}

function trimToolResult(value: any): any {
  if (Array.isArray(value)) {
    return value.slice(0, 4).map((item) => trimToolResult(item));
  }
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [key, raw] of Object.entries(value)) {
      if (Array.isArray(raw)) out[key] = raw.slice(0, 4).map((item) => trimToolResult(item));
      else if (raw && typeof raw === "object") out[key] = trimToolResult(raw);
      else if (typeof raw === "string") out[key] = truncateText(raw, 160);
      else out[key] = raw;
    }
    return out;
  }
  if (typeof value === "string") return truncateText(value, 160);
  return value;
}

function buildPromptPayload(args: {
  message: string;
  pageContext?: string;
  supportContext: any;
  knowledgeDocs: any[];
  history: any[];
}) {
  const safeMessage = truncateText(args.message, MAX_USER_MESSAGE_CHARS);
  const safePageContext = truncateText(args.pageContext, MAX_PAGE_CONTEXT_CHARS);
  let supportContextInfo = compactSupportContextForPrompt(args.supportContext);
  let knowledgeInfo = compactKnowledgeDocsForPrompt(args.knowledgeDocs);
  let historyInfo = compactHistoryForPrompt(args.history);

  let payload = {
    message: safeMessage,
    pageContext: safePageContext,
    supportContext: supportContextInfo.compact,
    knowledgeDocs: knowledgeInfo.docs,
    history: historyInfo.history,
  };

  let totalPromptChars = jsonChars(payload);
  let totalPromptTruncated = false;

  if (totalPromptChars > MAX_TOTAL_PROMPT_CHARS) {
    totalPromptTruncated = true;
    knowledgeInfo = {
      docs: knowledgeInfo.docs.map((doc) => ({
        ...doc,
        content: truncateText(doc.content, 500),
      })),
      truncated: true,
    };
    historyInfo = {
      history: historyInfo.history.slice(-4).map((item) => ({
        ...item,
        content: truncateText(item.content, 160),
      })),
      truncated: true,
    };
    payload = {
      message: safeMessage,
      pageContext: safePageContext,
      supportContext: supportContextInfo.compact,
      knowledgeDocs: knowledgeInfo.docs,
      history: historyInfo.history,
    };
    totalPromptChars = jsonChars(payload);
  }

  if (totalPromptChars > MAX_TOTAL_PROMPT_CHARS) {
    totalPromptTruncated = true;
    supportContextInfo = {
      compact: compactSupportContextForPrompt({
        ...args.supportContext,
        folders: Array.isArray(args.supportContext?.folders) ? args.supportContext.folders.slice(0, 3) : [],
        topLeads: Array.isArray(args.supportContext?.topLeads) ? args.supportContext.topLeads.slice(0, 3) : [],
        leadAssistant: args.supportContext?.leadAssistant
          ? {
              ...args.supportContext.leadAssistant,
              topLeads: Array.isArray(args.supportContext.leadAssistant?.topLeads)
                ? args.supportContext.leadAssistant.topLeads.slice(0, 3)
                : [],
            }
          : null,
      }).compact,
      truncated: true,
      originalChars: supportContextInfo.originalChars,
    };
    payload = {
      message: safeMessage,
      pageContext: safePageContext,
      supportContext: supportContextInfo.compact,
      knowledgeDocs: knowledgeInfo.docs,
      history: historyInfo.history,
    };
    totalPromptChars = jsonChars(payload);
  }

  return {
    payload,
    metrics: {
      userMessageChars: safeMessage.length,
      pageContextChars: safePageContext.length,
      supportContextChars: jsonChars(supportContextInfo.compact),
      knowledgeDocsChars: jsonChars(knowledgeInfo.docs),
      historyChars: jsonChars(historyInfo.history),
      totalPromptChars,
      supportContextTruncated: supportContextInfo.truncated,
      knowledgeDocsTruncated: knowledgeInfo.truncated,
      historyTruncated: historyInfo.truncated,
      totalPromptTruncated,
      knowledgeDocCount: knowledgeInfo.docs.length,
      historyCount: historyInfo.history.length,
    },
  };
}

function logSupportPrompt(details: Record<string, unknown>) {
  console.info("[support-assistant]", details);
}

async function runSupportToolsSafely(userEmail: string) {
  const toolResults: Record<string, any> = {};
  await Promise.all(
    Object.entries(SUPPORT_TOOL_RUNNERS).map(async ([toolName, runner]) => {
      try {
        toolResults[toolName] = await runner(userEmail);
      } catch (err: any) {
        toolResults[toolName] = { error: safeErrorMessage(err) };
      }
    })
  );
  return toolResults;
}

function firstQuestionLine(text: string) {
  return String(text || "").trim().replace(/\s+/g, " ").slice(0, 180);
}

function buildWhoToCallAnswer(supportContext: any) {
  const topLeads = Array.isArray(supportContext?.topLeads) ? supportContext.topLeads : [];
  if (!topLeads.length) {
    return "I’m not seeing any ranked leads yet. Once leads have AI priority data, I can point you to the hottest contacts to call first.";
  }

  const picks = topLeads.slice(0, 3).map((lead: any, index: number) => {
    const reasonBits = [
      typeof lead?.aiPriorityScore === "number" ? `score ${lead.aiPriorityScore}` : "",
      lead?.aiPriorityCategory ? String(lead.aiPriorityCategory) : "",
      lead?.status ? `status ${lead.status}` : "",
      lead?.folder ? `folder ${lead.folder}` : "",
    ].filter(Boolean);
    return `${index + 1}. ${lead?.name || "Unnamed lead"}${reasonBits.length ? ` — ${reasonBits.join(", ")}` : ""}`;
  });

  return `Based on your current lead rankings, these are the best people to call first:\n${picks.join("\n")}`;
}

function buildCanISendTextsAnswer(supportContext: any, toolResults: Record<string, any>) {
  const twilioConfigured = Boolean(supportContext?.integrations?.twilioConfigured);
  const numberCount = Number(supportContext?.messagingStatus?.numberCount || 0);
  const a2p =
    toolResults?.getA2PStatus?.profile ||
    supportContext?.messagingStatus?.a2p?.profile ||
    null;
  const messagingReady = a2p?.messagingReady === true;
  const recentSmsFailures = Array.isArray(toolResults?.getRecentSmsFailures)
    ? toolResults.getRecentSmsFailures
    : Array.isArray(supportContext?.recentErrors?.smsFailures)
    ? supportContext.recentErrors.smsFailures
    : [];

  if (!twilioConfigured) {
    return "Texting is not ready yet because your Twilio account is not fully configured in CoveCRM. Start by checking your Twilio credentials in Settings.";
  }
  if (numberCount <= 0) {
    return "Texting is blocked right now because there are no active sending numbers on the account. Add or assign a number first.";
  }
  if (!messagingReady) {
    return "Your account has numbers, but texting is not fully ready because A2P approval or messaging readiness is still incomplete. Check your A2P status and messaging service setup in Settings.";
  }
  if (recentSmsFailures.length > 0) {
    const latest = recentSmsFailures[0];
    const detail = [latest?.status, latest?.errorCode, latest?.errorMessage].filter(Boolean).join(" / ");
    return `Texting is generally enabled, but I do see recent SMS failures${detail ? ` (${detail})` : ""}. I’d verify the most recent failed message and your sender setup before sending a larger batch.`;
  }
  return `Yes — texting looks available. Twilio is configured, you have ${numberCount} number${numberCount === 1 ? "" : "s"}, and your A2P messaging status appears ready.`;
}

function buildCanICallAnswer(supportContext: any) {
  const twilioConfigured = Boolean(supportContext?.integrations?.twilioConfigured);
  const numberCount = Number(supportContext?.messagingStatus?.numberCount || 0);

  if (!twilioConfigured) {
    return "Calling is not ready because Twilio is not configured on this account yet.";
  }
  if (numberCount <= 0) {
    return "Calling is blocked right now because there are no active phone numbers on the account.";
  }
  return `Yes — calling appears available. Twilio is configured and the account has ${numberCount} active number${numberCount === 1 ? "" : "s"} to work from.`;
}

function buildMetaAnswer(toolResults: Record<string, any>, supportContext: any) {
  const meta = toolResults?.getMetaStatus || supportContext?.integrations || {};
  if (meta?.connected || supportContext?.integrations?.metaConnected) {
    const recentLeadCount = Number(meta?.recentLeadCount || 0);
    return `Facebook appears connected${recentLeadCount ? `, and I can see ${recentLeadCount} recent Meta lead${recentLeadCount === 1 ? "" : "s"}` : ""}.`;
  }
  return "Facebook does not look connected right now. I’m not seeing recent Meta lead activity on the account.";
}

function buildNumbersAnswer(toolResults: Record<string, any>, supportContext: any) {
  const twilio = toolResults?.getTwilioStatus || {};
  const numberCount = Number(twilio?.numberCount ?? supportContext?.messagingStatus?.numberCount ?? 0);
  if (numberCount <= 0) {
    return "Your numbers are not set up yet because I’m not seeing any active phone numbers on the account.";
  }
  const defaultNumberId = twilio?.defaultNumberId;
  return `Your number setup looks mostly in place. I can see ${numberCount} active number${numberCount === 1 ? "" : "s"}${defaultNumberId ? " and a default sending number is set" : ""}.`;
}

function buildA2PAnswer(toolResults: Record<string, any>, supportContext: any) {
  const a2p =
    toolResults?.getA2PStatus?.profile ||
    supportContext?.messagingStatus?.a2p?.profile ||
    null;
  if (!a2p) {
    return "I couldn’t find an A2P profile on the account yet. That usually means registration has not been completed.";
  }
  if (a2p.messagingReady === true) {
    return "Your A2P setup looks approved and messaging-ready.";
  }
  const bits = [a2p.registrationStatus, a2p.applicationStatus, a2p.brandStatus, a2p.lastError]
    .filter(Boolean)
    .map((item) => String(item));
  return `Your A2P setup is not fully approved yet${bits.length ? `. Current details: ${bits.join(" • ")}` : "."}`;
}

function buildImportAnswer(toolResults: Record<string, any>) {
  const importInfo = toolResults?.getRecentImportErrors || {};
  const recentImports = Array.isArray(importInfo?.recentImports) ? importInfo.recentImports : [];
  const recentErrors = Array.isArray(importInfo?.recentErrors) ? importInfo.recentErrors : [];

  if (recentErrors.length > 0) {
    return `I found recent import errors. Start with the newest one: ${String(recentErrors[0]?.message || recentErrors[0] || "Unknown import error")}.`;
  }
  if (recentImports.length > 0) {
    return `I can see recent import activity, but no structured import errors were recorded. If imports are failing, check the source mapping, required fields, and whether the incoming rows have valid phone or email values.`;
  }
  return "I’m not seeing recent import records or structured import errors. If imports are failing, first verify the source connection, column mappings, and that required lead fields are present.";
}

function buildGeneralDeterministicAnswer(
  message: string,
  supportContext: any,
  toolResults: Record<string, any>,
  pageContext?: string
) {
  const lower = String(message || "").toLowerCase();
  if (/(who should i call|who do i call|who should i follow up with|who is hottest|top leads|best lead)/i.test(lower)) {
    return buildWhoToCallAnswer(supportContext);
  }
  if (/(can i send texts|can i text|texting|send sms|sms working)/i.test(lower)) {
    return buildCanISendTextsAnswer(supportContext, toolResults);
  }
  if (/(can i call|calling|make calls|dial out|phone calls)/i.test(lower)) {
    return buildCanICallAnswer(supportContext);
  }
  if (/(facebook connected|meta connected|facebook integration|meta integration)/i.test(lower)) {
    return buildMetaAnswer(toolResults, supportContext);
  }
  if (/(numbers set up|my numbers|phone numbers set up|twilio numbers)/i.test(lower)) {
    return buildNumbersAnswer(toolResults, supportContext);
  }
  if (/(a2p approved|a2p|10dlc|messaging ready)/i.test(lower)) {
    return buildA2PAnswer(toolResults, supportContext);
  }
  if (/(imports failing|import failing|import failed|csv import|google sheets import)/i.test(lower)) {
    return buildImportAnswer(toolResults);
  }

  const numberCount = Number(supportContext?.messagingStatus?.numberCount || 0);
  const folderCount = Array.isArray(supportContext?.folders) ? supportContext.folders.length : 0;
  const recentSmsFailures = Array.isArray(supportContext?.recentErrors?.smsFailures)
    ? supportContext.recentErrors.smsFailures.length
    : 0;
  const summaryParts = [
    pageContext ? `You’re currently on ${pageContext.replace(/_/g, " ")}.` : "",
    `I checked your account context and found ${numberCount} number${numberCount === 1 ? "" : "s"} and ${folderCount} folder${folderCount === 1 ? "" : "s"}.`,
    recentSmsFailures ? `There are ${recentSmsFailures} recent SMS failure${recentSmsFailures === 1 ? "" : "s"} worth reviewing.` : "",
    `For your question, "${firstQuestionLine(message)}", the fastest next step is to verify the relevant setup area in Settings and then retry the workflow.`,
  ].filter(Boolean);
  return summaryParts.join(" ");
}

function fallbackAnswer(
  message: string,
  supportContext: any,
  toolResults: Record<string, any>,
  pageContext?: string
) {
  return buildGeneralDeterministicAnswer(message, supportContext, toolResults, pageContext);
}

async function saveConversationSilently(conversation: any) {
  try {
    if (conversation && typeof conversation.save === "function") {
      await conversation.save();
    }
  } catch {
    // non-fatal
  }
}

function logSupportUsage(details: {
  source: string;
  userEmail?: string | null;
  leadId?: string | null;
  model: string;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
}) {
  console.info("[openai-usage]", {
    source: details.source,
    userEmail: details.userEmail || null,
    leadId: details.leadId || null,
    model: details.model,
    durationMs: details.durationMs,
    promptTokens: details.promptTokens ?? null,
    completionTokens: details.completionTokens ?? null,
    costUsd: details.costUsd ?? null,
  });
}

export async function runHelpAssistant({
  userEmail,
  content,
  conversationId,
  pageContext,
}: HelpAssistantArgs) {
  let conversation: any = null;
  let supportContext: any = null;
  let toolResults: Record<string, any> = {};

  try {
    await mongooseConnect();
    await ensureSupportKnowledgeSeeded();

    conversation =
      (conversationId &&
        (await SupportConversation.findOne({ _id: conversationId, userEmail }))) ||
      (await SupportConversation.create({ userEmail, messages: [] }));

    try {
      conversation.messages.push({ role: "user", content, createdAt: new Date() });
      await saveConversationSilently(conversation);
    } catch {
      // non-fatal
    }

    const [loadedSupportContext, knowledgeDocs] = await Promise.all([
      buildSupportContext(userEmail).catch(() => null),
      SupportKnowledgeDoc.find({}).sort({ updatedAt: -1 }).limit(MAX_KNOWLEDGE_DOCS).lean().catch(() => []),
    ]);

    supportContext = loadedSupportContext || {
      integrations: {
        twilioConfigured: false,
        googleSheetsConnected: false,
        googleCalendarConnected: false,
        metaConnected: false,
      },
      messagingStatus: {
        a2p: null,
        recentSmsFailures: [],
        numberCount: 0,
      },
      campaigns: {
        assignedDripsTotal: 0,
      },
      folders: [],
      recentErrors: {
        smsFailures: [],
        importErrors: [],
      },
      aiFeatures: {},
      leadAssistant: null,
      topLeads: [],
    };

    const apiKey = process.env.OPENAI_API_KEY;
    let answer = "";

    if (apiKey) {
      const client = new OpenAI({ apiKey });
      let response: any = null;
      const promptPayload = buildPromptPayload({
        message: content,
        pageContext,
        supportContext,
        knowledgeDocs,
        history: Array.isArray(conversation?.messages) ? conversation.messages : [],
      });

      try {
        const startedAt = Date.now();
        logSupportPrompt({
          event: "request:start",
          userEmail,
          model: SUPPORT_MODEL,
          totalMessages: 2,
          ...promptPayload.metrics,
          totalPromptCharsCapped: promptPayload.metrics.totalPromptChars > MAX_TOTAL_PROMPT_CHARS,
        });
        response = await client.responses.create({
          model: SUPPORT_MODEL,
          input: [
            {
              role: "system",
              content: [
                "You are CoveCRM Assistant, an in-app AI assistant for agents.",
                "You can inspect the user's CRM account, leads, folders, messaging setup, and AI status.",
                "",
                "Behavior rules:",
                "- When the user asks who to call, who is hottest, which lead is most interested, who to follow up with, or anything lead-related, use REAL lead data from supportContext.leadAssistant and/or the getLeadAssistantSnapshot tool.",
                "- Prefer specific lead names with short reasons like aiPriorityScore, recent updates, folder, or status.",
                "- If there are multiple strong candidates, rank them.",
                "- If the user asks for counts, use the real totals from leadAssistant when available.",
                "- Do NOT recommend call scripts, SMS scripts, rebuttals, or sales talk tracks unless the user explicitly asks for a script.",
                "- Do NOT fall back to generic coaching if real account data is available.",
                "- Be concise, practical, and assistant-like.",
                "- For operational issues, still diagnose clearly and step by step when needed.",
              ].join("\n"),
            },
            {
              role: "user",
              content: JSON.stringify(promptPayload.payload),
            },
          ],
          tools: SUPPORT_TOOL_DEFS.map((tool) => ({
            type: "function" as const,
            name: tool.name,
            description: tool.description,
            strict: true,
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          })),
        });
        const usage = response?.usage || {};
        logSupportUsage({
          source: "lib/ai/support/helpAssistant:first",
          userEmail,
          model: SUPPORT_MODEL,
          durationMs: Date.now() - startedAt,
          promptTokens: usage?.input_tokens,
          completionTokens: usage?.output_tokens,
          costUsd: priceOpenAIUsage({
            model: SUPPORT_MODEL,
            promptTokens: usage?.input_tokens,
            completionTokens: usage?.output_tokens,
          }),
        });
      } catch {
        response = null;
      }

      const functionCalls = Array.isArray(response?.output)
        ? response.output.filter((item: any) => item?.type === "function_call" && SUPPORT_TOOL_RUNNERS[item.name])
        : [];

      const toolOutputs = await Promise.all(
        functionCalls.map(async (item: any) => {
          try {
            const result = await SUPPORT_TOOL_RUNNERS[item.name](userEmail);
            toolResults[item.name] = result;
            return {
              type: "function_call_output" as const,
              call_id: item.call_id,
              output: JSON.stringify(result),
            };
          } catch (err: any) {
            const failure = { error: safeErrorMessage(err) };
            toolResults[item.name] = failure;
            return {
              type: "function_call_output" as const,
              call_id: item.call_id,
              output: JSON.stringify(failure),
            };
          }
        })
      );

      let finalResponse: any = response;
      if (toolOutputs.length > 0 && response?.id) {
        try {
          const trimmedToolOutputs = toolOutputs.map((item) => ({
            ...item,
            output: truncateText(item.output, MAX_TOOL_RESULT_CHARS),
          }));
          const toolContextChars = jsonChars(trimmedToolOutputs);
          const startedAt = Date.now();
          logSupportPrompt({
            event: "request:followup",
            userEmail,
            model: SUPPORT_MODEL,
            totalMessages: trimmedToolOutputs.length,
            toolContextChars,
            toolResultCount: trimmedToolOutputs.length,
            toolContextTruncated: trimmedToolOutputs.some((item, index) => item.output.length !== toolOutputs[index].output.length),
          });
          finalResponse = await client.responses.create({
            model: SUPPORT_MODEL,
            previous_response_id: response.id,
            input: trimmedToolOutputs,
          });
          const usage = finalResponse?.usage || {};
          logSupportUsage({
            source: "lib/ai/support/helpAssistant:followup",
            userEmail,
            model: SUPPORT_MODEL,
            durationMs: Date.now() - startedAt,
            promptTokens: usage?.input_tokens,
            completionTokens: usage?.output_tokens,
            costUsd: priceOpenAIUsage({
              model: SUPPORT_MODEL,
              promptTokens: usage?.input_tokens,
              completionTokens: usage?.output_tokens,
            }),
          });
        } catch {
          finalResponse = response;
        }
      }

      answer = String(finalResponse?.output_text || "").trim();
      if (!answer) {
        if (!Object.keys(toolResults).length) {
          toolResults = await runSupportToolsSafely(userEmail);
        }
        answer = fallbackAnswer(content, supportContext, toolResults, pageContext);
      }
    } else {
      toolResults = await runSupportToolsSafely(userEmail);
      answer = fallbackAnswer(content, supportContext, toolResults, pageContext);
    }

    if (!answer) {
      if (!Object.keys(toolResults).length) {
        toolResults = await runSupportToolsSafely(userEmail);
      }
      answer = fallbackAnswer(content, supportContext, toolResults, pageContext);
    }

    try {
      conversation?.messages?.push({ role: "assistant", content: answer, createdAt: new Date() });
      await saveConversationSilently(conversation);
    } catch {
      // non-fatal
    }

    return {
      conversationId: String(conversation?._id || ""),
      answer: answer || fallbackAnswer(content, supportContext, toolResults, pageContext),
      history: Array.isArray(conversation?.messages) ? conversation.messages : [],
      toolResults,
      supportContext,
    };
  } catch (err: any) {
    if (!supportContext) {
      supportContext = null;
    }
    if (!Object.keys(toolResults).length) {
      toolResults = await runSupportToolsSafely(userEmail).catch(() => ({}));
    }
    const answer = buildGeneralDeterministicAnswer(
      content,
      supportContext || {
        integrations: { twilioConfigured: false, metaConnected: false },
        messagingStatus: { numberCount: 0 },
        folders: [],
        recentErrors: { smsFailures: [], importErrors: [] },
        topLeads: [],
      },
      toolResults,
      pageContext
    );
    try {
      if (conversation) {
        conversation.messages.push({ role: "assistant", content: answer, createdAt: new Date() });
        await saveConversationSilently(conversation);
      }
    } catch {
      // non-fatal
    }
    return {
      conversationId: String(conversation?._id || ""),
      answer: answer || "I checked your account and the next best step is to review your setup in Settings and retry the action.",
      history: Array.isArray(conversation?.messages) ? conversation.messages : [],
      toolResults,
      supportContext,
      degraded: true,
      error: safeErrorMessage(err),
    };
  }
}
