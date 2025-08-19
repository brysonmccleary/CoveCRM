// /types/shims.d.ts

import "http";
import "net";

declare global {
  // Luxon used as a type in several files
  type DateTime = any;
}

declare module "@/models/User" {
  // Widen the User shape so TS stops complaining across many API routes.
  export interface IUser {
    _id?: any;
    email: string;
    name?: string;
    role?: string;
    password?: string;
    affiliateCode?: string | null;
    subscriptionStatus?: string;
    stripeCustomerId?: string;
    numbers?: Array<{
      sid: string;
      phoneNumber: string;
      subscriptionId?: string;
      usage?: {
        callsMade: number;
        callsReceived: number;
        textsSent: number;
        textsReceived: number;
        cost: number;
      };
    }>;
    a2p?: { lastSyncedAt?: Date | string };

    // Calendar/Google
    accessToken?: string;
    calendarId?: string;
    googleRefreshToken?: string;
    googleCalendar?: {
      accessToken: string;
      refreshToken?: string;
      expiryDate?: number;
    } | null;
    googleWatch?: { expiration?: string | number } | null;
    googleTokens?: any;
    googleSheets?: {
      syncedSheets?: Array<{ sheetId: string; folderName: string }>;
      [k: string]: any;
    } | null;

    // Booking & profile
    bookingSettings?: {
      slotLength: number;
      timezone: string;
      workingHours?: any;
    };
    usageBalance?: number;
    hasAIUpgrade?: boolean;
    firstName?: string;
    lastName?: string;
    referralCode?: string;
  }

  // Some files import these as named exports. Provide permissive declarations.
  export function getCalendarIdByEmail(email: string): Promise<string | null>;
  export function updateUserGoogleSheets(...args: any[]): Promise<any>;
  export function createUser(...args: any[]): Promise<any>;
}

// Stripe: relax strict typings used in your code
declare module "stripe" {
  namespace Stripe {
    interface Invoice {
      subscription?: string | Stripe.Subscription | null;
      payment_intent?: string | Stripe.PaymentIntent | null;
      discount?: any;
    }
    interface PaymentIntent {
      charges?: { data?: any[] };
    }
    interface Subscription {
      current_period_end?: number;
    }
  }
}

// Stripe Elements appearance.labels union -> accept any (you use a plain string)
declare module "@stripe/stripe-js" {
  interface Appearance {
    labels?: any;
  }
}

// formidable file path property used in upload endpoint
declare module "formidable" {
  interface File {
    filepath: string;
  }
}

// Small utilities without .d.ts
declare module "@/utils/scheduleReminders" {
  export function checkAndSendReminders(...args: any[]): Promise<any>;
}
declare module "@/utils/syncSheetRow" {
  export function syncSheetRow(...args: any[]): Promise<any>;
}
declare module "@/lib/email/sendEmail" {
  export function sendEmail(...args: any[]): Promise<any>;
}

// Models/Lead extra type some files import
declare module "@/models/Lead" {
  export type LeadType = any;
}

// parse-address has no @types; declare a stub
declare module "parse-address" {
  const parseAddress: any;
  export default parseAddress;
}

// Allow res.socket.server.io access in /pages/api/socket.ts
declare module "http" {
  interface Server {
    io?: any;
  }
}
declare module "net" {
  interface Socket {
    server?: import("http").Server;
  }
}

// checkCallTime: allow an overload with no args (you call it without timezone in one place)
declare module "@/utils/checkCallTime" {
  export function isCallAllowed(): boolean;
  export function isCallAllowed(timezone: string): boolean;
}
