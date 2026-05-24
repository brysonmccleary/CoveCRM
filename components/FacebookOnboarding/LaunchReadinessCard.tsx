export type LaunchReadinessItem = {
  key: string;
  label: string;
  ready: boolean;
  missingText?: string;
};

export type LaunchReadiness = {
  ready: boolean;
  items: LaunchReadinessItem[];
  missing: string[];
};

type LaunchReadinessCardProps = {
  readiness: LaunchReadiness;
};

export default function LaunchReadinessCard({ readiness }: LaunchReadinessCardProps) {
  return (
    <section className="rounded-3xl border border-white/10 bg-[#0f172a] p-5 shadow-2xl shadow-black/20 sm:p-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-300">Launch readiness</p>
          <h2 className="mt-1 text-2xl font-bold text-white">
            {readiness.ready ? "Ready for final review" : "Finish these steps before launching your first ad."}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
            CoveCRM keeps the campaign paused first, but these basics should be complete before you use the launch step.
          </p>
        </div>
        <div
          className={[
            "rounded-2xl px-4 py-3 text-sm font-semibold",
            readiness.ready
              ? "border border-emerald-500/30 bg-emerald-950/30 text-emerald-100"
              : "border border-amber-500/30 bg-amber-950/30 text-amber-100",
          ].join(" ")}
        >
          {readiness.ready ? "All launch basics are ready" : `${readiness.missing.length} step${readiness.missing.length === 1 ? "" : "s"} left`}
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {readiness.items.map((item) => (
          <div
            key={item.key}
            className={[
              "rounded-2xl border p-4",
              item.ready
                ? "border-emerald-400/20 bg-emerald-500/10"
                : "border-amber-400/20 bg-amber-500/10",
            ].join(" ")}
          >
            <div
              className={[
                "flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold",
                item.ready ? "bg-emerald-500/20 text-emerald-100" : "bg-amber-500/20 text-amber-100",
              ].join(" ")}
            >
              {item.ready ? "OK" : "!"}
            </div>
            <p className="mt-3 text-sm font-semibold text-white">{item.label}</p>
            {!item.ready && item.missingText && (
              <p className="mt-1 text-xs leading-5 text-amber-100/80">{item.missingText}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
