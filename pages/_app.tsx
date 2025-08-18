// /pages/_app.tsx
import "../styles/globals.css";
import type { AppProps } from "next/app";
import { SessionProvider, useSession } from "next-auth/react";
import { Toaster } from "react-hot-toast";
import ChatAssistantWidget from "@/components/ChatAssistantWidget";
import InternalSync from "@/pages/internal-sync";
import ReminderBanner from "@/components/ReminderBanner";
import CallbackBanner from "@/components/CallbackBanner";
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Head from "next/head";
import { useRouter } from "next/router";
import SoftphoneProvider from "@/components/telephony/SoftphoneProvider";

/** Public routes where we must NOT init voice/callback/leads/widgets */
const PUBLIC_ROUTES = new Set<string>([
  "/",
  "/login",
  "/signup",
  "/billing",
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

  const router = useRouter();
  const isPublic = useMemo(
    () => PUBLIC_ROUTES.has(router.pathname),
    [router.pathname],
  );

  const [leads, setLeads] = useState<any[]>([]);
  const isDialing =
    typeof window !== "undefined" &&
    window.location.href.includes("dial-session");

  const hideAssistant =
    isPublic || router.pathname === "/" || router.pathname === "/billing";

  /** Load leads for reminders (only when logged in on internal pages) */
  useEffect(() => {
    if (!authed || isPublic) return;

    // ensure socket.io server is initialized
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
        <title>CRM Cove</title>
      </Head>

      {/* Auth-only banners */}
      {authed && !isPublic && <CallbackBanner />}

      {authed && !isPublic && (
        <>
          <InternalSync />
          <ReminderBanner leads={leads} inDialSession={isDialing} />
        </>
      )}

      {/* Assistant ONLY when signed-in and on internal pages */}
      {authed && !hideAssistant && (
        <div className="cursor-pointer">
          <ChatAssistantWidget />
        </div>
      )}

      {/* Page content */}
      <Component {...pageProps} />

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
