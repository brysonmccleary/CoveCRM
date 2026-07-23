import MetaLaunchArchive from "@/models/MetaLaunchArchive";

export async function writeImmutableMetaLaunchArchive(
  record: Record<string, any>,
  archiveModel: any = MetaLaunchArchive
) {
  const userEmail = String(record.userEmail || "").trim().toLowerCase();
  const launchFingerprint = String(record.launchFingerprint || "").trim();
  if (!userEmail || !launchFingerprint) throw new Error("Archive tenant and launch fingerprint are required");
  return archiveModel.findOneAndUpdate(
    { userEmail, launchFingerprint },
    { $setOnInsert: { ...record, userEmail, launchFingerprint } },
    { upsert: true, new: true }
  );
}
