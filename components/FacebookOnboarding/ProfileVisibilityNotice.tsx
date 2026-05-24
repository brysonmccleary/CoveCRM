type ProfileVisibilityNoticeProps = {
  compact?: boolean;
};

export default function ProfileVisibilityNotice({ compact = false }: ProfileVisibilityNoticeProps) {
  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-4 text-sm text-emerald-50">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-white">
          ✓
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-white">Customers see your business page</p>
          <div className={compact ? "mt-1 space-y-1 text-xs text-emerald-100/80" : "mt-2 grid gap-2 text-xs text-emerald-100/80 sm:grid-cols-2"}>
            <p>
              <span className="font-semibold text-emerald-200">✓ Customers see:</span> your business Facebook page
            </p>
            <p>
              <span className="font-semibold text-rose-200">✕ Customers do not see:</span> your personal Facebook profile
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
