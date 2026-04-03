import OpenAI from "openai";
import mongooseConnect from "@/lib/mongooseConnect";
import SupportConversation from "@/models/SupportConversation";
import SupportKnowledgeDoc from "@/models/SupportKnowledgeDoc";
import { buildSupportContext } from "./supportContext";
import { ensureSupportKnowledgeSeeded } from "./seedSupportKnowledge";
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

function fallbackAnswer(
  message: string,
  supportContext: any,
  toolResults: Record<string, any>,
  pageContext?: string
) {
  return [
    pageContext ? `Current screen: ${pageContext}.` : "",
    `Support context loaded for ${supportContext.folders.length} folders and ${supportContext.messagingStatus.numberCount} numbers.`,
    Object.keys(toolResults).length ? `Diagnostics pulled: ${Object.keys(toolResults).join(", ")}.` : "",
    `Question: ${message}`,
    "OpenAI is unavailable, so this is a diagnostic fallback. Review the returned context and recent errors first, then retry the failing workflow step by step.",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function runHelpAssistant({
  userEmail,
  content,
  conversationId,
  pageContext,
}: HelpAssistantArgs) {
  await mongooseConnect();
  await ensureSupportKnowledgeSeeded();

  const conversation =
    (conversationId &&
      (await SupportConversation.findOne({ _id: conversationId, userEmail }))) ||
    (await SupportConversation.create({ userEmail, messages: [] }));

  conversation.messages.push({ role: "user", content, createdAt: new Date() });

  const [supportContext, knowledgeDocs] = await Promise.all([
    buildSupportContext(userEmail),
    SupportKnowledgeDoc.find({}).sort({ updatedAt: -1 }).limit(8).lean(),
  ]);

  const toolResults: Record<string, any> = {};
  const apiKey = process.env.OPENAI_API_KEY;
  let answer = "";

  if (apiKey) {
    const client = new OpenAI({ apiKey });
    const response = await client.responses.create({
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
            supportContext,
            knowledgeDocs: knowledgeDocs.map((doc) => ({
              title: doc.title,
              category: doc.category,
              content: doc.content,
              tags: doc.tags,
            })),
            history: conversation.messages.slice(-10),
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

    let finalResponse = response;
    const toolOutputs = await Promise.all(
      ((response as any).output || [])
        .filter((item: any) => item?.type === "function_call" && SUPPORT_TOOL_RUNNERS[item.name])
        .map(async (item: any) => {
          try {
            const result = await SUPPORT_TOOL_RUNNERS[item.name](userEmail);
            toolResults[item.name] = result;
            return {
              type: "function_call_output" as const,
              call_id: item.call_id,
              output: JSON.stringify(result),
            };
          } catch (err: any) {
            const failure = { error: err?.message || "Tool failed" };
            toolResults[item.name] = failure;
            return {
              type: "function_call_output" as const,
              call_id: item.call_id,
              output: JSON.stringify(failure),
            };
          }
        })
    );

    if (toolOutputs.length > 0) {
      finalResponse = await client.responses.create({
        model: "gpt-5-mini",
        previous_response_id: (response as any).id,
        input: toolOutputs,
      });
    }

    answer = (finalResponse as any).output_text || "";
  } else {
    for (const toolName of Object.keys(SUPPORT_TOOL_RUNNERS)) {
      toolResults[toolName] = await SUPPORT_TOOL_RUNNERS[toolName](userEmail).catch((err: any) => ({
        error: err?.message || "Tool failed",
      }));
    }
    answer = fallbackAnswer(content, supportContext, toolResults, pageContext);
  }

  conversation.messages.push({ role: "assistant", content: answer, createdAt: new Date() });
  await conversation.save();

  return {
    conversationId: String(conversation._id),
    answer,
    history: conversation.messages,
    toolResults,
    supportContext,
  };
}
