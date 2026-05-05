import OpenAI from "openai";
import type { AiProviderChatRequest, AiProviderChatResult, AiProviderHealth } from "./types";
import { getSecretFingerprint, normalizeProviderApiKey, providerErrorCode, sanitizeProviderError } from "./providerEnv";

const OPENAI_MODEL = process.env.OPENAI_SUPPORT_MODEL || "gpt-4.1-mini";

export function getOpenAIProviderHealth(): AiProviderHealth {
  return {
    configured: Boolean(normalizeProviderApiKey(process.env.OPENAI_API_KEY)),
  };
}

export function getOpenAIEnvDiagnostics() {
  const fingerprint = getSecretFingerprint(process.env.OPENAI_API_KEY);
  return {
    hasOpenAiApiKey: fingerprint.hasKey,
    keyLength: fingerprint.keyLength,
    keyPreview: fingerprint.keyPreview,
    hasOpenAiSupportModel: Boolean(String(process.env.OPENAI_SUPPORT_MODEL || "").trim()),
    openAiSupportModel: process.env.OPENAI_SUPPORT_MODEL || null,
  };
}

// Foundation-only chat-completions adapter. The existing support assistant still
// owns the Responses API tool loop and remains the default/fallback path.
export async function callOpenAIChatProvider(
  request: AiProviderChatRequest
): Promise<AiProviderChatResult> {
  const apiKey = normalizeProviderApiKey(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    return { ok: false, provider: "openai", error: "provider_not_configured", errorCode: "provider_not_configured", model: OPENAI_MODEL };
  }

  try {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages: request.messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 900,
    });

    return {
      ok: true,
      provider: "openai",
      model: OPENAI_MODEL,
      content: String(response.choices?.[0]?.message?.content || "").trim(),
    };
  } catch (err: any) {
    return {
      ok: false,
      provider: "openai",
      model: OPENAI_MODEL,
      status: err?.status,
      error: sanitizeProviderError(err),
      errorCode: providerErrorCode(err),
    };
  }
}
