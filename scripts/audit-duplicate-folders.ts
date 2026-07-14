import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local", override: false });
dotenvConfig({ path: ".env", override: false });

import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";

async function main() {
  await dbConnect();

  const duplicates = await Folder.aggregate([
    {
      $group: {
        _id: { userEmail: "$userEmail", name: "$name" },
        count: { $sum: 1 },
        folderIds: { $push: "$_id" },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { "_id.userEmail": 1, "_id.name": 1 } },
  ]);

  console.log(JSON.stringify({ duplicatePairCount: duplicates.length, duplicates }, null, 2));
}

main()
  .catch((error) => {
    console.error("Folder duplicate audit failed:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const mongoose = await import("mongoose");
    await mongoose.default.disconnect();
  });
