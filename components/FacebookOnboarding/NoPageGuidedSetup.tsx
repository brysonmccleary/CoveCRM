import PageStarterKit from "./PageStarterKit";

type NoPageGuidedSetupProps = {
  onRefreshPages: () => void | Promise<void>;
  onOpenPageCreator?: () => void;
  pages?: Array<{ id?: string; name?: string; pictureUrl?: string }>;
  onSelectPage?: (pageId: string) => void | Promise<void>;
  refreshing?: boolean;
  selectedLeadType?: string;
};

export default function NoPageGuidedSetup({
  onRefreshPages,
  onOpenPageCreator,
  pages = [],
  onSelectPage,
  refreshing = false,
  selectedLeadType = "",
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

      <div className="space-y-5 p-5 sm:p-7">
        <PageStarterKit initialLeadType={selectedLeadType} />

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ["1", "Copy your setup", "Copy the suggested name and bio, then download the matching profile picture."],
              ["2", "Create the Page", "Open Facebook, paste the details, upload the logo, and finish creating the Page."],
              ["3", "Come back here", "CoveCRM detects and selects the new Page automatically."],
            ].map(([number, title, description]) => (
              <div key={number} className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-bold text-emerald-200">
                  {number}
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">{title}</p>
                  <p className="mt-1 text-xs leading-5 text-gray-400">{description}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 grid gap-3">
            <button
              type="button"
              onClick={onOpenPageCreator}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500"
            >
              Open Facebook Page Creator
            </button>
            <div>
              <button
                type="button"
                onClick={onRefreshPages}
                disabled={refreshing}
                className="min-h-11 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {refreshing ? "Looking for your Page..." : "I finished creating my Page"}
              </button>
            </div>
            {pages.length > 1 && onSelectPage && (
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="mb-2 text-xs font-semibold text-gray-300">Already have a Page? Pick it here:</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {pages.map((page) => (
                    <button
                      key={page.id}
                      type="button"
                      onClick={() => page.id && onSelectPage(page.id)}
                      className="min-h-10 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-sm font-semibold text-white hover:bg-white/10"
                    >
                      {page.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
