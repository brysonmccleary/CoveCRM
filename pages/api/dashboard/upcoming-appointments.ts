import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { Types } from "mongoose";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { getLeadDisplayName, getLeadValue } from "@/lib/leads/displayHelpers";

type UpcomingAppointment = {
  _id: string;
  displayName: string;
  phone: string;
  state: string | null;
  appointmentTime: Date | string;
  folderId: string | null;
  folderName: string | null;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ appointments: UpcomingAppointment[] } | { message: string }>,
) {
  if (req.method !== "GET") {
    res.status(405).json({ message: "Method not allowed" });
    return;
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const userEmail = String(session.user.email).toLowerCase();

  await dbConnect();

  const leads = await Lead.find({
    userEmail,
    appointmentTime: { $gte: new Date() },
  })
    .sort({ appointmentTime: 1 })
    .limit(8)
    .lean();

  const folderIdStrings = Array.from(
    new Set(
      (leads as any[])
        .map((lead) => (lead?.folderId ? String(lead.folderId) : ""))
        .filter(Boolean),
    ),
  );
  const folderObjectIds = folderIdStrings
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));

  const folders = folderObjectIds.length
    ? await Folder.find({ userEmail, _id: { $in: folderObjectIds } })
        .select({ _id: 1, name: 1 })
        .lean()
    : [];
  const folderNamesById = new Map(
    (folders as any[]).map((folder) => [String(folder._id), String(folder.name || "")]),
  );

  const appointments = (leads as any[]).map((lead) => {
    const folderId = lead?.folderId ? String(lead.folderId) : null;
    return {
      _id: String(lead._id),
      displayName: getLeadDisplayName(lead),
      phone: String(getLeadValue(lead, "phone") || ""),
      state: String(getLeadValue(lead, "state") || "") || null,
      appointmentTime: lead.appointmentTime,
      folderId,
      folderName: folderId ? folderNamesById.get(folderId) || null : null,
    };
  });

  res.status(200).json({ appointments });
}
