import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Folder from "@/models/Folder";
import Number from "@/models/Number";
import Lead from "@/models/Lead";
import {
  getA2PStatus,
  getAIFeatureStatus,
  getLeadAssistantSnapshot,
  getMetaStatus,
  getRecentImportErrors,
  getRecentSmsFailures,
} from "./supportTools";

export async function buildSupportContext(userEmail: string) {
  await mongooseConnect();

  const [
    user,
    folders,
    numbers,
    a2pStatus,
    metaStatus,
    recentSmsFailures,
    recentImportErrors,
    aiFeatures,
    leadAssistant,
  ] = await Promise.all([
    (User as any).findOne({ email: userEmail }).lean(),
    Folder.find({ userEmail }).sort({ updatedAt: -1 }).limit(20).lean(),
    Number.find({ userEmail }).sort({ createdAt: -1 }).limit(20).lean(),
    getA2PStatus(userEmail),
    getMetaStatus(userEmail),
    getRecentSmsFailures(userEmail),
    getRecentImportErrors(userEmail),
    getAIFeatureStatus(userEmail),
    getLeadAssistantSnapshot(userEmail),
  ]);

  return {
    integrations: {
      twilioConfigured: Boolean(user?.twilio?.accountSid),
      googleSheetsConnected: Boolean(user?.googleSheets?.accessToken),
      googleCalendarConnected: Boolean(user?.googleCalendar?.accessToken),
      metaConnected: metaStatus.connected,
    },
    messagingStatus: {
      a2p: a2pStatus,
      recentSmsFailures,
      numberCount: numbers.length,
    },
    campaigns: {
      assignedDripsTotal: folders.reduce(
        (sum, folder: any) => sum + (Array.isArray(folder.assignedDrips) ? folder.assignedDrips.length : 0),
        0
      ),
    },
    folders: folders.map((folder: any) => ({
      id: String(folder._id),
      name: folder.name,
      aiContactEnabled: Boolean(folder.aiContactEnabled),
      aiFirstCallEnabled: Boolean(folder.aiFirstCallEnabled),
    })),
    recentErrors: {
      smsFailures: recentSmsFailures,
      importErrors: recentImportErrors,
    },
    aiFeatures,
    topLeads: (arguments[0] as any)[8]?.map((lead: any) => ({
      id: String(lead._id),
      name: lead.name || ((lead.firstName || "") + " " + (lead.lastName || "")).trim(),
      phone: lead.phone || "",
      folder: lead.folderName || "",
      aiPriorityScore: lead.aiPriorityScore || 0,
      aiPriorityCategory: lead.aiPriorityCategory || "",
      lastContactedAt: lead.lastContactedAt || null,
      lastReplyAt: lead.lastReplyAt || null,
      createdAt: lead.createdAt,
    })) || [],
  };
}
