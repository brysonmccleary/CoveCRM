type NoPageGuidedSetupProps = {
  onRefreshPages: () => void | Promise<void>;
  onAlreadyHavePage: () => void;
  refreshing?: boolean;
};

const checklistItems = [
  "Create a Facebook business Page",
  "Choose an insurance/business category",
  "Return to CoveCRM and click Refresh Pages",
  "Select the Page before launch",
];

export default function NoPageGuidedSetup({
  onRefreshPages,
  onAlreadyHavePage,
  refreshing = false,
}: NoPageGuidedSetupProps) {
  return (
    <section className="overflow-hidden rounded-3xl border border-amber-400/20 bg-[#141414] shadow-2xl shadow-black/20">
      <div className="border-b border-white/10 bg-gradient-to-r from-amber-500/10 via-emerald-500/10 to-blue-500/10 p-5 sm:p-7">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">Business Page setup</p>
          <h2 className="mt-2 text-2xl font-bold text-white">Choose or create your Facebook Page</h2>
          <p className="mt-3 text-sm leading-6 text-gray-200">
            You do not need a new personal Facebook account. Create or choose a Facebook Page inside Meta.
            Customers will see that Page on your ads, not your personal profile.
          </p>
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
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-white">No business Page yet?</p>
            <p className="mt-2 text-sm leading-6 text-gray-400">
              Open Facebook&apos;s Page creator, create the Page directly inside Facebook, then come back and refresh. CoveCRM will look for the Page you can use for ads.
            </p>
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
