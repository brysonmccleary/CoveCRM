import FBLeadCampaign from "@/models/FBLeadCampaign";
import { sendEmail } from "@/lib/email";

type CampaignAd = {
  metaAdId?: string;
  variantId?: string;
  headline?: string;
  spend?: number;
  leads?: number;
  clicks?: number;
  cpl?: number;
  appointmentsBooked?: number;
  sales?: number;
};

type OptimizationAlert = {
  type: string;
  adMetaId: string;
  variantId: string;
  message: string;
  createdAt: Date;
  emailedAt: Date | null;
  dismissed: boolean;
};

function roundMoney(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function buildAlertMessage(args: {
  type: "winner_candidate" | "loser_candidate";
  index: number;
  cpl: number;
  campaignAvgCpl: number;
}) {
  if (args.type === "winner_candidate") {
    return `Ad ${args.index} is getting leads at a lower CPL than the rest of this campaign. Review it before increasing budget.`;
  }
  return `Ad ${args.index} has spent money without strong results. Review it before continuing to spend.`;
}

export async function evaluateFacebookOptimizationAlerts(campaignId: string) {
  const campaign = await FBLeadCampaign.findById(campaignId);
  if (!campaign) return { created: 0, emailed: 0 };

  const ads = Array.isArray((campaign as any).ads) ? ((campaign as any).ads as CampaignAd[]) : [];
  if (ads.length === 0) return { created: 0, emailed: 0 };

  const campaignSpend = Number((campaign as any).totalSpend || 0);
  const campaignLeads = Number((campaign as any).totalLeads || 0);
  const campaignAvgCpl = campaignSpend > 0 && campaignLeads > 0 ? campaignSpend / campaignLeads : 0;
  if (campaignAvgCpl <= 0) return { created: 0, emailed: 0 };

  const existingAlerts = Array.isArray((campaign as any).optimizationAlerts)
    ? ([...(campaign as any).optimizationAlerts] as OptimizationAlert[])
    : [];
  const newAlerts: OptimizationAlert[] = [];

  ads.forEach((ad, idx) => {
    const spend = Number(ad.spend || 0);
    const leads = Number(ad.leads || 0);
    const cpl = Number(ad.cpl || 0);
    if (spend <= 10) return;

    let type: "winner_candidate" | "loser_candidate" | null = null;
    if (leads >= 3 && cpl > 0 && cpl <= campaignAvgCpl * 0.8) {
      type = "winner_candidate";
    } else if (leads === 0 || (cpl > 0 && cpl >= campaignAvgCpl * 1.35)) {
      type = "loser_candidate";
    }
    if (!type) return;

    const adMetaId = String(ad.metaAdId || "").trim();
    const variantId = String(ad.variantId || "").trim();
    const message = buildAlertMessage({
      type,
      index: idx + 1,
      cpl: roundMoney(cpl),
      campaignAvgCpl: roundMoney(campaignAvgCpl),
    });

    const duplicate = existingAlerts.find(
      (alert) =>
        !alert.dismissed &&
        alert.type === type &&
        String(alert.adMetaId || "") === adMetaId &&
        String(alert.message || "") === message
    );
    if (duplicate) return;

    newAlerts.push({
      type,
      adMetaId,
      variantId,
      message,
      createdAt: new Date(),
      emailedAt: null,
      dismissed: false,
    });
  });

  if (newAlerts.length === 0) return { created: 0, emailed: 0 };

  await FBLeadCampaign.updateOne(
    { _id: campaign._id },
    { $push: { optimizationAlerts: { $each: newAlerts } } }
  );

  let emailed = 0;
  if ((campaign as any).userEmail) {
    const subject = `CoveCRM Facebook Ads recommendation for ${String((campaign as any).campaignName || "your campaign")}`;
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
        <h2 style="margin:0 0 12px 0;">${String((campaign as any).campaignName || "Campaign")}</h2>
        <p style="margin:0 0 12px 0;">CoveCRM detected ad-level performance signals worth reviewing. No changes were made automatically.</p>
        <ul style="margin:0 0 16px 16px; padding:0;">
          ${newAlerts.map((alert) => `<li>${alert.message}</li>`).join("")}
        </ul>
        <p style="margin:0;">Review this campaign inside CoveCRM before making any manual change.</p>
      </div>
    `;
    const result = await sendEmail(String((campaign as any).userEmail).toLowerCase(), subject, html);
    if (result.ok) {
      emailed = newAlerts.length > 0 ? 1 : 0;
      await FBLeadCampaign.updateOne(
        { _id: campaign._id },
        { $set: { "optimizationAlerts.$[alert].emailedAt": new Date() } },
        {
          arrayFilters: [{ "alert.emailedAt": null, "alert.message": { $in: newAlerts.map((a) => a.message) } }],
        }
      ).catch(() => {});
    }
  }

  return { created: newAlerts.length, emailed };
}
