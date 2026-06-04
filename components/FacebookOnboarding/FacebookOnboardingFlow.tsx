import { useCallback, useEffect, useState } from "react";
import AdWizard from "@/components/FacebookAds/AdWizard";
import MetaConnectPanel from "@/components/MetaConnectPanel";
import FacebookTrustIntro from "./FacebookTrustIntro";
import LaunchReviewStep from "./LaunchReviewStep";
import LaunchReadinessCard, { type LaunchReadiness } from "./LaunchReadinessCard";
import NoPageGuidedSetup from "./NoPageGuidedSetup";
import PageIdentityCard, { type PageIdentity } from "./PageIdentityCard";

type FacebookOnboardingFlowProps = {
  selectedLeadType: string;
  onLeadTypeChange: (leadType: string) => void;
};

type FacebookStatus = {
  connected?: boolean;
  pageName?: string;
  pageId?: string;
};

type ConnectedPage = PageIdentity & {
  id?: string;
  selected?: boolean;
};

export default function FacebookOnboardingFlow({
  selectedLeadType,
  onLeadTypeChange,
}: FacebookOnboardingFlowProps) {
  const [status, setStatus] = useState<FacebookStatus | null>(null);
  const [connectedPages, setConnectedPages] = useState<ConnectedPage[]>([]);
  const [showAdvancedSetup, setShowAdvancedSetup] = useState(false);
  const [refreshingPages, setRefreshingPages] = useState(false);

  const loadFacebookDisplayState = useCallback(async () => {
    setRefreshingPages(true);
    try {
      const statusResponse = await fetch("/api/meta/sync-insights");
      const data = statusResponse.ok ? await statusResponse.json() : null;
      if (!data) return;

      const nextStatus = {
        connected: Boolean(data.connected),
        pageName: data.pageName || "",
        pageId: data.pageId || "",
      };
      setStatus(nextStatus);

      if (nextStatus.connected) {
        const pagesResponse = await fetch("/api/meta/pages");
        const pagesData = pagesResponse.ok ? await pagesResponse.json() : null;
        const pages = Array.isArray(pagesData?.pages) ? pagesData.pages : [];
        setConnectedPages(pages);
      } else {
        setConnectedPages([]);
      }
    } catch {
      setStatus(null);
      setConnectedPages([]);
    } finally {
      setRefreshingPages(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadInitialDisplayState() {
      if (mounted) {
        await loadFacebookDisplayState();
      }
    }

    loadInitialDisplayState();

    return () => {
      mounted = false;
    };
  }, [loadFacebookDisplayState]);

  const usablePages = connectedPages.filter((page) => Boolean(page.name?.trim()));
  const selectedPage =
    usablePages.find((page) => page.selected) ||
    usablePages.find((page) => String(page.id || "") === String(status?.pageId || "")) ||
    null;
  const pageIdentity: PageIdentity | null =
    selectedPage ||
    (status?.pageName ? { name: status.pageName } : null);
  const needsPageGuidance = Boolean(status?.connected) && (!selectedPage || usablePages.length === 0);
  const displayPageIdentity = needsPageGuidance ? null : pageIdentity;
  const readinessItems = [
    {
      key: "facebook",
      label: "Facebook connected",
      ready: Boolean(status?.connected),
      missingText: "Continue with Facebook to connect your account.",
    },
    {
      key: "page",
      label: "Business Page selected",
      ready: Boolean(displayPageIdentity?.name?.trim()),
      missingText: "Choose a business Page before launch.",
    },
    {
      key: "lead-type",
      label: "Lead type selected",
      ready: Boolean(selectedLeadType),
      missingText: "Choose the type of leads you want.",
    },
    {
      key: "paused",
      label: "Campaign will launch paused",
      ready: true,
    },
  ];
  const readiness: LaunchReadiness = {
    ready: readinessItems.every((item) => item.ready),
    items: readinessItems,
    missing: readinessItems
      .filter((item) => !item.ready)
      .map((item) => item.missingText || item.label),
  };

  return (
    <div className="space-y-7">
      <FacebookTrustIntro connected={Boolean(status?.connected)} />

      {needsPageGuidance && (
        <NoPageGuidedSetup
          onRefreshPages={loadFacebookDisplayState}
          onAlreadyHavePage={() => setShowAdvancedSetup(true)}
          refreshing={refreshingPages}
        />
      )}

      <PageIdentityCard page={displayPageIdentity} />

      <LaunchReadinessCard readiness={readiness} />

      <section className="rounded-3xl border border-white/10 bg-[#0f172a] p-5 shadow-2xl shadow-black/20 sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-300">Step 1</p>
            <h2 className="mt-1 text-2xl font-bold text-white">Connect Facebook and choose your page</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">
              Connect Facebook, choose the Facebook Page customers will see, then choose the Ad Account to run ads from.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAdvancedSetup((current) => !current)}
            className="min-h-10 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-gray-200 transition hover:bg-white/10"
          >
            {showAdvancedSetup ? "Hide connection details" : "Connection details"}
          </button>
        </div>

        <div className="mt-5">
          {showAdvancedSetup ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <MetaConnectPanel leadType={selectedLeadType} />
            </div>
          ) : status?.connected ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-white">Facebook is connected</p>
                <p className="mt-1 text-xs text-gray-400">
                  {displayPageIdentity?.name ? `Business page selected: ${displayPageIdentity.name}` : "Choose a business Page before launching ads."}
                </p>
                {!displayPageIdentity?.name && (
                  <p className="mt-2 text-xs font-medium text-amber-300">
                    Already have a Page? Click Review page and select it. Need one? Create it directly on Facebook, then return and refresh.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowAdvancedSetup(true)}
                className="min-h-10 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
              >
                Review page
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border border-blue-500/20 bg-blue-950/20 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-base font-semibold text-white">No Facebook business page connected yet</p>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100/80">
                    Continue with Facebook, then choose the Facebook Page customers will see and the Ad Account to run ads from.
                  </p>
                </div>
                <a
                  href="/api/meta/connect"
                  className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500"
                >
                  Continue with Facebook
                </a>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-300">Step 4</p>
          <h2 className="mt-1 text-2xl font-bold text-white">Choose lead type and budget</h2>
          <p className="mt-2 text-sm text-gray-400">
            CoveCRM generates the ad, creates the business campaign, and keeps it paused until you activate it.
          </p>
        </div>
        {!readiness.ready && (
          <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100/90">
            <p className="font-semibold text-amber-50">Not ready to launch yet</p>
            <p className="mt-1">
              Finish the missing setup items above before using the launch controls. Your campaign will still launch paused first for review.
            </p>
          </div>
        )}
        <AdWizard onLeadTypeChange={onLeadTypeChange} />
      </section>

      <LaunchReviewStep
        page={displayPageIdentity}
        leadType={selectedLeadType}
        readiness={readiness}
      />
    </div>
  );
}
