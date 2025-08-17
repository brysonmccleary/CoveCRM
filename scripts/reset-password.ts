// scripts/reset-password.ts
import { config } from "dotenv";
import { MongoClient } from "mongodb";
import bcrypt from "bcrypt";

config();

const email = "bryson.mccleary1@gmail.com";
const newPassword = "Bewsers123"; // or anything you want

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Missing MONGODB_URI");

  const client = new MongoClient(uri);
  await client.connect();

  const db = client.db("covecrm");
  const users = db.collection("users");

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  const result = await users.updateOne(
    { email },
    { $set: { password: hashedPassword } }
  );

  if (result.modifiedCount === 1) {
    console.log(`✅ Password reset for ${email}`);
  } else {
    console.log(`⚠️ User not found or password not updated`);
  }

  await client.close();
}

main();
