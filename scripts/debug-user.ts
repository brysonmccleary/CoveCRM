import "dotenv/config";
import mongooseConnect from "@/lib/mongooseConnect";
import { getUserByEmail } from "@/models/User";

(async () => {
  try {
    await mongooseConnect();
    const user = await getUserByEmail("bryson.mccleary1@gmail.com");
    console.log("✅ USER FOUND:\n", user);
  } catch (err) {
    console.error("❌ ERROR:", err);
  } finally {
    process.exit();
  }
})();
