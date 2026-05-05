import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Folder from "@/models/Folder";
import Number from "@/models/Number";
import A2PProfile from "@/models/A2PProfile";
import Message from "@/models/Message";
import Lead from "@/models/Lead";

function truncateText(value: any, maxChars: number) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

export async function getTwilioStatus(userEmail: string) {
  await mongooseConnect();
  const [user, numbers] = await Promise.all([
    (User as any).findOne({ email: userEmail }).lean(),
    Number.find({ userEmail }).sort({ createdAt: -1 }).limit(5).lean(),
  ]);
  return {
    hasTwilioConfig: Boolean(user?.twilio?.accountSid),
    defaultNumberId: user?.defaultSmsNumberId || null,
    numberCount: numbers.length,
    numbers: numbers.map((number) => ({
      phoneNumber: number.phoneNumber,
      sid: number.sid,
    })),
  };
}

export async function getA2PStatus(userEmail: string) {
  await mongooseConnect();
  const [user, profile] = await Promise.all([
    (User as any).findOne({ email: userEmail }).lean(),
    (A2PProfile as any).findOne({ userEmail }).lean(),
  ]);
  return {
    userA2p: user?.a2p || null,
    profile: profile
      ? {
          registrationStatus: profile.registrationStatus,
          applicationStatus: profile.applicationStatus,
          messagingReady: profile.messagingReady,
          brandStatus: profile.brandStatus,
          campaignSid: profile.campaignSid || profile.usa2pSid || null,
          messagingServiceSid: profile.messagingServiceSid || null,
          lastError: profile.lastError || "",
        }
      : null,
  };
}

export async function getMetaStatus(userEmail: string) {
  await mongooseConnect();
  const recentMetaLeads = await (Lead as any)
    .find({ userEmail, metaLeadgenId: { $exists: true, $ne: "" } })
    .sort({ createdAt: -1 })
    .limit(3)
    .lean();

  return {
    connected: recentMetaLeads.length > 0,
    recentLeadCount: recentMetaLeads.length,
    recentLeads: recentMetaLeads.map((lead: any) => ({
      id: String(lead._id),
      metaLeadgenId: lead.metaLeadgenId,
      createdAt: lead.createdAt,
    })),
  };
}

export async function getRecentImportErrors(userEmail: string) {
  await mongooseConnect();
  const recentImports = await (Lead as any)
    .find({
      userEmail,
      sourceType: { $in: ["csv_import", "google_sheets_live", "manual_import"] },
    })
    .sort({ createdAt: -1 })
    .limit(8)
    .lean();

  return {
    recentImports: recentImports.map((lead: any) => ({
      id: String(lead._id),
      sourceType: lead.sourceType,
      createdAt: lead.createdAt,
    })),
    recentErrors: [],
  };
}

export async function getRecentSmsFailures(userEmail: string) {
  await mongooseConnect();
  const failures = await Message.find({
    userEmail,
    $or: [{ status: "failed" }, { errorCode: { $exists: true, $ne: "" } }],
  })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  return failures.map((message) => ({
    id: String(message._id),
    leadId: String(message.leadId),
    to: message.to || "",
    from: message.from || "",
    status: message.status || "",
    errorCode: message.errorCode || "",
    errorMessage: truncateText(message.errorMessage || "", 120),
    createdAt: message.createdAt,
  }));
}

export async function getFolderMappings(userEmail: string) {
  await mongooseConnect();
  const folders = await Folder.find({ userEmail }).sort({ updatedAt: -1 }).limit(8).lean();
  return folders.map((folder: any) => ({
    id: String(folder._id),
    name: folder.name,
    assignedDripsCount: Array.isArray(folder.assignedDrips) ? folder.assignedDrips.length : 0,
    aiContactEnabled: Boolean(folder.aiContactEnabled),
    aiFirstCallEnabled: Boolean(folder.aiFirstCallEnabled),
  }));
}

export async function getAIFeatureStatus(userEmail: string) {
  await mongooseConnect();
  const user = await (User as any).findOne({ email: userEmail }).lean();
  return {
    hasAI: Boolean(user?.hasAI),
    aiAssistantName: user?.aiAssistantName || "",
    aiDialerBalance: user?.aiDialerBalance || 0,
    aiDialerUsage: user?.aiDialerUsage || null,
    usageBalance: user?.usageBalance || 0,
  };
}


export async function getLeadAssistantSnapshot(userEmail: string) {
  await mongooseConnect();

  const [totalLeads, hotLeads, warmLeads, topLeads] = await Promise.all([
    (Lead as any).countDocuments({ userEmail }),
    (Lead as any).countDocuments({ userEmail, aiPriorityScore: { $gte: 80 } }),
    (Lead as any).countDocuments({
      userEmail,
      aiPriorityScore: { $gte: 60, $lt: 80 },
    }),
    (Lead as any)
      .find({ userEmail })
      .sort({ aiPriorityScore: -1, updatedAt: -1, createdAt: -1 })
      .limit(10)
      .lean(),
  ]);

  return {
    totals: {
      totalLeads,
      hotLeads,
      warmLeads,
    },
    topLeads: topLeads.map((lead: any) => ({
      id: String(lead._id),
      name:
        lead.name ||
        [lead.firstName || "", lead.lastName || ""].join(" ").trim() ||
        "Unnamed lead",
      phone: lead.phone || "",
      email: lead.email || "",
      folder: lead.folderName || lead.folder || "",
      aiPriorityScore: globalThis.Number(lead.aiPriorityScore || 0),
      aiPriorityCategory: lead.aiPriorityCategory || "",
      status: lead.status || "",
      disposition: lead.disposition || "",
      lastContactedAt: lead.lastContactedAt || null,
      updatedAt: lead.updatedAt || null,
      createdAt: lead.createdAt || null,
    })),
  };
}

export async function inspectRecentTextThreads(userEmail: string) {
  await mongooseConnect();
  const messages = await Message.find({ userEmail })
    .sort({ createdAt: -1 })
    .limit(40)
    .lean();

  const byLead = new Map<string, any[]>();
  for (const message of messages) {
    const leadId = String((message as any).leadId || "unknown");
    const list = byLead.get(leadId) || [];
    list.push(message);
    byLead.set(leadId, list);
  }

  return Array.from(byLead.entries())
    .slice(0, 8)
    .map(([leadId, items]) => ({
      leadId,
      messageCount: items.length,
      latestAt: items[0]?.createdAt || null,
      latestStatus: items[0]?.status || "",
      latestDirection: items[0]?.direction || "",
      latestErrorCode: items.find((item) => item?.errorCode)?.errorCode || "",
      latestErrorMessage: truncateText(items.find((item) => item?.errorMessage)?.errorMessage || "", 120),
      recentMessages: items.slice(0, 3).map((item) => ({
        direction: item?.direction || "",
        status: item?.status || "",
        errorCode: item?.errorCode || "",
        text: truncateText(item?.text || item?.body || "", 160),
        createdAt: item?.createdAt || null,
      })),
    }));
}

export async function inspectLeadSnapshot(userEmail: string) {
  await mongooseConnect();
  const [totalLeads, recentLeads, priorityLeads] = await Promise.all([
    (Lead as any).countDocuments({ userEmail }),
    (Lead as any)
      .find({ userEmail })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(8)
      .lean(),
    (Lead as any)
      .find({ userEmail })
      .sort({ aiPriorityScore: -1, updatedAt: -1 })
      .limit(5)
      .lean(),
  ]);

  const mapLead = (lead: any) => ({
    id: String(lead._id),
    name:
      lead.name ||
      [lead.firstName || lead["First Name"] || "", lead.lastName || lead["Last Name"] || ""].join(" ").trim() ||
      "Unnamed lead",
    phonePresent: Boolean(lead.phone || lead.Phone),
    emailPresent: Boolean(lead.email || lead.Email),
    folder: truncateText(lead.folderName || lead.folder || lead.folderId || "", 48),
    status: truncateText(lead.status || lead.disposition || "", 32),
    aiPriorityScore: typeof lead.aiPriorityScore === "number" ? lead.aiPriorityScore : 0,
    aiPriorityCategory: lead.aiPriorityCategory || "",
    sourceType: lead.sourceType || "",
    updatedAt: lead.updatedAt || null,
    createdAt: lead.createdAt || null,
  });

  return {
    totalLeads,
    recentLeads: recentLeads.map(mapLead),
    priorityLeads: priorityLeads.map(mapLead),
  };
}
