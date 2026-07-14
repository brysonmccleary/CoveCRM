export type AiProviderName = "openai" | "kimi" | "deepseek";

export type AiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiProviderChatRequest = {
  messages: AiChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Requests JSON-mode output when the provider supports it (passed through as response_format). */
  responseFormat?: "json_object";
};

export type AiProviderUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type AiProviderChatResult = {
  ok: boolean;
  provider: AiProviderName;
  content?: string;
  error?: string;
  errorCode?: string;
  status?: number;
  model?: string;
  usage?: AiProviderUsage;
};

export type AiProviderHealth = {
  configured: boolean;
  baseUrl?: string;
  model?: string;
};
