import dotenv from "dotenv";
import mongoose from "mongoose";
import User from "../models/user";

// ✅ Load .env
dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Missing MONGODB_URI in env");
  }

  await mongoose.connect(uri);
  console.log("✅ Connected to MongoDB (covecrm)");

  const email = "bryson.mccleary1@gmail.com";

  const result = await User.updateOne(
    { email },
    {
      $set: {
        hashedPassword: "$2a$10$J4XtReRGKAzRZw7OUnzE6eMdOAd1euEFbM7HyV1pgN6GOTlPZLb2G",
        role: "admin",
      },
    },
    { upsert: true }
  );

  console.log("✅ Admin user updated:", result);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error updating admin user:", err);
  process.exit(1);
});
