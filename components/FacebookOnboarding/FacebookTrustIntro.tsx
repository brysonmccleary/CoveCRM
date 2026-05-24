import ProfileVisibilityNotice from "./ProfileVisibilityNotice";

type FacebookTrustIntroProps = {
  connected?: boolean;
};

export default function FacebookTrustIntro({ connected = false }: FacebookTrustIntroProps) {
  return (
    <section className="overflow-hidden rounded-3xl border border-white/10 bg-[#0f172a] shadow-2xl shadow-black/20">
      <div className="grid gap-7 p-5 sm:p-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
        <div>
          <div className="inline-flex rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-200">
            Guided Facebook launch
          </div>
          <h1 className="mt-4 text-3xl font-bold leading-tight text-white sm:text-4xl">
            Set up your first Facebook campaign with confidence.
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-gray-300">
            CoveCRM walks you through the business identity, customer-facing page, ad basics,
            and safety review before anything spends.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href="/api/meta/connect"
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-950/40 transition hover:bg-blue-500"
            >
              {connected ? "Reconnect Facebook" : "Continue with Facebook"}
            </a>
            <p className="text-xs text-gray-400">
              Secure connection. Your personal profile is used only to confirm access.
            </p>
          </div>
          <div className="mt-6 grid gap-2 text-xs text-gray-400 sm:grid-cols-3">
            {["Business identity", "Customer page preview", "Paused safety launch"].map((item, index) => (
              <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3">
                <span className="text-blue-300">0{index + 1}</span>
                <p className="mt-1 font-semibold text-gray-200">{item}</p>
              </div>
            ))}
          </div>
        </div>
        <ProfileVisibilityNotice />
      </div>
    </section>
  );
}
