import type { BusinessIdentity } from "./BusinessIdentityStep";

type NoPageGuidedSetupProps = {
  businessIdentity: BusinessIdentity;
  onRefreshPages: () => void | Promise<void>;
  onAlreadyHavePage: () => void;
  refreshing?: boolean;
};

const checklistItems = [
  "Create a Facebook business Page",
  "Use your selected business name",
  "Choose an insurance/business category",
  "Return to CoveCRM and click Refresh Pages",
  "Select the Page before launch",
];

const exampleNames = [
  "Desert Valley Coverage",
  "Legacy Life Solutions",
  "Heritage Family Benefits",
];

export default function NoPageGuidedSetup({
  businessIdentity,
  onRefreshPages,
  onAlreadyHavePage,
  refreshing = false,
}: NoPageGuidedSetupProps) {
  const businessName = businessIdentity.businessName.trim() || "Your selected business name";
  const leadFocus = businessIdentity.leadFocus.trim() || "General Life Insurance";
  const style = businessIdentity.stylePreference.trim() || "Professional";

  return (
    <section className="overflow-hidden rounded-3xl border border-amber-400/20 bg-[#141414] shadow-2xl shadow-black/20">
      <div className="border-b border-white/10 bg-gradient-to-r from-amber-500/10 via-emerald-500/10 to-blue-500/10 p-5 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">Business Page setup</p>
            <h2 className="mt-2 text-2xl font-bold text-white">Let&apos;s get your business Page ready</h2>
            <div className="mt-3 space-y-2 text-sm leading-6 text-gray-200">
              <p>You don&apos;t need a new personal Facebook account.</p>
              <p>Customers will see your business Page, not your personal profile.</p>
              <p>We&apos;ll help you create a simple business Page name and identity.</p>
            </div>
          </div>

          <div className="w-full rounded-2xl border border-white/10 bg-black/20 p-4 lg:w-80">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Use this identity</p>
            <dl className="mt-3 space-y-3">
              <div>
                <dt className="text-xs text-gray-500">Business name</dt>
                <dd className="mt-0.5 text-sm font-semibold text-white">{businessName}</dd>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <div>
                  <dt className="text-xs text-gray-500">Lead focus</dt>
                  <dd className="mt-0.5 text-sm font-medium text-gray-100">{leadFocus}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Style</dt>
                  <dd className="mt-0.5 text-sm font-medium text-gray-100">{style}</dd>
                </div>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1fr_0.85fr]">
        <div>
          <p className="text-sm font-semibold text-white">Beginner checklist</p>
          <ol className="mt-4 space-y-3">
            {checklistItems.map((item, index) => (
              <li key={item} className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-bold text-emerald-200">
                  {index + 1}
                </span>
                <span className="pt-1 text-sm text-gray-200">{item}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex flex-col justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div>
            <p className="text-sm font-semibold text-white">No business Page yet?</p>
            <p className="mt-2 text-sm leading-6 text-gray-400">
              Open Facebook&apos;s Page creator, use the name above, then come back and refresh. CoveCRM will look for the Page you can use for ads.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {exampleNames.map((name) => (
                <span key={name} className="rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-xs text-blue-100/80">
                  {name}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-6 grid gap-3">
            <a
              href="https://www.facebook.com/pages/create"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500"
            >
              Open Facebook Page Creator
            </a>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={onRefreshPages}
                disabled={refreshing}
                className="min-h-11 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {refreshing ? "Refreshing..." : "Refresh Pages"}
              </button>
              <button
                type="button"
                onClick={onAlreadyHavePage}
                className="min-h-11 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-gray-100 transition hover:bg-white/10"
              >
                I already have a Page
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
