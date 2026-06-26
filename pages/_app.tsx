// /pages/_app.tsx
import "../styles/globals.css";
import type { AppProps } from "next/app";
import { SessionProvider, useSession } from "next-auth/react";
import { Toaster } from "react-hot-toast";
import InternalSync from "@/pages/internal-sync";
import ReminderBanner from "@/components/ReminderBanner";
import CallbackBanner from "@/components/CallbackBanner";
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Head from "next/head";
import { useRouter } from "next/router";
import SoftphoneProvider from "@/components/telephony/SoftphoneProvider";
import IncomingCallBanner from "@/components/IncomingCallBanner";
import BillingRequiredModal, { dispatchBillingRequired } from "@/components/BillingRequiredModal";

// 🔌 client socket + unread store
import { connectAndJoin } from "@/lib/socketClient";
import { useNotifStore } from "@/lib/notificationsStore";
import { useTimezoneSync } from "@/hooks/useTimezoneSync";

// Wire 402 billing_required responses to open BillingRequiredModal from any axios call
axios.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 402 && err?.response?.data?.error === "billing_required") {
      dispatchBillingRequired(err.response.data?.redirect);
    }
    return Promise.reject(err);
  },
);

/** Public routes where we must NOT init voice/callback/leads/widgets */
const PUBLIC_ROUTES = new Set<string>([
  "/",
  "/login",
  "/pricing-select",
  "/signup",
  "/verify-email",
  "/billing",
  "/trial-expired",
  "/auth/signin",
  "/auth/signup",
  "/auth/forgot",
  "/auth/reset/[token]",
  "/legal/terms",
  "/legal/privacy",
  "/legal/acceptance",
]);

export default function App({ Component, pageProps }: AppProps) {
  return (
    <SessionProvider session={pageProps.session}>
      <InnerApp Component={Component} pageProps={pageProps} />
    </SessionProvider>
  );
}

function InnerApp({
  Component,
  pageProps,
}: Pick<AppProps, "Component" | "pageProps">) {
  const { data: session, status } = useSession();
  const authed = status === "authenticated" && !!session?.user?.email;
  useTimezoneSync(authed);

  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;

    let primed = false;
    const primeAudio = async () => {
      if (primed) return;
      primed = true;

      try {
        const w = window as any;
        const AudioContextCtor = window.AudioContext || w.webkitAudioContext;
        if (!AudioContextCtor) return;

        const ctx: AudioContext =
          w.__crmAudioContext && w.__crmAudioContext.state !== "closed"
            ? w.__crmAudioContext
            : new AudioContextCtor();
        w.__crmAudioContext = ctx;

        if (ctx.state === "suspended") {
          await ctx.resume();
        }
      } catch {}
    };

    window.addEventListener("click", primeAudio, { once: true });
    window.addEventListener("keydown", primeAudio, { once: true });
    window.addEventListener("touchstart", primeAudio, { once: true });

    return () => {
      window.removeEventListener("click", primeAudio);
      window.removeEventListener("keydown", primeAudio);
      window.removeEventListener("touchstart", primeAudio);
    };
  }, []);

  // ✅ Capture ?ref=CODE from affiliate share links (persist ~30 days)
  useEffect(() => {
    try {
      if (typeof window === "undefined") return;

      const params = new URLSearchParams(window.location.search);
      const ref = (params.get("ref") || "").trim();
      if (!ref) return;

      // localStorage for client reads; cookie for server/API reads
      localStorage.setItem("affiliate_code", ref);
      document.cookie = `affiliate_code=${encodeURIComponent(
        ref,
      )}; path=/; max-age=2592000; SameSite=Lax`;
    } catch {
      // non-fatal
    }
  }, []);
  const isPublic = useMemo(
    () => PUBLIC_ROUTES.has(router.pathname),
    [router.pathname],
  );
  const [billingBannerDismissed, setBillingBannerDismissed] = useState(false);

  const [leads, setLeads] = useState<any[]>([]);
  const isDialing =
    typeof window !== "undefined" &&
    window.location.href.includes("dial-session");

  const hideAssistant =
    isPublic || router.pathname === "/" || router.pathname === "/billing";

  useEffect(() => {
    if (typeof window === "undefined") return;
    setBillingBannerDismissed(
      window.sessionStorage.getItem("cove.billingBannerDismissed") === "1",
    );
  }, [router.pathname]);

  useEffect(() => {
    if (!authed || isPublic) return;
    const user = session?.user as any;
    if (user?.role === "admin") return;

    if (user?.emailVerified !== true) {
      window.location.href = `/verify-email?email=${encodeURIComponent(String(user?.email || ""))}`;
      return;
    }

    const hasNewSignupTrial = Boolean(user?.trialStartedAt);
    if (hasNewSignupTrial) {
      const trialEndsAtMs = user?.trialEndsAt ? new Date(user.trialEndsAt).getTime() : 0;
      const trialExpired = Boolean(trialEndsAtMs && Date.now() > trialEndsAtMs);
      const cardOnFile = user?.cardOnFile === true;

      if (trialExpired && !cardOnFile) {
        window.location.href = "/trial-expired";
        return;
      }

      if (trialExpired && cardOnFile && user?.subscriptionStatus !== "active") {
        window.location.href = `/billing?email=${encodeURIComponent(
          String(user?.email || ""),
        )}&reason=reactivate`;
        return;
      }
    }

    if (user?.accountActivated === true) return;
  }, [authed, isPublic, session?.user]);

  /** Load leads for reminders (only when logged in on internal pages) */
  useEffect(() => {
    if (!authed || isPublic) return;

    // ensure socket.io server is initialized (backs the /api/socket handler that calls initSocket)
    fetch("/api/socket").catch(() => {});

    const fetchLeads = async () => {
      try {
        const res = await axios.get("/api/leads/my");
        setLeads(res.data);
      } catch (err) {
        // Quietly ignore (e.g., 401 if session expired)
        console.warn("Leads fetch skipped:", (err as any)?.message || err);
      }
    };

    fetchLeads();
  }, [authed, isPublic, router.pathname]);

  /** Auto-detect & persist the agent's timezone */
  useEffect(() => {
    if (!authed) return;
    if (typeof window === "undefined") return;

    let cancelled = false;

    const syncTimezone = async () => {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
        if (!tz) return;

        const lastSaved = localStorage.getItem("agent.tz") || "";
        if (lastSaved === tz) return;

        const r = await fetch("/api/settings/detect-timezone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tz }),
        });
        if (!cancelled) localStorage.setItem("agent.tz", tz);
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          console.warn("Timezone detect failed:", j?.message || r.statusText);
        }
      } catch (e) {
        console.warn("Timezone detect error:", e);
      }
    };

    syncTimezone();

    const onVisibility = () => {
      if (document.visibilityState === "visible") syncTimezone();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [authed]);

  /** Page shell */
  const pageContent = (
    <>
      <Head>
        <title>Cove CRM</title>
      </Head>

      {/* Auth-only banners */}
      {authed &&
        !isPublic &&
        (session?.user as any)?.role !== "admin" &&
        Boolean((session?.user as any)?.trialStartedAt) &&
        (session?.user as any)?.cardOnFile !== true &&
        !billingBannerDismissed && (
          <div className="sticky top-0 z-[10000] border-b border-[#1e293b] bg-[#0f172a] px-4 py-3 text-white shadow-lg">
            <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-gray-100">
                Add a payment method in Billing & Usage to activate your phone number and keep access after your trial ends.
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    window.location.href = "/settings?tab=billing";
                  }}
                  className="rounded bg-[var(--cove-accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
                >
                  Go to Billing
                </button>
                <button
                  type="button"
                  aria-label="Dismiss billing reminder"
                  onClick={() => {
                    window.sessionStorage.setItem("cove.billingBannerDismissed", "1");
                    setBillingBannerDismissed(true);
                  }}
                  className="rounded border border-white/15 px-3 py-2 text-sm text-gray-300 hover:bg-white/10 hover:text-white"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

      {authed && !isPublic && <CallbackBanner />}

      {authed && !isPublic && (
        <>
          <IncomingCallBanner />
          <InternalSync />
          <ReminderBanner leads={leads} inDialSession={isDialing} />
        </>
      )}


      {/* 🔌 Socket bridge mounts only when authed & internal */}
      {authed && !isPublic && (
        <SocketBridge email={String(session?.user?.email || "")} />
      )}

      {/* Page content */}
      <Component {...pageProps} />

      {/* Billing required modal — shown when any billable API returns 402 billing_required */}
      {authed && !isPublic && <BillingRequiredModal />}

      {/* Toasts */}
      <Toaster position="top-right" reverseOrder={false} />
    </>
  );

  // Mount Softphone only when authenticated & not on public routes
  if (authed && !isPublic) {
    return <SoftphoneProvider>{pageContent}</SoftphoneProvider>;
  }
  return pageContent;
}

/**
 * 🔌 SocketBridge
 * - Connects to Socket.IO via connectAndJoin
 * - Joins the per-user room by email
 * - Increments unread badge on inbound text: io.to(user.email).emit("message:new", { leadId, type: "inbound", ... })
 */
function SocketBridge({ email }: { email: string }) {
  const inc = useNotifStore((s) => s.inc);

  useEffect(() => {
    if (!email) return;

    // establish client socket + join room (handles reconnect internally if your socketClient does)
    const s = connectAndJoin(email);
    if (!s) return;

    const handler = (payload: any) => {
      try {
        const leadId =
          payload?.leadId || payload?.lead?._id || payload?.message?.leadId;
        const isInbound =
          payload?.type === "inbound" ||
          payload?.direction === "inbound" ||
          payload?.message?.direction === "inbound";

        if (leadId && isInbound) {
          inc(leadId);
        }
      } catch {
        // no-op
      }
    };

    s.on("message:new", handler);
    return () => {
      s.off("message:new", handler);
    };
  }, [email, inc]);

  return null;
}
