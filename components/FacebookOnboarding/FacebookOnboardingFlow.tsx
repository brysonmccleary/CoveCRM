import { useCallback, useEffect, useRef, useState } from "react";
import AdWizard from "@/components/FacebookAds/AdWizard";
import FacebookTrustIntro from "./FacebookTrustIntro";
import NoPageGuidedSetup from "./NoPageGuidedSetup";

type FacebookOnboardingFlowProps = {
  selectedLeadType: string;
  onLeadTypeChange: (leadType: string) => void;
};

type ConnectedPage = {
  id: string;
  name: string;
  pictureUrl?: string;
  category?: string;
  link?: string;
};

type AdAccount = { accountId: string; name: string; status?: number };

export default function FacebookOnboardingFlow({
  selectedLeadType,
  onLeadTypeChange,
}: FacebookOnboardingFlowProps) {
  const [connected, setConnected] = useState(false);
  const [selectedPage, setSelectedPage] = useState<ConnectedPage | null>(null);
  const [selectedAdAccount, setSelectedAdAccount] = useState<AdAccount | null>(null);
  const [pages, setPages] = useState<ConnectedPage[]>([]);
  const [adAccounts, setAdAccounts] = useState<AdAccount[]>([]);
  const [refreshing, setRefreshing] = useState(true);
  const [awaitingNewPage, setAwaitingNewPage] = useState(false);
  const [awaitingNewAdAccount, setAwaitingNewAdAccount] = useState(false);
  const [showPageSetup, setShowPageSetup] = useState(false);
  const [showCreatePageSetup, setShowCreatePageSetup] = useState(false);
  const [showAdAccountSetup, setShowAdAccountSetup] = useState(false);
  const [selectingPageId, setSelectingPageId] = useState("");
  const [selectingAdAccountId, setSelectingAdAccountId] = useState("");
  const [setupError, setSetupError] = useState("");
  const knownPageIds = useRef<string[]>([]);
  const knownAdAccountIds = useRef<string[]>([]);

  const refreshSetup = useCallback(async (options?: {
    preferNewPage?: boolean;
    preferNewAdAccount?: boolean;
    pageId?: string;
    adAccountId?: string;
  }) => {
    setRefreshing(true);
    setSetupError("");
    try {
      const response = await fetch("/api/meta/refresh-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadType: selectedLeadType,
          preferNewPage: options?.preferNewPage === true,
          preferNewAdAccount: options?.preferNewAdAccount === true,
          knownPageIds: knownPageIds.current,
          knownAdAccountIds: knownAdAccountIds.current,
          pageId: options?.pageId,
          adAccountId: options?.adAccountId,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Facebook could not be refreshed right now.");
      setConnected(Boolean(data?.connected));
      setPages(Array.isArray(data?.pages) ? data.pages : []);
      setAdAccounts(Array.isArray(data?.adAccounts) ? data.adAccounts : []);
      setSelectedPage(data?.page || null);
      setSelectedAdAccount(data?.adAccount || null);
      if (data?.page && options?.preferNewPage && !knownPageIds.current.includes(String(data.page.id))) {
        setAwaitingNewPage(false);
        setShowPageSetup(false);
      }
      if (
        data?.adAccount &&
        options?.preferNewAdAccount &&
        !knownAdAccountIds.current.includes(String(data.adAccount.accountId))
      ) {
        setAwaitingNewAdAccount(false);
        setShowAdAccountSetup(false);
      }
      return data;
    } catch (error: any) {
      setSetupError(error?.message || "Facebook could not be refreshed right now.");
      return null;
    } finally {
      setRefreshing(false);
    }
  }, [selectedLeadType]);

  useEffect(() => {
    refreshSetup();
  }, [refreshSetup]);

  useEffect(() => {
    if (!awaitingNewPage) return;
    const checkForPage = () => refreshSetup({ preferNewPage: true });
    const interval = window.setInterval(checkForPage, 4000);
    window.addEventListener("focus", checkForPage);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", checkForPage);
    };
  }, [awaitingNewPage, refreshSetup]);

  useEffect(() => {
    if (!awaitingNewAdAccount) return;
    const checkForAdAccount = () => refreshSetup({ preferNewAdAccount: true });
    const interval = window.setInterval(checkForAdAccount, 4000);
    window.addEventListener("focus", checkForAdAccount);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", checkForAdAccount);
    };
  }, [awaitingNewAdAccount, refreshSetup]);

  const openPageCreator = () => {
    knownPageIds.current = pages.map((page) => page.id);
    setAwaitingNewPage(true);
    window.open("https://www.facebook.com/pages/create", "_blank", "noopener,noreferrer");
  };

  const selectPage = async (pageId: string) => {
    setSelectingPageId(pageId);
    const data = await refreshSetup({ pageId });
    if (String(data?.page?.id || "") === pageId) {
      setShowPageSetup(false);
      setShowCreatePageSetup(false);
    }
    setSelectingPageId("");
  };

  const openAdAccountCreator = () => {
    knownAdAccountIds.current = adAccounts.map((account) => account.accountId);
    setShowAdAccountSetup(true);
    setAwaitingNewAdAccount(true);
    window.open("https://business.facebook.com/settings/ad-accounts", "_blank", "noopener,noreferrer");
  };

  const selectAdAccount = async (accountId: string) => {
    setSelectingAdAccountId(accountId);
    const data = await refreshSetup({ adAccountId: accountId });
    if (String(data?.adAccount?.accountId || "") === accountId) {
      setAwaitingNewAdAccount(false);
      setShowAdAccountSetup(false);
    }
    setSelectingAdAccountId("");
  };

  const facebookReady = Boolean(
    connected &&
    selectedPage &&
    selectedAdAccount?.status === 1 &&
    !showPageSetup &&
    !showCreatePageSetup &&
    !showAdAccountSetup
  );
  const needsPageSetup = connected && !selectedPage;

  return (
    <div className="space-y-7">
      <FacebookTrustIntro connected={connected} />

      {!connected && !refreshing && (
        <section className="rounded-3xl border border-blue-500/20 bg-[#0f172a] p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-300">Step 1</p>
          <h2 className="mt-1 text-2xl font-bold text-white">Connect Facebook</h2>
          <p className="mt-2 text-sm text-gray-400">Sign in once so CoveCRM can find your Page and ad account.</p>
          <button
            type="button"
            onClick={() => { window.location.href = "/api/meta/connect"; }}
            className="mt-5 inline-flex min-h-12 items-center justify-center rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-500"
          >
            Continue with Facebook
          </button>
        </section>
      )}

      {(needsPageSetup || showCreatePageSetup) && (
        <NoPageGuidedSetup
          onRefreshPages={() => refreshSetup({ preferNewPage: true })}
          onOpenPageCreator={openPageCreator}
          pages={pages}
          onSelectPage={selectPage}
          refreshing={refreshing || awaitingNewPage}
          selectedLeadType={selectedLeadType}
        />
      )}

      {connected && selectedPage && showPageSetup && !showCreatePageSetup && (
        <section className="rounded-3xl border border-blue-500/25 bg-[#0f172a] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-300">Choose your Facebook Page</p>
              <h2 className="mt-1 text-xl font-bold text-white">Which Page should customers see?</h2>
            </div>
            <button
              type="button"
              onClick={() => setShowPageSetup(false)}
              className="text-sm font-semibold text-gray-400 hover:text-white"
            >
              Cancel
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {pages.map((page) => {
              const isSelected = page.id === selectedPage.id;
              const isSaving = selectingPageId === page.id;
              return (
                <button
                  key={page.id}
                  type="button"
                  onClick={() => selectPage(page.id)}
                  disabled={Boolean(selectingPageId)}
                  className={`flex min-h-20 items-center gap-3 rounded-2xl border p-4 text-left transition disabled:cursor-wait disabled:opacity-60 ${
                    isSelected
                      ? "border-emerald-400/40 bg-emerald-500/10"
                      : "border-white/10 bg-white/[0.04] hover:border-blue-400/40 hover:bg-blue-500/10"
                  }`}
                >
                  {page.pictureUrl ? (
                    <div
                      aria-hidden="true"
                      className="h-12 w-12 shrink-0 rounded-xl bg-cover bg-center"
                      style={{ backgroundImage: `url(${page.pictureUrl})` }}
                    />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 font-bold text-blue-100">
                      {page.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-white">{page.name}</p>
                    <p className={`mt-1 text-xs ${isSelected ? "text-emerald-300" : "text-blue-300"}`}>
                      {isSaving ? "Saving..." : isSelected ? "Currently selected" : "Select this Page"}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setShowCreatePageSetup(true)}
            className="mt-4 min-h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-gray-200 hover:bg-white/10"
          >
            Create a different Facebook Page
          </button>
        </section>
      )}

      {connected && selectedPage && selectedAdAccount?.status === 1 && !showPageSetup && !showCreatePageSetup && !showAdAccountSetup && (
        <section className="rounded-3xl border border-emerald-500/25 bg-emerald-950/20 p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              {selectedPage.pictureUrl ? (
                <div
                  aria-hidden="true"
                  className="h-12 w-12 rounded-xl bg-cover bg-center"
                  style={{ backgroundImage: `url(${selectedPage.pictureUrl})` }}
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/15 font-bold text-emerald-100">
                  {selectedPage.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Facebook ready</p>
                <p className="mt-1 font-semibold text-white">{selectedPage.name}</p>
                <p className="mt-1 text-xs text-emerald-100/70">
                  {selectedAdAccount.name || "Meta ad account"} · ID {selectedAdAccount.accountId}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              <button
                type="button"
                onClick={() => setShowPageSetup(true)}
                className="text-sm font-semibold text-gray-400 underline decoration-white/20 underline-offset-4 hover:text-white"
              >
                Change Page
              </button>
              <button
                type="button"
                onClick={() => setShowAdAccountSetup(true)}
                className="text-sm font-semibold text-gray-400 underline decoration-white/20 underline-offset-4 hover:text-white"
              >
                Change or create ad account
              </button>
            </div>
          </div>
        </section>
      )}

      {connected && selectedPage && (!selectedAdAccount || selectedAdAccount.status !== 1 || showAdAccountSetup) && (
        <section className="rounded-3xl border border-blue-500/25 bg-[#0f172a] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-300">Ad account setup</p>
              <h2 className="mt-1 text-xl font-bold text-white">Create or choose the account that will run this ad</h2>
              <p className="mt-2 max-w-2xl text-sm text-gray-400">
                Meta requires you to confirm the business, currency, time zone, billing details, and any account-creation limits. CoveCRM will detect the new account after Meta creates it.
              </p>
            </div>
            {selectedAdAccount && (
              <button
                type="button"
                onClick={() => { setAwaitingNewAdAccount(false); setShowAdAccountSetup(false); }}
                className="text-sm font-semibold text-gray-400 hover:text-white"
              >
                Cancel
              </button>
            )}
          </div>

          {adAccounts.length > 0 && (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {adAccounts.map((account) => {
                const isActive = account.status === 1;
                const isSelected = account.accountId === selectedAdAccount?.accountId;
                return (
                  <button
                    key={account.accountId}
                    type="button"
                    onClick={() => selectAdAccount(account.accountId)}
                    disabled={!isActive || Boolean(selectingAdAccountId)}
                    className={`rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      isSelected
                        ? "border-emerald-400/40 bg-emerald-500/10"
                        : "border-white/10 bg-white/[0.04] hover:border-blue-400/40 hover:bg-blue-500/10"
                    }`}
                  >
                    <p className="font-semibold text-white">{account.name || `Ad account ${account.accountId}`}</p>
                    <p className="mt-1 text-xs text-gray-400">ID {account.accountId}</p>
                    <p className={`mt-2 text-xs font-semibold ${isActive ? "text-emerald-300" : "text-amber-300"}`}>
                      {selectingAdAccountId === account.accountId
                        ? "Saving..."
                        : isSelected
                          ? "Currently selected"
                          : isActive
                            ? "Active — select this account"
                            : "Not active in Meta"}
                    </p>
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="font-semibold text-white">Need a new ad account?</p>
            <p className="mt-1 text-sm text-gray-400">
              Create it in Meta Business Settings. Leave this CoveCRM page open; it checks for the new active account automatically.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={openAdAccountCreator}
                className="min-h-11 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-500"
              >
                Create new ad account in Meta
              </button>
              <button
                type="button"
                onClick={() => refreshSetup({ preferNewAdAccount: awaitingNewAdAccount })}
                disabled={refreshing}
                className="min-h-11 rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-gray-200 hover:bg-white/10 disabled:cursor-wait disabled:opacity-60"
              >
                {refreshing || awaitingNewAdAccount ? "Checking for new account..." : "Refresh accounts"}
              </button>
            </div>
          </div>
        </section>
      )}

      {setupError && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-950/20 p-4 text-sm text-amber-100">
          {setupError} <button type="button" onClick={() => refreshSetup()} className="font-semibold underline">Try again</button>
        </div>
      )}

      {facebookReady && (
        <section className="space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-300">Step 2</p>
            <h2 className="mt-1 text-2xl font-bold text-white">Build and launch your ad</h2>
            <p className="mt-2 text-sm text-gray-400">Choose the lead type, states, and budget. CoveCRM handles the Meta setup.</p>
          </div>
          <AdWizard onLeadTypeChange={onLeadTypeChange} />
        </section>
      )}
    </div>
  );
}
