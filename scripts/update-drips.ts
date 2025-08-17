import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import dbConnect from "../lib/mongooseConnect";
import Drip from "../models/Drip";
import { prebuiltDrips } from "../utils/prebuiltDrips";

(async () => {
  await dbConnect();

  // Remove all existing drips
  await Drip.deleteMany({});

  // Insert new predefined drips
  await Drip.insertMany(prebuiltDrips);

  console.log("✅ Drips replaced with updated versions!");
  process.exit();
})();
