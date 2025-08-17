// scripts/check-users.ts
import { config } from "dotenv";
import { MongoClient } from "mongodb";

config(); // Load .env

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("❌ MONGODB_URI not found in .env");
    process.exit(1);
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log("✅ Connected to MongoDB");

    const db = client.db("covecrm");
    const users = await db.collection("users").find().toArray();

    console.log("📋 Users in DB:");
    console.log(users);
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await client.close();
  }
}

main();
