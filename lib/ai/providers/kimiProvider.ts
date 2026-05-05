import OpenAI from "openai";
import type { AiProviderChatRequest, AiProviderChatResult, AiProviderHealth } from "./types";
import { getSecretFingerprint, normalizeProviderApiKey, providerErrorCode, sanitizeProviderError } from "./providerEnv";

const KIMI_BASE_URL = process.env.KIMI_BASE_URL || "https://api.moonshot.ai/v1";
const KIMI_MODEL = process.env.KIMI_MODEL || "kimi-k2";

export function getKimiProviderHealth(): AiProviderHealth {
  return {
    configured: Boolean(normalizeProviderApiKey(process.env.KIMI_API_KEY)),
    baseUrl: KIMI_BASE_URL,
    model: KIMI_MODEL,
  };
}

export function getKimiEnvDiagnostics() {
  const fingerprint = getSecretFingerprint(process.env.KIMI_API_KEY);
  return {
    hasKimiApiKey: fingerprint.hasKey,
    keyLength: fingerprint.keyLength,
    keyPreview: fingerprint.keyPreview,
    baseUrl: KIMI_BASE_URL,
    model: KIMI_MODEL,
  };
}

// OpenAI-compatible Moonshot/Kimi adapter. This is intentionally text-only and
// read-only; support tool execution stays in the existing OpenAI fallback path.
export async function callKimiProvider(
  request: AiProviderChatRequest
): Promise<AiProviderChatResult> {
  const apiKey = normalizeProviderApiKey(process.env.KIMI_API_KEY);
  if (!apiKey) {
    return { ok: false, provider: "kimi", error: "provider_not_configured", errorCode: "provider_not_configured", model: KIMI_MODEL };
  }

  try {
    const client = new OpenAI({
      apiKey,
      baseURL: KIMI_BASE_URL,
    });
    const response = await client.chat.completions.create({
      model: KIMI_MODEL,
      messages: request.messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 900,
    });

    return {
      ok: true,
      provider: "kimi",
      model: KIMI_MODEL,
      content: String(response.choices?.[0]?.message?.content || "").trim(),
    };
  } catch (err: any) {
    return {
      ok: false,
      provider: "kimi",
      model: KIMI_MODEL,
      status: err?.status,
      error: sanitizeProviderError(err),
      errorCode: providerErrorCode(err),
    };
  }
}
