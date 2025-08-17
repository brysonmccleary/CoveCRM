import "dotenv/config";
import bcrypt from "bcryptjs";
import dbConnect from "../lib/mongooseConnect";
import User from "../models/User";

async function hashAllUsers() {
  await dbConnect();

  const users = await User.find();

  for (const user of users) {
    if (user.password && !user.password.startsWith("$2a$")) {
      const hashed = await bcrypt.hash(user.password, 10);
      await User.updateOne({ _id: user._id }, { $set: { password: hashed } });
      console.log(`✅ Updated user: ${user.email}`);
    }
  }

  console.log("🎉 All done!");
  process.exit();
}

hashAllUsers().catch((err) => {
  console.error(err);
  process.exit(1);
});
