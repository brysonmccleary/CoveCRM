// lib/ai/aiCallContext.ts
import dbConnect from "@/lib/dbConnect";
import AICallSession from "@/models/AICallSession";
import User from "@/models/User";
import Lead from "@/models/Lead";

/**
 * Voice profiles keyed by AICallSession.voiceKey
 * - aiName: the name the AI should use ("Hi, this is Sophia...")
 * - openAiVoiceId: placeholder for your OpenAI Realtime voice ID
 * - style: extra description for the system prompt
 */
export const VOICE_PROFILES: Record<
  string,
  {
    aiName: string;
    openAiVoiceId: string;
    style: string;
  }
> = {
  // Example profiles — you can adjust the keys to match your existing voiceKey values
  female_confident: {
    aiName: "Sophia",
    openAiVoiceId: "alloy", // TODO: replace with your actual OpenAI voice id
    style: "confident, upbeat, professional, energetic but not pushy",
  },
  male_calm: {
    aiName: "James",
    openAiVoiceId: "verse", // TODO: replace with your actual OpenAI voice id
    style: "calm, reassuring, consultative, focused on listening",
  },
  neutral_friendly: {
    aiName: "Alex",
    openAiVoiceId: "alloy",
    style: "friendly, neutral tone, clear and easy to understand",
  },
};

/**
 * Normalized call context for the AI brain.
 * This is what your AI WebSocket server / Realtime agent will use to build
 * the system prompt and tools.
 */
export type AICallContext = {
  userEmail: string;
  sessionId: string;
  leadId: string;

  // Agent
  agentName: string;
  agentTimeZone: string;

  // Lead
  clientFirstName: string;
  clientLastName: string;
  clientState?: string;
  clientPhone?: string;
  clientEmail?: string;
  clientNotes?: string;

  // Script + voice
  scriptKey: string;
  voiceKey: string;
  voiceProfile: {
    aiName: string;
    openAiVoiceId: string;
    style: string;
  };

  // Raw docs if you need extras in the future
  raw: {
    session: any;
    user: any;
    lead: any;
  };
};

/**
 * Build full AI call context from sessionId + leadId.
 * - Multi-tenant safe (derives userEmail from AICallSession)
 * - Pulls User + Lead
 * - Normalizes agent/lead names
 * - Attaches the voice profile with AI name
 */
export async function buildAICallContext(
  sessionId: string,
  leadId: string
): Promise<AICallContext> {
  await dbConnect();

  const session = await AICallSession.findById(sessionId);
  if (!session) {
    throw new Error("AICallSession not found");
  }

  const userEmail: string | undefined = (session as any).userEmail;
  if (!userEmail) {
    throw new Error("AICallSession missing userEmail");
  }

  const user = await User.findOne({ email: userEmail });
  if (!user) {
    throw new Error("User not found for session");
  }

  const lead = await Lead.findOne({
    _id: leadId,
    $or: [{ userEmail }, { ownerEmail: userEmail }, { user: userEmail }],
  });
  if (!lead) {
    throw new Error("Lead not found or does not belong to this user");
  }

  // Agent display name + timezone
  const agentName =
    (user as any).name ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    String(userEmail).split("@")[0];

  const agentTimeZone =
    (user as any).bookingSettings?.timezone ||
    (user as any).timezone ||
    "America/Los_Angeles";

  // Lead normalization
  const firstName =
    (lead as any).firstName ||
    (lead as any)["First Name"] ||
    (lead as any).First ||
    "";
  const lastName =
    (lead as any).lastName ||
    (lead as any)["Last Name"] ||
    (lead as any).Last ||
    "";
  const state = (lead as any).state || (lead as any).State || "";
  const phone = (lead as any).phone || (lead as any).Phone || "";
  const email = (lead as any).email || (lead as any).Email || "";
  const notes =
    (lead as any).Notes ||
    (lead as any).notes ||
    (lead as any).note ||
    "";

  const scriptKey = (session as any).scriptKey;
  const voiceKey = (session as any).voiceKey;

  const voiceProfile =
    VOICE_PROFILES[voiceKey] ||
    VOICE_PROFILES["neutral_friendly"] || {
      aiName: "Alex",
      openAiVoiceId: "alloy",
      style: "friendly, neutral tone",
    };

  return {
    userEmail,
    sessionId: String(session._id),
    leadId: String(lead._id),

    agentName,
    agentTimeZone,

    clientFirstName: String(firstName || "").trim(),
    clientLastName: String(lastName || "").trim(),
    clientState: state || undefined,
    clientPhone: phone || undefined,
    clientEmail: email || undefined,
    clientNotes: notes || undefined,

    scriptKey,
    voiceKey,
    voiceProfile,

    raw: {
      session,
      user,
      lead,
    },
  };
}
