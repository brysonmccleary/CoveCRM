import dbConnect from "../../../lib/dbConnect";
import bcrypt from "bcryptjs";

async function hashAllUsers() {
  // Connect to MongoDB via mongoose
  const mongoose = await dbConnect();

  // Access users collection directly from mongoose connection
  const usersCollection = mongoose.connection.collection("users");

  // Find all users
  const users = await usersCollection.find({}).toArray();

  for (const user of users) {
    // Only hash if password exists and is not already hashed
    if (user.password && !user.password.startsWith("$2a$")) {
      const hashed = await bcrypt.hash(user.password, 10);
      await usersCollection.updateOne(
        { _id: user._id },
        { $set: { password: hashed } }
      );
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
