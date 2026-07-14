// lib/ai/providers/textCompletionWithFallback.ts
// Generic text-completion wrapper: tries Kimi first, and on ANY failure
// (missing/invalid key, timeout, non-2xx, empty content, or — when JSON
// mode was requested — content that isn't actually valid JSON) falls back
// to OpenAI so a response is never lost. Logs which provider actually
// served each response for later cost tracking.
//
// Built on the existing callKimiProvider/callOpenAIChatProvider adapters —
// no new HTTP client, no new retry logic, just the fallback decision.
import { callKimiProvider } from "./kimiProvider";
import { callOpenAIChatProvider } from "./openaiProvider";
import type { AiProviderChatRequest, AiProviderName, AiProviderUsage } from "./types";

export type TextCompletionOptions = AiProviderChatRequest & {
  /** Short tag identifying the call site, e.g. "generateCallCoachReport" — shows up in every log line. */
  site: string;
  /** OpenAI model to use specifically for the fallback call. Defaults to the provider's own default (gpt-4.1-mini) if omitted — pass this explicitly to match a site's existing quality bar. */
  openaiModel?: string;
};

export type TextCompletionResult = {
  content: string;
  provider: AiProviderName;
  model?: string;
  usage?: AiProviderUsage;
};

function isAcceptableContent(content: string | undefined, responseFormat?: "json_object"): content is string {
  if (!content) return false;
  if (responseFormat === "json_object") {
    try {
      JSON.parse(content);
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

export async function completeTextWithKimiFallback(options: TextCompletionOptions): Promise<TextCompletionResult> {
  const { site, openaiModel, ...request } = options;

  const kimiResult = await callKimiProvider(request);
  if (kimiResult.ok && isAcceptableContent(kimiResult.content, request.responseFormat)) {
    console.info("[ai-provider-fallback] served by kimi", { site, model: kimiResult.model });
    return { content: kimiResult.content, provider: "kimi", model: kimiResult.model, usage: kimiResult.usage };
  }

  console.warn("[ai-provider-fallback] kimi unavailable, falling back to openai", {
    site,
    reason: !kimiResult.ok ? kimiResult.errorCode || kimiResult.error : "invalid_or_unparseable_content",
  });

  const openaiResult = await callOpenAIChatProvider(request, openaiModel);
  if (!openaiResult.ok || !isAcceptableContent(openaiResult.content, request.responseFormat)) {
    // Both providers failed — surface this to the caller. Every current call
    // site already has its own try/catch around the AI call it's replacing,
    // so this throw is caught there exactly as an OpenAI error was before.
    console.error("[ai-provider-fallback] openai fallback also failed", { site, error: openaiResult.error });
    throw new Error(openaiResult.error || "AI provider request failed");
  }

  console.info("[ai-provider-fallback] served by openai (fallback)", { site, model: openaiResult.model });
  return { content: openaiResult.content, provider: "openai", model: openaiResult.model, usage: openaiResult.usage };
}
