import mongooseConnect from "@/lib/mongooseConnect";
import SupportConversation from "@/models/SupportConversation";
import { buildSupportContext } from "./supportContext";
import { runHelpAssistant } from "./helpAssistant";
import { classifySupportTask } from "./supportTaskClassifier";
import { callDeepSeekProvider } from "../providers/deepseekProvider";
import { callKimiProvider } from "../providers/kimiProvider";
import type { AiProviderChatResult } from "../providers/types";

type SupportAiRouterArgs = {
  userEmail: string;
  message: string;
  conversationId?: string;
  pageContext?: string;
};

type SupportAssistantResult = {
  conversationId: string;
  answer: string;
  history: any[];
  toolResults: Record<string, any>;
  supportContext: any;
  [key: string]: any;
};

export function isSupportAiRouterEnabled() {
  return String(process.env.AI_SUPPORT_ROUTER_ENABLED || "").toLowerCase() === "true";
}

function truncateForProvider(value: any, maxChars: number) {
  const text = String(value || "").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function buildProviderMessages(args: {
  message: string;
  pageContext?: string;
  supportContext: any;
  task: string;
}) {
  const compactContext = truncateForProvider(JSON.stringify(args.supportContext || {}), 5000);
  return [
    {
      role: "system" as const,
      content: [
        "You are CoveCRM Assistant inside a CRM for insurance agents.",
        "This provider route is foundation-only, read-only, and must not perform actions.",
        "Do not send emails, resubmit A2P, mutate CRM data, book calls, or trigger external systems.",
        "Be concise and practical. If exact account data is needed but missing, say what to verify.",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        task: args.task,
        pageContext: truncateForProvider(args.pageContext, 160),
        message: truncateForProvider(args.message, 1200),
        supportContext: compactContext,
      }),
    },
  ];
}

async function saveProviderConversation(args: {
  userEmail: string;
  conversationId?: string;
  userMessage: string;
  answer: string;
}) {
  await mongooseConnect();
  const conversation =
    (args.conversationId &&
      (await SupportConversation.findOne({ _id: args.conversationId, userEmail: args.userEmail }))) ||
    (await SupportConversation.create({ userEmail: args.userEmail, messages: [] }));

  conversation.messages.push({ role: "user", content: args.userMessage, createdAt: new Date() });
  conversation.messages.push({ role: "assistant", content: args.answer, createdAt: new Date() });
  await conversation.save();
  return conversation;
}

async function providerResultToAssistantResult(args: {
  providerResult: AiProviderChatResult;
  userEmail: string;
  message: string;
  conversationId?: string;
  supportContext: any;
}): Promise<SupportAssistantResult | null> {
  const answer = String(args.providerResult.content || "").trim();
  if (!args.providerResult.ok || !answer) return null;

  const conversation = await saveProviderConversation({
    userEmail: args.userEmail,
    conversationId: args.conversationId,
    userMessage: args.message,
    answer,
  });

  return {
    conversationId: String(conversation?._id || ""),
    answer,
    history: Array.isArray(conversation?.messages) ? conversation.messages : [],
    toolResults: {
      aiRouter: {
        provider: args.providerResult.provider,
        model: args.providerResult.model || "",
        foundationOnly: true,
      },
    },
    supportContext: args.supportContext,
  };
}

// Safe additive router. When disabled, missing provider credentials, or provider
// errors occur, this immediately falls back to the existing support assistant.
// The current OpenAI Responses API tool loop remains inside runHelpAssistant.
export async function runSupportAiRouter({
  userEmail,
  message,
  conversationId,
  pageContext,
}: SupportAiRouterArgs): Promise<SupportAssistantResult> {
  const fallback = () =>
    runHelpAssistant({
      userEmail,
      content: message,
      conversationId,
      pageContext,
    }) as Promise<SupportAssistantResult>;

  if (!isSupportAiRouterEnabled()) {
    return fallback();
  }

  const classification = classifySupportTask(message, pageContext);
  if (classification.route !== "kimi" && classification.route !== "deepseek") {
    return fallback();
  }

  try {
    const supportContext = await buildSupportContext(userEmail).catch(() => null);
    const providerMessages = buildProviderMessages({
      message,
      pageContext,
      supportContext,
      task: classification.task,
    });

    const providerResult =
      classification.route === "kimi"
        ? await callKimiProvider({ messages: providerMessages, temperature: 0.2, maxTokens: 900 })
        : await callDeepSeekProvider({ messages: providerMessages, temperature: 0.2, maxTokens: 900 });

    if (!providerResult.ok) {
      return fallback();
    }

    const routedResult = await providerResultToAssistantResult({
      providerResult,
      userEmail,
      message,
      conversationId,
      supportContext,
    });

    return routedResult || fallback();
  } catch {
    return fallback();
  }
}

