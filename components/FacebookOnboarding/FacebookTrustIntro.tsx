type FacebookTrustIntroProps = {
  connected?: boolean;
};

export default function FacebookTrustIntro({ connected = false }: FacebookTrustIntroProps) {
  return (
    <section className="overflow-hidden rounded-3xl border border-white/10 bg-[#0f172a] shadow-2xl shadow-black/20">
      <div className="p-5 sm:p-7">
        <div>
          <div className="inline-flex rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-200">Facebook ads</div>
          <h1 className="mt-4 text-3xl font-bold leading-tight text-white">
            {connected ? "Your Facebook setup" : "Connect once. Launch whenever you want."}
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-gray-300">
            {connected
              ? "Confirm your Page, create or choose the Meta ad account that will run the campaign, then launch."
              : "Connect Facebook, confirm your Page, create or choose an ad account, then build your ad."}
          </p>
        </div>
      </div>
    </section>
  );
}
