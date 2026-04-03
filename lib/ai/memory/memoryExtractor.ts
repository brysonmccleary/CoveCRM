import OpenAI from "openai";
import mongooseConnect from "@/lib/mongooseConnect";
import LeadMemoryFact from "@/models/LeadMemoryFact";

const MEMORY_KEYS = [
  "preferred_contact_time",
  "preferred_channel",
  "spouse_name",
  "existing_coverage",
  "objection",
  "callback_time",
  "appointment_intent",
  "sentiment",
] as const;

type ExtractedFact = {
  key: (typeof MEMORY_KEYS)[number];
  value: string;
  confidence: number;
};

function heuristicExtract(text: string): ExtractedFact[] {
  const lowered = text.toLowerCase();
  const facts: ExtractedFact[] = [];
  if (/call me (tomorrow|later|after work|after \d)/i.test(text)) {
    facts.push({ key: "preferred_contact_time", value: RegExp.lastMatch, confidence: 0.55 });
  }
  if (/text me/i.test(text)) facts.push({ key: "preferred_channel", value: "sms", confidence: 0.7 });
  if (/call me/i.test(text)) facts.push({ key: "preferred_channel", value: "call", confidence: 0.7 });
  const spouse = text.match(/(?:wife|husband|spouse)\s+(?:is\s+)?([A-Z][a-z]+)/);
  if (spouse?.[1]) facts.push({ key: "spouse_name", value: spouse[1], confidence: 0.6 });
  if (/already have|existing coverage|covered through/i.test(lowered)) {
    facts.push({ key: "existing_coverage", value: "has existing coverage", confidence: 0.65 });
  }
  if (/too expensive|not interested|busy|already covered/i.test(lowered)) {
    facts.push({ key: "objection", value: RegExp.lastMatch, confidence: 0.7 });
  }
  const callback = text.match(/(call|text)\s+me\s+(?:back\s+)?(.+)/i);
  if (callback?.[2]) facts.push({ key: "callback_time", value: callback[2].slice(0, 80), confidence: 0.6 });
  if (/book|schedule|appointment|available/i.test(lowered)) {
    facts.push({ key: "appointment_intent", value: "interested", confidence: 0.6 });
  }
  if (/angry|upset|frustrated|annoyed/i.test(lowered)) {
    facts.push({ key: "sentiment", value: "negative", confidence: 0.6 });
  } else if (/thanks|thank you|sounds good|great/i.test(lowered)) {
    facts.push({ key: "sentiment", value: "positive", confidence: 0.6 });
  }
  return facts;
}

async function extractWithOpenAI(text: string, sourceType: string): Promise<ExtractedFact[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model: "gpt-5-mini",
    input: [
      {
        role: "system",
        content:
          "Extract structured lead memory facts as JSON. Return only JSON array. Keys allowed: preferred_contact_time, preferred_channel, spouse_name, existing_coverage, objection, callback_time, appointment_intent, sentiment.",
      },
      {
        role: "user",
        content: `sourceType=${sourceType}\ntext=${text}`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "lead_memory_facts",
        schema: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              key: { type: "string", enum: [...MEMORY_KEYS] },
              value: { type: "string" },
              confidence: { type: "number" },
            },
            required: ["key", "value", "confidence"],
          },
        },
      },
    },
  });

  const raw = response.output_text || "[]";
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item) => MEMORY_KEYS.includes(item?.key))
    .map((item) => ({
      key: item.key,
      value: String(item.value || "").trim(),
      confidence: Number(item.confidence || 0),
    }))
    .filter((item) => item.value);
}

export async function extractLeadMemory(
  userEmail: string,
  leadId: string,
  text: string,
  sourceType: string,
  sourceEventId?: string
) {
  await mongooseConnect();
  const aiFacts = await extractWithOpenAI(text, sourceType).catch(() => []);
  const facts = aiFacts.length ? aiFacts : heuristicExtract(text);

  for (const fact of facts) {
    await LeadMemoryFact.findOneAndUpdate(
      {
        userEmail,
        leadId,
        key: fact.key,
        status: "active",
      },
      {
        $set: {
          value: fact.value,
          confidence: fact.confidence,
          sourceEventId: sourceEventId || undefined,
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  return facts;
}
