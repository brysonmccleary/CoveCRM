// components/settings/A2PVerificationPanel.tsx
import { useEffect, useState } from "react";
import A2PVerificationForm from "./A2PVerificationForm";

type A2PApplicationStatus = "approved" | "pending" | "declined";

type NextAction =
  | "start_profile"
  | "submit_brand"
  | "brand_pending"
  | "submit_campaign"
  | "campaign_pending"
  | "create_messaging_service"
  | "ready";

interface A2PStatusResponse {
  nextAction: NextAction;
  registrationStatus: string;
  messagingReady: boolean;
  canSendSms: boolean;
  applicationStatus: A2PApplicationStatus;
  a2pStatusLabel: string;
  declinedReason: string | null;
  brand: { sid: string | null; status: string };
  campaign: { sid: string | null; status: string };
  messagingServiceSid: string | null;
  senders: {
    phoneNumberSid: string;
    phoneNumber?: string | null;
    attached: boolean;
    a2pReady: boolean;
  }[];
  hints: {
    hasProfile: boolean;
    hasBrand: boolean;
    hasCampaign: boolean;
    hasMessagingService: boolean;
  };
}

export default function A2PVerificationPanel() {
  const [status, setStatus] = useState<A2PStatusResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/a2p/status");
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || "Failed to load A2P status");
        }
        const data: A2PStatusResponse = await res.json();
        if (!mounted) return;
        setStatus(data);
      } catch (err: any) {
        if (!mounted) return;
        console.error("A2P status fetch error:", err);
        setError(err?.message || "Failed to load A2P status");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, []);

  const applicationStatus: A2PApplicationStatus =
    status?.applicationStatus || "pending";

  const badgeStyles =
    applicationStatus === "approved"
      ? "bg-green-500/10 text-green-400 border border-green-500/40"
      : applicationStatus === "declined"
      ? "bg-red-500/10 text-red-400 border border-red-500/40"
      : "bg-yellow-500/10 text-yellow-300 border border-yellow-500/40";

  const nextActionLabel = (() => {
    if (!status) return "";
    switch (status.nextAction) {
      case "start_profile":
        return "Start A2P brand verification";
      case "submit_brand":
        return "Submit brand details";
      case "brand_pending":
        return "Brand is under review";
      case "submit_campaign":
        return "Submit messaging campaign details";
      case "campaign_pending":
        return "Campaign is under review";
      case "create_messaging_service":
        return "Finalizing messaging service";
      case "ready":
      default:
        return "Ready to send SMS";
    }
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-semibold">A2P Registration</h3>
          <p className="text-sm text-gray-300">
            Register your brand and messaging use case so your numbers are fully
            approved to send compliant SMS through CoveCRM.
          </p>
        </div>

        <div
          className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${badgeStyles}`}
        >
          {status?.a2pStatusLabel ?? "Loading…"}
        </div>
      </div>

      {loading && (
        <p className="text-sm text-gray-400">Loading A2P status…</p>
      )}

      {error && !loading && (
        <p className="text-sm text-red-400">
          {error} — you can still submit the form below, and we’ll process it.
        </p>
      )}

      {status && !loading && (
        <div className="space-y-3 text-sm">
          <p className="text-gray-200">
            <span className="font-semibold">Current status:</span>{" "}
            {status.a2pStatusLabel}
          </p>

          {status.declinedReason && (
            <div className="rounded-md border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-200">
              <p className="font-semibold mb-1">Why it was declined:</p>
              <p>{status.declinedReason}</p>
            </div>
          )}

          <p className="text-gray-300">
            <span className="font-semibold">Next step:</span>{" "}
            {nextActionLabel}
          </p>

          <p className="text-gray-400">
            Messaging service:{" "}
            {status.messagingServiceSid
              ? status.messagingServiceSid
              : "Not created yet"}
          </p>

          {status.senders?.length > 0 && (
            <div className="space-y-1">
              <p className="font-semibold text-gray-200">Connected numbers</p>
              <ul className="space-y-1 text-gray-300 text-xs">
                {status.senders.map((s) => (
                  <li key={s.phoneNumberSid}>
                    {s.phoneNumber ?? s.phoneNumberSid}{" "}
                    {s.a2pReady ? "— A2P ready" : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {applicationStatus === "approved" && (
            <p className="text-xs text-green-300">
              Your A2P registration is approved. Your connected numbers can send
              SMS via CoveCRM. You can still update your details later if
              needed.
            </p>
          )}

          {applicationStatus !== "approved" && (
            <p className="text-xs text-yellow-200">
              Once approved, CoveCRM will automatically attach your approved
              campaign to your numbers and you&apos;ll be cleared to send SMS.
              We&apos;ll email you when your status changes.
            </p>
          )}

          <div className="pt-2">
            {applicationStatus === "approved" ? (
              <button
                type="button"
                onClick={() => setShowForm((v) => !v)}
                className="inline-flex items-center px-3 py-1.5 rounded-md border border-gray-500/60 text-xs font-medium text-gray-100 hover:bg-gray-800 transition-colors"
              >
                {showForm ? "Hide registration details" : "View / edit details"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="inline-flex items-center px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-xs font-medium text-white transition-colors"
              >
                {status.nextAction === "start_profile"
                  ? "Start A2P verification"
                  : "Continue A2P verification"}
              </button>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <div className="mt-4">
          <A2PVerificationForm />
        </div>
      )}

      {!status && !loading && !error && (
        <div className="mt-2">
          {/* Fallback if the status endpoint returns nothing weirdly */}
          <A2PVerificationForm />
        </div>
      )}
    </div>
  );
}
