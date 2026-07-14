import { callKimiProvider } from "@/lib/ai/providers/kimiProvider";
import { callOpenAIChatProvider } from "@/lib/ai/providers/openaiProvider";
import { completeTextWithKimiFallback } from "@/lib/ai/providers/textCompletionWithFallback";

jest.mock("@/lib/ai/providers/kimiProvider", () => ({ callKimiProvider: jest.fn() }));
jest.mock("@/lib/ai/providers/openaiProvider", () => ({ callOpenAIChatProvider: jest.fn() }));

const mockedKimi = callKimiProvider as jest.Mock;
const mockedOpenAI = callOpenAIChatProvider as jest.Mock;

const MESSAGES = [{ role: "user" as const, content: "hi" }];

describe("completeTextWithKimiFallback", () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, "info").mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("Kimi success path: returns Kimi's content, never calls OpenAI, logs which provider served it", async () => {
    mockedKimi.mockResolvedValue({
      ok: true,
      provider: "kimi",
      model: "kimi-k2",
      content: "Kimi's answer",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });

    const result = await completeTextWithKimiFallback({ site: "test-site", messages: MESSAGES });

    expect(result).toEqual({ content: "Kimi's answer", provider: "kimi", model: "kimi-k2", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } });
    expect(mockedOpenAI).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("[ai-provider-fallback] served by kimi", expect.objectContaining({ site: "test-site", model: "kimi-k2" }));
  });

  test("Kimi failure (bad key / error): falls back to OpenAI automatically, no dropped response", async () => {
    mockedKimi.mockResolvedValue({ ok: false, provider: "kimi", error: "invalid api key", errorCode: "provider_auth_failed" });
    mockedOpenAI.mockResolvedValue({ ok: true, provider: "openai", model: "gpt-4o", content: "OpenAI's answer" });

    const result = await completeTextWithKimiFallback({ site: "test-site", messages: MESSAGES, openaiModel: "gpt-4o" });

    expect(result.content).toBe("OpenAI's answer");
    expect(result.provider).toBe("openai");
    expect(mockedOpenAI).toHaveBeenCalledWith(expect.objectContaining({ messages: MESSAGES }), "gpt-4o");
    expect(warnSpy).toHaveBeenCalledWith(
      "[ai-provider-fallback] kimi unavailable, falling back to openai",
      expect.objectContaining({ site: "test-site", reason: "provider_auth_failed" }),
    );
    expect(logSpy).toHaveBeenCalledWith("[ai-provider-fallback] served by openai (fallback)", expect.objectContaining({ site: "test-site", model: "gpt-4o" }));
  });

  test("Kimi timeout/network error still falls back correctly", async () => {
    mockedKimi.mockResolvedValue({ ok: false, provider: "kimi", error: "timeout", errorCode: "provider_error" });
    mockedOpenAI.mockResolvedValue({ ok: true, provider: "openai", model: "gpt-4o", content: "fallback ok" });

    const result = await completeTextWithKimiFallback({ site: "test-site", messages: MESSAGES });

    expect(result.provider).toBe("openai");
    expect(result.content).toBe("fallback ok");
  });

  test("Kimi returns ok:true but empty content — treated as a failure, falls back", async () => {
    mockedKimi.mockResolvedValue({ ok: true, provider: "kimi", model: "kimi-k2", content: "" });
    mockedOpenAI.mockResolvedValue({ ok: true, provider: "openai", model: "gpt-4o", content: "real answer" });

    const result = await completeTextWithKimiFallback({ site: "test-site", messages: MESSAGES });

    expect(result.provider).toBe("openai");
    expect(result.content).toBe("real answer");
  });

  test("JSON mode: Kimi returns ok:true with unparseable content — treated as a failure, falls back to OpenAI", async () => {
    mockedKimi.mockResolvedValue({ ok: true, provider: "kimi", model: "kimi-k2", content: "not valid json {{{" });
    mockedOpenAI.mockResolvedValue({ ok: true, provider: "openai", model: "gpt-4o", content: '{"score": 8}' });

    const result = await completeTextWithKimiFallback({
      site: "test-site",
      messages: MESSAGES,
      responseFormat: "json_object",
    });

    expect(result.provider).toBe("openai");
    expect(result.content).toBe('{"score": 8}');
    expect(warnSpy).toHaveBeenCalledWith(
      "[ai-provider-fallback] kimi unavailable, falling back to openai",
      expect.objectContaining({ reason: "invalid_or_unparseable_content" }),
    );
  });

  test("JSON mode: Kimi returns valid JSON — succeeds via Kimi, no fallback needed", async () => {
    mockedKimi.mockResolvedValue({ ok: true, provider: "kimi", model: "kimi-k2", content: '{"score": 9}' });

    const result = await completeTextWithKimiFallback({
      site: "test-site",
      messages: MESSAGES,
      responseFormat: "json_object",
    });

    expect(result.provider).toBe("kimi");
    expect(mockedOpenAI).not.toHaveBeenCalled();
  });

  test("both providers fail: throws instead of silently returning nothing, so the caller's own try/catch handles it", async () => {
    mockedKimi.mockResolvedValue({ ok: false, provider: "kimi", error: "kimi down" });
    mockedOpenAI.mockResolvedValue({ ok: false, provider: "openai", error: "openai also down" });

    await expect(completeTextWithKimiFallback({ site: "test-site", messages: MESSAGES })).rejects.toThrow("openai also down");
    expect(errorSpy).toHaveBeenCalledWith("[ai-provider-fallback] openai fallback also failed", expect.objectContaining({ site: "test-site" }));
  });

  test("openaiModel is passed through to the OpenAI fallback call specifically, not to Kimi", async () => {
    mockedKimi.mockResolvedValue({ ok: false, provider: "kimi", error: "down" });
    mockedOpenAI.mockResolvedValue({ ok: true, provider: "openai", model: "gpt-4o", content: "ok" });

    await completeTextWithKimiFallback({ site: "test-site", messages: MESSAGES, openaiModel: "gpt-4o" });

    // Kimi's own request never carries an OpenAI model string.
    const kimiArg = mockedKimi.mock.calls[0][0];
    expect(kimiArg.model).toBeUndefined();
    expect(mockedOpenAI).toHaveBeenCalledWith(expect.anything(), "gpt-4o");
  });
});
