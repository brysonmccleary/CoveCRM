// scripts/createtestuser.ts
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { createUser, getUserByEmail } from "../models/User";
import dbConnect from "../lib/mongooseConnect";
import User from "../models/User"; // Mongoose model

async function createTestUser() {
  await dbConnect();

  const testEmail = "agent@example.com";
  const existingUser = await getUserByEmail(testEmail);

  if (existingUser) {
    console.log("User already exists. Deleting old user...");
    await User.deleteOne({ email: testEmail });
  }

  const hashedPassword = await bcrypt.hash("test123", 10);

  const newUser = {
    email: testEmail,
    password: hashedPassword,
    name: "Agent Example",
    role: "user" as const,
    assignedDrips: [],
    leadIds: [],
    numbers: [],
    createdAt: new Date(),
  };

  await createUser(newUser);
  console.log("✅ New test user created with hashed password");

  await mongoose.disconnect();
  process.exit(0);
}

createTestUser();
