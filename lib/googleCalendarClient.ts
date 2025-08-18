// /lib/googleCalendarClient.ts
import { google } from "googleapis";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

type GCalStore = {
  refreshToken: string;
  accessToken?: string;
  expiryDate?: number;
};

function extractStore(user: any): {
  store: GCalStore | null;
  path: "googleCalendar" | "integrations.googleCalendar";
} {
  if (user?.googleCalendar?.refreshToken) {
    const gc = user.googleCalendar;
    return {
      store: {
        refreshToken: String(gc.refreshToken),
        accessToken: gc.accessToken ? String(gc.accessToken) : undefined,
        expiryDate: typeof gc.expiryDate === "number" ? gc.expiryDate : undefined,
      },
      path: "googleCalendar",
    };
  }
  if (user?.integrations?.googleCalendar?.refreshToken) {
    const gc = user.integrations.googleCalendar;
    return {
      store: {
        refreshToken: String(gc.refreshToken),
        accessToken: gc.accessToken ? String(gc.accessToken) : undefined,
        expiryDate: typeof gc.expiryDate === "number" ? gc.expiryDate : undefined,
      },
      path: "integrations.googleCalendar",
    };
  }
  return { store: null, path: "googleCalendar" };
}

export async function getFreshGoogleOAuthClient(userEmail: string) {
  await dbConnect();

  // Use lean() to avoid strict IUser typing issues
  const user = await User.findOne({ email: userEmail }).lean();
  if (!user) throw new Error(`User not found for email: ${userEmail}`);

  const { store, path } = extractStore(user as any);
  if (!store?.refreshToken) {
    throw new Error("No Google Calendar credentials found");
  }

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new Error(
      "Missing Google OAuth env vars (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)"
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    refresh_token: store.refreshToken,
    access_token: store.accessToken,
    expiry_date: store.expiryDate,
  });

  // Refresh if missing/near expiry (2-min buffer), then persist
  const needsRefresh = !store.expiryDate || Date.now() >= store.expiryDate - 120_000;
  if (needsRefresh) {
    // Cast to any to satisfy TS across googleapis versions
    const { credentials } = await (oauth2Client as any).refreshAccessToken();
    oauth2Client.setCredentials(credentials);

    await User.updateOne(
      { email: userEmail },
      {
        $set: {
          [`${path}.accessToken`]: credentials.access_token,
          [`${path}.expiryDate`]: credentials.expiry_date,
        },
      }
    );
  }

  return oauth2Client;
}
