// Direct tests of the new pass-through behavior added to kimiProvider.ts and
// openaiProvider.ts (responseFormat, usage mapping, and openaiProvider's new
// modelOverride argument). The pre-existing not-configured/error paths are
// untouched by this change and already exercised indirectly elsewhere.
const mockCreate = jest.fn();
jest.mock("openai", () => {
  const ctor: any = jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }));
  return ctor;
});

describe("openaiProvider.ts — new pass-through behavior", () => {
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterAll(() => {
    process.env.OPENAI_API_KEY = originalKey;
  });

  test("modelOverride is used instead of OPENAI_SUPPORT_MODEL when provided", async () => {
    const { callOpenAIChatProvider } = require("@/lib/ai/providers/openaiProvider");
    mockCreate.mockResolvedValue({ choices: [{ message: { content: "hi" } }], usage: undefined });

    const result = await callOpenAIChatProvider({ messages: [{ role: "user", content: "x" }] }, "gpt-4o");

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4o" }));
    expect(result.model).toBe("gpt-4o");
  });

  test("omitting modelOverride keeps the existing default behavior unchanged", async () => {
    const { callOpenAIChatProvider } = require("@/lib/ai/providers/openaiProvider");
    mockCreate.mockResolvedValue({ choices: [{ message: { content: "hi" } }] });

    await callOpenAIChatProvider({ messages: [{ role: "user", content: "x" }] });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4.1-mini" }));
  });

  test("responseFormat: json_object is passed through as response_format", async () => {
    const { callOpenAIChatProvider } = require("@/lib/ai/providers/openaiProvider");
    mockCreate.mockResolvedValue({ choices: [{ message: { content: "{}" } }] });

    await callOpenAIChatProvider({ messages: [{ role: "user", content: "x" }], responseFormat: "json_object" }, "gpt-4o");

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ response_format: { type: "json_object" } }));
  });

  test("omitting responseFormat sends no response_format param at all", async () => {
    const { callOpenAIChatProvider } = require("@/lib/ai/providers/openaiProvider");
    mockCreate.mockResolvedValue({ choices: [{ message: { content: "hi" } }] });

    await callOpenAIChatProvider({ messages: [{ role: "user", content: "x" }] });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.response_format).toBeUndefined();
  });

  test("usage is mapped from the OpenAI response", async () => {
    const { callOpenAIChatProvider } = require("@/lib/ai/providers/openaiProvider");
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "hi" } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });

    const result = await callOpenAIChatProvider({ messages: [{ role: "user", content: "x" }] });

    expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
  });
});

describe("kimiProvider.ts — new pass-through behavior", () => {
  const originalKey = process.env.KIMI_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    process.env.KIMI_API_KEY = "test-kimi-key";
  });

  afterAll(() => {
    process.env.KIMI_API_KEY = originalKey;
  });

  test("responseFormat: json_object is passed through as response_format", async () => {
    const { callKimiProvider } = require("@/lib/ai/providers/kimiProvider");
    mockCreate.mockResolvedValue({ choices: [{ message: { content: "{}" } }] });

    await callKimiProvider({ messages: [{ role: "user", content: "x" }], responseFormat: "json_object" });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ response_format: { type: "json_object" } }));
  });

  test("usage is mapped from the Kimi response", async () => {
    const { callKimiProvider } = require("@/lib/ai/providers/kimiProvider");
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "hi" } }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    });

    const result = await callKimiProvider({ messages: [{ role: "user", content: "x" }] });

    expect(result.usage).toEqual({ promptTokens: 20, completionTokens: 10, totalTokens: 30 });
  });

  test("still returns provider_not_configured when KIMI_API_KEY is unset (unchanged existing behavior)", async () => {
    delete process.env.KIMI_API_KEY;
    const { callKimiProvider } = require("@/lib/ai/providers/kimiProvider");

    const result = await callKimiProvider({ messages: [{ role: "user", content: "x" }] });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("provider_not_configured");
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
