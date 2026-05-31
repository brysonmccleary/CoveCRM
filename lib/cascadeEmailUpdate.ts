// lib/cascadeEmailUpdate.ts
// Cascades a user email change to every collection that stores userEmail/ownerEmail/agentEmail
// as a tenant-ownership key. Called from both the API route and the repair script.
//
// DOES NOT update:
// - A2PProfile.email (legal A2P business-contact field; separate Twilio resubmission needed)
// - Affiliate.payoutHistory[].userEmail (historical payout records)
// - SendLock.key (compound string key; TTL-indexed and expires naturally)
// - CompetitorAd.addedBy (not an ownership field; can be "system" or email)
// - PhoneNumber.userId (uses ObjectId, not email)

import mongoose from "mongoose";

// ── model imports ───────────────────────────────────────────────────────────
// All imported lazily so this file can be used from scripts (dotenv) and
// API routes alike; Mongoose deduplicates model registration automatically.
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import Message from "@/models/Message";
import Call from "@/models/Call";
import CallLog from "@/models/CallLog";
import AICallSession from "@/models/AICallSession";
import AICallRecording from "@/models/AICallRecording";
import AISettings from "@/models/AISettings";
import DripEnrollment from "@/models/DripEnrollment";
import DripFolderEnrollment from "@/models/DripFolderEnrollment";
import DripCampaign from "@/models/DripCampaign";
import { LeadAIState } from "@/models/LeadAIState";
import LeadMemoryProfile from "@/models/LeadMemoryProfile";
import LeadMemoryFact from "@/models/LeadMemoryFact";
import LeadOutcomeEvent from "@/models/LeadOutcomeEvent";
import LeadInteractionEvent from "@/models/LeadInteractionEvent";
import LeadAssignment from "@/models/LeadAssignment";
import LeadStage from "@/models/LeadStage";
import LeadSourceStat from "@/models/LeadSourceStat";
import Number from "@/models/Number";
import NumberSpamStatus from "@/models/NumberSpamStatus";
import InboundCall from "@/models/InboundCall";
import TeamMember from "@/models/TeamMember";
import TeamInvite from "@/models/TeamInvite";
import A2PProfile from "@/models/A2PProfile";
import A2PVerification from "@/models/A2PVerification";
import AIAgentScript from "@/models/AIAgentScript";
import AIAgentVoiceProfile from "@/models/AIAgentVoiceProfile";
import MobileVoipDevice from "@/models/MobileVoipDevice";
import MobileDevice from "@/models/MobileDevice";
import FBLeadSubscription from "@/models/FBLeadSubscription";
import FBLeadEntry from "@/models/FBLeadEntry";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import CRMOutcome from "@/models/CRMOutcome";
import AgentEmailAccount from "@/models/AgentEmailAccount";
import CallCoachReport from "@/models/CallCoachReport";
import Mapping from "@/models/Mapping";
import EmailTemplate from "@/models/EmailTemplate";
import EmailSender from "@/models/EmailSender";
import EmailMessage from "@/models/EmailMessage";
import EmailCampaign from "@/models/EmailCampaign";
import EmailSuppression from "@/models/EmailSuppression";
import VoicemailDrop from "@/models/VoicemailDrop";
import ObjectionEntry from "@/models/ObjectionEntry";
import SupportConversation from "@/models/SupportConversation";
import SupportEmailDraft from "@/models/SupportEmailDraft";
import ProspectRecord from "@/models/ProspectRecord";
import ProspectingPlan from "@/models/ProspectingPlan";
import AdMetricsDaily from "@/models/AdMetricsDaily";
import AdActionReport from "@/models/AdActionReport";
import { AiQueuedReply } from "@/models/AiQueuedReply";
import PasswordResetToken from "@/models/PasswordResetToken";
import Booking from "@/models/Booking";
import Funnel from "@/models/Funnel";
import FunnelSubmission from "@/models/FunnelSubmission";
import FollowUpNudge from "@/models/FollowUpNudge";
import AdminAiAuditLog from "@/models/AdminAiAuditLog";
import CodeRegistry from "@/models/CodeRegistry";
import ProvenAd from "@/models/ProvenAd";

export interface CascadeResult {
  field: string;
  model: string;
  matched: number;
  modified: number;
  error?: string;
}

interface CascadeOp {
  model: mongoose.Model<any>;
  name: string;
  filter: Record<string, any>;
  update: Record<string, any>;
}

export async function cascadeEmailUpdateMany(
  oldEmail: string,
  newEmail: string,
): Promise<CascadeResult[]> {
  const ops: CascadeOp[] = [
    // userEmail ownership key
    { model: Lead,               name: "Lead",               filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    // Lead also has legacy ownerEmail
    { model: Lead,               name: "Lead.ownerEmail",    filter: { ownerEmail: oldEmail }, update: { $set: { ownerEmail: newEmail } } },
    { model: Folder,             name: "Folder",             filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: Message,            name: "Message",            filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: Call,               name: "Call",               filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: CallLog,            name: "CallLog",            filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: AICallSession,      name: "AICallSession",      filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: AICallRecording,    name: "AICallRecording",    filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: AISettings,         name: "AISettings",         filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: DripEnrollment,     name: "DripEnrollment",     filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: DripFolderEnrollment, name: "DripFolderEnrollment", filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: DripCampaign,       name: "DripCampaign",       filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: LeadAIState,        name: "LeadAIState",        filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: LeadMemoryProfile,  name: "LeadMemoryProfile",  filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: LeadMemoryFact,     name: "LeadMemoryFact",     filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: LeadOutcomeEvent,   name: "LeadOutcomeEvent",   filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: LeadInteractionEvent, name: "LeadInteractionEvent", filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: LeadAssignment,     name: "LeadAssignment",     filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: LeadStage,          name: "LeadStage",          filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: LeadSourceStat,     name: "LeadSourceStat",     filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: Number,             name: "Number",             filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: NumberSpamStatus,   name: "NumberSpamStatus",   filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    // ownerEmail collections
    { model: InboundCall,        name: "InboundCall",        filter: { ownerEmail: oldEmail }, update: { $set: { ownerEmail: newEmail } } },
    { model: TeamMember,         name: "TeamMember",         filter: { ownerEmail: oldEmail }, update: { $set: { ownerEmail: newEmail } } },
    { model: TeamInvite,         name: "TeamInvite",         filter: { ownerEmail: oldEmail }, update: { $set: { ownerEmail: newEmail } } },
    { model: CodeRegistry,       name: "CodeRegistry",       filter: { ownerEmail: oldEmail }, update: { $set: { ownerEmail: newEmail } } },
    // A2PProfile: update ownership key ONLY, not A2PProfile.email (legal contact)
    { model: A2PProfile,         name: "A2PProfile.userEmail", filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: A2PVerification,    name: "A2PVerification",    filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: AIAgentScript,      name: "AIAgentScript",      filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: AIAgentVoiceProfile, name: "AIAgentVoiceProfile", filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: MobileVoipDevice,   name: "MobileVoipDevice",   filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: MobileDevice,       name: "MobileDevice",       filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: FBLeadSubscription, name: "FBLeadSubscription", filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: FBLeadEntry,        name: "FBLeadEntry",        filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: FBLeadCampaign,     name: "FBLeadCampaign",     filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: CRMOutcome,         name: "CRMOutcome",         filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: AgentEmailAccount,  name: "AgentEmailAccount",  filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: CallCoachReport,    name: "CallCoachReport",    filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: Mapping,            name: "Mapping",            filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: EmailTemplate,      name: "EmailTemplate",      filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: EmailSender,        name: "EmailSender",        filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: EmailMessage,       name: "EmailMessage",       filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: EmailCampaign,      name: "EmailCampaign",      filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: EmailSuppression,   name: "EmailSuppression",   filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: VoicemailDrop,      name: "VoicemailDrop",      filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: ObjectionEntry,     name: "ObjectionEntry",     filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: SupportConversation, name: "SupportConversation", filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: SupportEmailDraft,  name: "SupportEmailDraft",  filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: ProspectRecord,     name: "ProspectRecord",     filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: ProspectingPlan,    name: "ProspectingPlan",    filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: AdMetricsDaily,     name: "AdMetricsDaily",     filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: AdActionReport,     name: "AdActionReport",     filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: AiQueuedReply,      name: "AiQueuedReply",      filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: PasswordResetToken, name: "PasswordResetToken", filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: FollowUpNudge,      name: "FollowUpNudge",      filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: AdminAiAuditLog,    name: "AdminAiAuditLog",    filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: ProvenAd,           name: "ProvenAd",           filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    // Booking: both userEmail (CRM owner) and agentEmail (agent identity)
    { model: Booking,            name: "Booking.userEmail",  filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: Booking,            name: "Booking.agentEmail", filter: { agentEmail: oldEmail }, update: { $set: { agentEmail: newEmail } } },
    // Funnel: both userEmail and agentEmail
    { model: Funnel,             name: "Funnel.userEmail",   filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
    { model: Funnel,             name: "Funnel.agentEmail",  filter: { agentEmail: oldEmail }, update: { $set: { agentEmail: newEmail } } },
    { model: FunnelSubmission,   name: "FunnelSubmission",   filter: { userEmail: oldEmail }, update: { $set: { userEmail: newEmail } } },
  ];

  const settled = await Promise.allSettled(
    ops.map(async (op): Promise<CascadeResult> => {
      const result = await op.model.updateMany(op.filter, op.update);
      return {
        field: Object.keys(op.filter)[0],
        model: op.name,
        matched: result.matchedCount,
        modified: result.modifiedCount,
      };
    }),
  );

  return settled.map((s, i): CascadeResult => {
    if (s.status === "fulfilled") return s.value;
    return {
      field: Object.keys(ops[i].filter)[0],
      model: ops[i].name,
      matched: 0,
      modified: 0,
      error: String((s as PromiseRejectedResult).reason?.message || s.reason),
    };
  });
}
