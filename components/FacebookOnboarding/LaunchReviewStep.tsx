import type { LaunchReadiness } from "./LaunchReadinessCard";
import ProfileVisibilityNotice from "./ProfileVisibilityNotice";
import type { PageIdentity } from "./PageIdentityCard";

type LaunchReviewStepProps = {
  page?: PageIdentity | null;
  leadType?: string;
  readiness: LaunchReadiness;
};

const LEAD_TYPE_LABELS: Record<string, string> = {
  final_expense: "Final Expense",
  mortgage_protection: "Mortgage Protection",
  iul: "IUL",
  veteran: "Veteran Leads",
  trucker: "Trucker Leads",
};

export default function LaunchReviewStep({ page, leadType, readiness }: LaunchReviewStepProps) {
  const pageName = page?.name?.trim() || "Choose a business Page before launch";
  const leadLabel = leadType ? LEAD_TYPE_LABELS[leadType] || leadType : "Choose a lead type";

  return (
    <section className="rounded-3xl border border-white/10 bg-[#0f172a] p-5 shadow-2xl shadow-black/20 sm:p-7">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Step 5</p>
          <h2 className="mt-1 text-2xl font-bold text-white">
            {readiness.ready ? "Ready for final review" : "Not ready to launch yet"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-gray-400">
            {readiness.ready
              ? "Campaigns launch paused first, so you can check the final ad before any spend starts."
              : "Complete the missing setup items before launching your first ad."}
          </p>
        </div>
        <div
          className={[
            "rounded-2xl px-4 py-3 text-sm font-medium",
            readiness.ready
              ? "border border-emerald-500/30 bg-emerald-950/30 text-emerald-100"
              : "border border-amber-500/30 bg-amber-950/30 text-amber-100",
          ].join(" ")}
        >
          {readiness.ready ? "Campaign launches paused first for safety review." : "Finish setup before launch."}
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Facebook connected", readiness.items.find((item) => item.key === "facebook")?.ready ? "Connected" : "Connect Facebook"],
          ["Facebook page", pageName],
          ["Lead type", leadLabel],
          ["Campaign status", "Launches paused first"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
            <p className="mt-1 text-sm font-semibold text-white">{value}</p>
          </div>
        ))}
      </div>

      {!readiness.ready && (
        <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100/90">
          <p className="font-semibold text-amber-50">Missing before launch</p>
          <ul className="mt-2 space-y-1">
            {readiness.missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 rounded-2xl border border-blue-500/20 bg-blue-950/20 p-4 text-sm leading-6 text-blue-100/80">
        Budget, licensed states, and the generated ad are finalized in the launch step above. Nothing spends until you activate the paused campaign.
      </div>

      <div className="mt-5">
        <ProfileVisibilityNotice compact />
      </div>
    </section>
  );
}
