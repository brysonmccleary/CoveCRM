import OpenAI from "openai";
import type { AiProviderChatRequest, AiProviderChatResult, AiProviderHealth } from "./types";
import { getSecretFingerprint, normalizeProviderApiKey, providerErrorCode, sanitizeProviderError } from "./providerEnv";

const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

export function getDeepSeekProviderHealth(): AiProviderHealth {
  return {
    configured: Boolean(normalizeProviderApiKey(process.env.DEEPSEEK_API_KEY)),
    baseUrl: DEEPSEEK_BASE_URL,
    model: DEEPSEEK_MODEL,
  };
}

export function getDeepSeekEnvDiagnostics() {
  const fingerprint = getSecretFingerprint(process.env.DEEPSEEK_API_KEY);
  return {
    hasDeepSeekApiKey: fingerprint.hasKey,
    keyLength: fingerprint.keyLength,
    keyPreview: fingerprint.keyPreview,
    baseUrl: DEEPSEEK_BASE_URL,
    model: DEEPSEEK_MODEL,
  };
}

// OpenAI-compatible DeepSeek adapter. This foundation route is read-only and
// does not replace the support assistant's existing tool-calling behavior.
export async function callDeepSeekProvider(
  request: AiProviderChatRequest
): Promise<AiProviderChatResult> {
  const apiKey = normalizeProviderApiKey(process.env.DEEPSEEK_API_KEY);
  if (!apiKey) {
    return {
      ok: false,
      provider: "deepseek",
      error: "provider_not_configured",
      errorCode: "provider_not_configured",
      model: DEEPSEEK_MODEL,
    };
  }

  try {
    const client = new OpenAI({
      apiKey,
      baseURL: DEEPSEEK_BASE_URL,
    });
    const response = await client.chat.completions.create({
      model: DEEPSEEK_MODEL,
      messages: request.messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 900,
    });

    return {
      ok: true,
      provider: "deepseek",
      model: DEEPSEEK_MODEL,
      content: String(response.choices?.[0]?.message?.content || "").trim(),
    };
  } catch (err: any) {
    return {
      ok: false,
      provider: "deepseek",
      model: DEEPSEEK_MODEL,
      status: err?.status,
      error: sanitizeProviderError(err),
      errorCode: providerErrorCode(err),
    };
  }
}
