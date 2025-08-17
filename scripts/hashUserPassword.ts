import "dotenv/config";
import bcrypt from "bcrypt";
import dbConnect from "../lib/mongooseConnect";
import User from "../models/User";

// Change these
const email = "bryson.mccleary1@gmail.com";
const plainPassword = "Bewsers123";

async function hashAndUpdate() {
  await dbConnect();

  const user = await User.findOne({ email });
  const hashedPassword = await bcrypt.hash(plainPassword, 10);

  if (user) {
    console.log("🔁 User exists, updating password...");
    await User.updateOne(
      { email },
      { $set: { password: hashedPassword } }
    );
  } else {
    console.log("➕ User does not exist, creating...");
    const newUser = new User({ email, password: hashedPassword });
    await newUser.save();
  }

  console.log("✅ Done!");
  process.exit();
}

hashAndUpdate();
