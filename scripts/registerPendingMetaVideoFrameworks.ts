import dotenv from "dotenv";
import path from "path";
import mongoose from "mongoose";
import mongooseConnect from "@/lib/mongooseConnect";
import MetaCreativeVideoFramework from "@/models/MetaCreativeVideoFramework";
import { buildPendingVideoFrameworks } from "@/lib/facebook/creativeAssets/videoFrameworks";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });

async function main() {
  const apply = process.argv.includes("--apply") || process.env.APPLY === "1";
  const frameworks = buildPendingVideoFrameworks();
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry_run", frameworks: frameworks.length,
    byLanguage: { en: frameworks.filter((row) => row.language === "en").length, es: frameworks.filter((row) => row.language === "es").length },
    byVertical: Object.fromEntries([...new Set(frameworks.map((row) => row.vertical))].map((vertical) => [vertical, frameworks.filter((row) => row.vertical === vertical).length])),
    approvalStatus: "pending", actualVideoAssets: 0,
  }, null, 2));
  if (!apply) return;
  await mongooseConnect();
  await MetaCreativeVideoFramework.bulkWrite(frameworks.map((framework) => ({ updateOne: {
    filter: { frameworkId: framework.frameworkId },
    update: { $set: { ...framework, approvalSource: "", approvedAt: null, active: true } },
    upsert: true,
  } })), { ordered: true });
  await mongoose.disconnect();
}

main().catch((error) => { console.error(error); process.exit(1); });
