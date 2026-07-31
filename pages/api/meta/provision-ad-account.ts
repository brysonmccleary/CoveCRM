import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { provisionMetaAdAccount } from "@/lib/meta/adAccountProvisioning";
import { metaGraphUrl } from "@/lib/meta/graphApi";

async function getTokenIdentity(token: string) {
  if (!token) return "";
  const url = new URL(metaGraphUrl("me"));
  url.searchParams.set("access_token", token);
  url.searchParams.set("fields", "id");
  const response = await fetch(url);
  const json = await response.json() as any;
  return response.ok ? String(json?.id || "") : "";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  const user = await User.findOne({ email }).lean() as any;
  const token = String(user?.metaAccessToken || "");
  const pageId = String(user?.metaPageId || "");
  if (!token || !pageId) {
    return res.status(400).json({ error: "Connect Facebook and choose a Page first." });
  }

  await User.updateOne(
    { email },
    { $set: { metaAdAccountProvisioningStatus: "provisioning", metaAdAccountProvisioningError: "" } }
  );

  try {
    const serverUserId = await getTokenIdentity(String(user?.metaSystemUserToken || ""));
    const result = await provisionMetaAdAccount({
      token,
      pageId,
      pageName: String(user?.metaPageName || ""),
      userName: String(user?.name || session?.user?.name || ""),
      userEmail: email,
      currentAdAccountId: String(user?.metaAdAccountId || ""),
      currentBusinessId: String(user?.metaBusinessId || ""),
      serverUserId,
      browserTimeZone: String(req.body?.timeZone || ""),
      currency: "USD",
    });

    const update: Record<string, any> = {
      metaAdAccountProvisioningStatus: result.status,
      metaAdAccountProvisioningError: result.status === "blocked" ? String(result.message || result.reason || "") : "",
      metaAdAccountProvisionedAt: new Date(),
      metaHealthStatus: "unknown",
    };
    if (result.business?.id) update.metaBusinessId = result.business.id;
    if (result.business?.name) update.metaBusinessName = result.business.name;
    if (result.adAccount?.accountId) update.metaAdAccountId = result.adAccount.accountId;
    await User.updateOne({ email }, { $set: update, $unset: { metaLeadTypeAssets: "" } });

    if (result.status === "blocked") {
      const userMessage = result.reason === "account_limit"
        ? "Meta has limited new ad accounts for this business. Cove checked for an existing account but none is available yet."
        : result.reason === "verification_required"
          ? "Meta needs a quick identity or business verification before it can create the ad account."
          : result.reason === "permissions"
            ? "Meta did not grant permission to create or manage this business ad account. Reconnect Facebook and approve every permission."
            : result.reason === "page_assignment_required"
              ? "Meta has not connected your Facebook Page to this ad account yet. CoveCRM could not finish that connection automatically; open Advanced account options to finish it in Meta."
            : "Meta could not finish the ad account setup yet.";
      return res.status(409).json({ ...result, error: userMessage });
    }

    return res.status(200).json(result);
  } catch (error: any) {
    console.error("[meta/provision-ad-account]", error?.message);
    await User.updateOne(
      { email },
      { $set: { metaAdAccountProvisioningStatus: "blocked", metaAdAccountProvisioningError: String(error?.message || "") } }
    ).catch(() => {});
    return res.status(502).json({ error: "Meta could not finish the ad account setup right now. Please try again." });
  }
}
