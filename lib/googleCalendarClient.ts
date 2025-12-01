// /lib/googleCalendarClient.ts
import { google } from "googleapis";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

type GCalStore = {
  refreshToken: string;
  accessToken?: string;
  expiryDate?: number;
};

type StorePath = "googleCalendar" | "integrations.googleCalendar";

function extractStore(user: any): {
  store: GCalStore | null;
  path: StorePath;
} {
  if (user?.googleCalendar?.refreshToken) {
    const gc = user.googleCalendar;
    return {
      store: {
        refreshToken: String(gc.refreshToken),
        accessToken: gc.accessToken ? String(gc.accessToken) : undefined,
        expiryDate:
          typeof gc.expiryDate === "number" ? gc.expiryDate : undefined,
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
        expiryDate:
          typeof gc.expiryDate === "number" ? gc.expiryDate : undefined,
      },
      path: "integrations.googleCalendar",
    };
  }

  return { store: null, path: "googleCalendar" };
}

async function clearCalendarTokens(email: string, path: StorePath) {
  // Blow away ALL calendar creds at that path so we treat as disconnected
  await User.updateOne(
    { email },
    {
      $unset: {
        [`${path}.refreshToken`]: "",
        [`${path}.accessToken`]: "",
        [`${path}.expiryDate`]: "",
        [`${path}.scope`]: "",
        [`${path}.tokenType`]: "",
        [`${path}.idToken`]: "",
      },
    }
  );
}

/**
 * Returns an OAuth2 client with a fresh access token for the given user.
 *
 * If Google replies "invalid_grant" during refresh, we:
 *   - clear stored calendar tokens
 *   - throw an Error with code/message "GOOGLE_RECONNECT_REQUIRED"
 */
export async function getFreshGoogleOAuthClient(userEmail: string) {
  await dbConnect();

  const email = userEmail.toLowerCase();
  const user = await User.findOne({ email }).lean();
  if (!user) throw new Error(`User not found for email: ${email}`);

  const { store, path } = extractStore(user as any);
  if (!store?.refreshToken) {
    throw new Error("No Google Calendar credentials found");
  }

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } =
    process.env;
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

  const needsRefresh =
    !store.expiryDate || Date.now() >= store.expiryDate - 120_000;

  if (needsRefresh) {
    try {
      // googleapis typings differ by version, so cast to any
      const { credentials } = await (oauth2Client as any).refreshAccessToken();
      oauth2Client.setCredentials(credentials);

      await User.updateOne(
        { email },
        {
          $set: {
            [`${path}.accessToken`]: credentials.access_token,
            [`${path}.expiryDate`]: credentials.expiry_date,
          },
        }
      );
    } catch (err: any) {
      const data = err?.response?.data || err;
      const errMsg =
        data?.error_description || data?.error || err?.message || "";

      const isInvalidGrant =
        data?.error === "invalid_grant" ||
        errMsg.includes("invalid_grant") ||
        errMsg.toLowerCase().includes("invalid grant");

      if (isInvalidGrant) {
        // Tokens are dead. Clear them and signal to caller.
        await clearCalendarTokens(email, path);

        const reconnectErr: any = new Error("GOOGLE_RECONNECT_REQUIRED");
        reconnectErr.code = "GOOGLE_RECONNECT_REQUIRED";
        throw reconnectErr;
      }

      // Some other Google error – just rethrow
      throw err;
    }
  }

  return oauth2Client;
}
