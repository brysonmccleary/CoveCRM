export type AiProviderName = "openai" | "kimi" | "deepseek";

export type AiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiProviderChatRequest = {
  messages: AiChatMessage[];
  temperature?: number;
  maxTokens?: number;
};

export type AiProviderChatResult = {
  ok: boolean;
  provider: AiProviderName;
  content?: string;
  error?: string;
  errorCode?: string;
  status?: number;
  model?: string;
};

export type AiProviderHealth = {
  configured: boolean;
  baseUrl?: string;
  model?: string;
};
