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
      SupportKnowledgeDoc.find({}).sort({ updatedAt: -1 }).limit(5).lean().catch(() => []),
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

    const promptSupportContext = {
      ...supportContext,
      leadAssistant: supportContext?.leadAssistant
        ? {
            ...supportContext.leadAssistant,
            topLeads: Array.isArray(supportContext?.leadAssistant?.topLeads)
              ? supportContext.leadAssistant.topLeads.slice(0, 10)
              : [],
          }
        : null,
      topLeads: Array.isArray(supportContext?.topLeads) ? supportContext.topLeads.slice(0, 10) : [],
    };

    const apiKey = process.env.OPENAI_API_KEY;
    let answer = "";

    if (apiKey) {
      const client = new OpenAI({ apiKey });
      let response: any = null;

      try {
        const startedAt = Date.now();
        response = await client.responses.create({
          model: "gpt-5-mini",
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
              content: JSON.stringify({
                message: content,
                pageContext: pageContext || "",
                supportContext: promptSupportContext,
                knowledgeDocs: (Array.isArray(knowledgeDocs) ? knowledgeDocs : []).map((doc: any) => ({
                  title: doc.title,
                  category: doc.category,
                  content: doc.content,
                  tags: doc.tags,
                })),
                history: Array.isArray(conversation?.messages) ? conversation.messages.slice(-6) : [],
              }),
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
          model: "gpt-5-mini",
          durationMs: Date.now() - startedAt,
          promptTokens: usage?.input_tokens,
          completionTokens: usage?.output_tokens,
          costUsd: priceOpenAIUsage({
            model: "gpt-5-mini",
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
          const startedAt = Date.now();
          finalResponse = await client.responses.create({
            model: "gpt-5-mini",
            previous_response_id: response.id,
            input: toolOutputs,
          });
          const usage = finalResponse?.usage || {};
          logSupportUsage({
            source: "lib/ai/support/helpAssistant:followup",
            userEmail,
            model: "gpt-5-mini",
            durationMs: Date.now() - startedAt,
            promptTokens: usage?.input_tokens,
            completionTokens: usage?.output_tokens,
            costUsd: priceOpenAIUsage({
              model: "gpt-5-mini",
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
