// /pages/api/auth/[...nextauth].ts
import NextAuth, { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcrypt";
import mongooseConnect from "@/lib/mongooseConnect";
import { getUserByEmail } from "@/models/User";
import twilio from "twilio";
import A2PProfile from "@/models/A2PProfile";
import User from "@/models/User";
import { syncA2PForUser } from "@/lib/twilio/syncA2P";
import { sendWelcomeEmail } from "@/lib/email";

const isDev =
  process.env.NODE_ENV === "development" ||
  process.env.NEXTAUTH_URL?.includes("localhost") ||
  process.env.NEXTAUTH_URL?.includes("ngrok");

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;
const client = twilio(accountSid, authToken);

async function ensureMessagingService(userId: string, userEmail: string) {
  const existingProfile = await A2PProfile.findOne({ userId });
  if (existingProfile?.messagingServiceSid) return;

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    process.env.NEXTAUTH_URL;

  const service = await client.messaging.services.create({
    friendlyName: `CoveCRM Service – ${userEmail}`,
    inboundRequestUrl: `${baseUrl}/api/twilio/inbound-sms`,
    statusCallback: `${baseUrl}/api/twilio/status-callback`,
  });

  if (existingProfile) {
    existingProfile.messagingServiceSid = service.sid;
    await existingProfile.save();
  } else {
    await A2PProfile.create({ userId, messagingServiceSid: service.sid });
  }
}

async function safeSyncA2PByEmail(email: string, awaitIt = true) {
  try {
    await mongooseConnect();
    const user = await User.findOne({ email });
    if (!user) return;
    if (awaitIt) await syncA2PForUser(user as any);
    else syncA2PForUser(user as any).catch(() => {});
  } catch (e) {
    console.warn("safeSyncA2PByEmail error:", e);
  }
}

const cookieDomain = process.env.NEXTAUTH_URL?.includes("ngrok.app")
  ? ".ngrok.app"
  : undefined;

export const authOptions: NextAuthOptions = {
  debug: true,
  trustHost: true,
  useSecureCookies: !isDev,

  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        code: { label: "Affiliate Code", type: "text" }, // kept for compatibility; UI won’t send it
      },
      async authorize(credentials: any, req) {
        if (!credentials?.email || !credentials?.password) return null;

        const { email, password, code } = credentials;
        await mongooseConnect();

        let user = await getUserByEmail(email);
        let isNewUser = false;

        if (!user) {
          const hashedPassword = await bcrypt.hash(password, 10);
          const affiliateCode = code || req.cookies?.affiliate_code || null;
          const UserModel = (await import("@/models/User")).default;

          user = await UserModel.create({
            email,
            password: hashedPassword,
            name: email.split("@")[0],
            role: "user",
            affiliateCode,
            subscriptionStatus: "active",
          });

          isNewUser = true;

          try {
            await sendWelcomeEmail({ to: user.email, name: user.name });
          } catch (e) {
            console.warn("welcome email (credentials) failed:", e);
          }
        }

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) return null;

        if (isNewUser) {
          await ensureMessagingService(user._id.toString(), user.email);
        }

        await safeSyncA2PByEmail(user.email, true);

        return {
          id: user._id?.toString(),
          email: user.email,
          name: user.name || user.email,
          role: user.role || "user",
          affiliateCode: user.affiliateCode || null,
        };
      },
    }),

    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        url: "https://accounts.google.com/o/oauth2/v2/auth",
        params: {
          scope:
            "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid",
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
        },
      },
      async profile(profile) {
        await mongooseConnect();
        let user = await getUserByEmail(profile.email);
        let isNewUser = false;

        if (!user) {
          const UserModel = (await import("@/models/User")).default;
          user = await UserModel.create({
            email: profile.email,
            name: profile.name || profile.email.split("@")[0],
            role: "user",
            affiliateCode: null,
            subscriptionStatus: "active",
          });

          isNewUser = true;

          try {
            await sendWelcomeEmail({ to: user.email, name: user.name });
          } catch (e) {
            console.warn("welcome email (google) failed:", e);
          }
        }

        if (isNewUser) {
          await ensureMessagingService(user._id.toString(), user.email);
        }

        await safeSyncA2PByEmail(user.email, true);

        return {
          id: user._id?.toString(),
          email: user.email,
          name: user.name || user.email,
          role: user.role || "user",
          affiliateCode: user.affiliateCode || null,
        };
      },
    }),
  ],

  // 🔹 Use the custom blue page
  pages: {
    signIn: "/auth/signin",
  },

  session: { strategy: "jwt" },

  cookies: {
    sessionToken: {
      name: isDev
        ? "next-auth.session-token"
        : "__Secure-next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: !isDev,
        domain: cookieDomain, // only for ngrok
      },
    },
  },

  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        token.id = (user as any).id;
        token.email = (user as any).email;
        token.name = (user as any).name;
        token.role = (user as any).role;
        token.affiliateCode = (user as any).affiliateCode;
      }
      if (account?.provider === "google") {
        token.accessToken = (account as any).access_token;
        token.refreshToken = (account as any).refresh_token;
      }
      return token;
    },

    async session({ session, token }) {
      (session.user as any).id = token.id as string;
      (session.user as any).email = token.email as string;
      (session.user as any).name = token.name as string;
      (session.user as any).role = token.role as string;
      (session.user as any).affiliateCode = token.affiliateCode as
        | string
        | null;

      if ((token as any).accessToken)
        (session.user as any).googleAccessToken = (token as any).accessToken;
      if ((token as any).refreshToken)
        (session.user as any).googleRefreshToken = (token as any).refreshToken;

      try {
        await mongooseConnect();
        const u = await User.findOne({ email: (session.user as any).email });
        const last = u?.a2p?.lastSyncedAt
          ? new Date(u.a2p.lastSyncedAt).getTime()
          : 0;
        const sixHours = 6 * 60 * 60 * 1000;
        if (!last || Date.now() - last > sixHours) {
          safeSyncA2PByEmail((session.user as any).email, false);
        }
      } catch (e) {
        console.warn("Session A2P refresh skipped:", e);
      }

      return session;
    },

    async redirect({ url, baseUrl }) {
      return url.startsWith("/") ? `${baseUrl}${url}` : url;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};

export default NextAuth(authOptions);
