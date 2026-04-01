
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import Funnel from "@/models/Funnel";
import User from "@/models/User";
import Folder from "@/models/Folder";
import { getLeadTypeFolderName } from "@/lib/leadTypeConfig";

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .substring(0, 60);
}

function randomSuffix() {
  return Math.random().toString(36).substring(2, 6);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await mongooseConnect();

    const userEmail = session.user.email.toLowerCase();
    const user = await User.findOne({ email: userEmail }).lean();
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const {
      campaignId,
      leadType,
      agentName,
      agentPhone,
      agentEmail,
      brandName,
      quizType
    } = req.body;

    if (!campaignId || !leadType) {
      return res.status(400).json({ error: "campaignId and leadType required" });
    }

    // Create / find folder for this funnel
    const folderName = getLeadTypeFolderName(leadType);
    let folder = await Folder.findOne({ userEmail, name: folderName }).lean();
    if (!folder) {
      await Folder.create({ name: folderName, userEmail, assignedDrips: [] });
      folder = await Folder.findOne({ userEmail, name: folderName }).lean();
    }

    const baseSlug = slugify(
      `${leadType}-${agentName || userEmail.split("@")[0]}`
    );
    const slug = `${baseSlug}-${randomSuffix()}`;

    const funnel = await Funnel.create({
      userId: (user as any)._id,
      userEmail,
      campaignId,
      leadType,
      slug,
      headline: "",
      subheadline: "",
      quizType: quizType || "lead_form",
      agentName: agentName || "",
      agentPhone: agentPhone || "",
      agentEmail: agentEmail || userEmail,
      brandName: brandName || "",
      disclaimerText:
        "By submitting this form, you agree to be contacted about insurance options by a licensed agent. This is a private insurance service and is not affiliated with any government agency.",
      folderId: (folder as any)._id,
      isActive: true,
    });

    const publicUrl = `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/quote/${slug}`;

    return res.status(200).json({
      ok: true,
      funnelId: funnel._id,
      slug,
      publicUrl,
    });
  } catch (err: any) {
    console.error("[funnel/create] error:", err?.message);
    return res.status(500).json({ error: "Failed to create funnel" });
  }
}
