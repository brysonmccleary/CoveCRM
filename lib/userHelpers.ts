// /lib/userHelpers.ts
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

/** Return the user's saved calendarId (or null) by email */
export async function getCalendarIdByEmail(email: string): Promise<string | null> {
  await dbConnect();
  const doc = await User.findOne({ email: email.toLowerCase() });
  return (doc as any)?.calendarId || null;
}

/** Persist Google Sheets tokens/expiry on the user row */
export async function updateUserGoogleSheets(
  email: string,
  data: { accessToken: string; refreshToken: string; expiryDate?: number | null }
) {
  await dbConnect();
  const { accessToken, refreshToken, expiryDate } = data;
  const update = {
    googleSheets: {
      accessToken,
      refreshToken,
      ...(expiryDate != null ? { expiryDate } : {}),
    },
  };
  return await User.findOneAndUpdate(
    { email: email.toLowerCase() },
    { $set: update },
    { new: true }
  );
}
