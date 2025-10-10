// /lib/billing/openaiPricing.ts
/**
 * Compute raw OpenAI vendor cost in USD for a chat/completions response.
 * Uses env-configurable per-1K token prices per model.
 *
 * Set envs like:
 *   OPENAI_PRICE_GPT_4O_MINI_INPUT_PER_1K=0.15
 *   OPENAI_PRICE_GPT_4O_MINI_OUTPUT_PER_1K=0.60
 *   OPENAI_PRICE_DEFAULT_INPUT_PER_1K=0.10
 *   OPENAI_PRICE_DEFAULT_OUTPUT_PER_1K=0.40
 */
const num = (v?: string) => (v ? Number(v) : NaN);

function per1k(model: string, kind: "input" | "output") {
  const keyModel = model.replace(/[\W_]+/g, "_").toUpperCase(); // gpt-4o-mini -> GPT_4O_MINI
  const envKey = `OPENAI_PRICE_${keyModel}_${kind.toUpperCase()}_PER_1K`;
  const vModel = num(process.env[envKey]);
  if (Number.isFinite(vModel)) return vModel!;

  const vDefault = num(process.env[`OPENAI_PRICE_DEFAULT_${kind.toUpperCase()}_PER_1K`]);
  return Number.isFinite(vDefault) ? vDefault! : 0; // safe default: zero
}

export function priceOpenAIUsage(opts: {
  model: string;
  promptTokens?: number;
  completionTokens?: number;
}) {
  const inputRate = per1k(opts.model, "input");
  const outputRate = per1k(opts.model, "output");
  const inCost = (opts.promptTokens || 0) / 1000 * inputRate;
  const outCost = (opts.completionTokens || 0) / 1000 * outputRate;
  const total = inCost + outCost;
  return Math.max(0, Number.isFinite(total) ? total : 0);
}
