import "dotenv/config";
import dbConnect from "../lib/mongooseConnect";
import User from "../models/User";

async function printUser() {
  await dbConnect();

  const user = await User.findOne({ email: "bryson.mccleary1@gmail.com" });

  if (!user) {
    console.log("❌ User not found.");
  } else {
    console.log("🧠 Stored user record:");
    console.log(JSON.stringify(user, null, 2));
  }

  process.exit();
}

printUser();
