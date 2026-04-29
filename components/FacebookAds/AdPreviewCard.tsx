import { US_STATES } from "@/lib/facebook/geo/usStates";

export default function AdPreviewCard({
  draft,
  selectedStates,
  regenerateAttempts,
  regenerating,
  onRegenerate,
}: {
  draft: any;
  selectedStates: string[];
  regenerateAttempts: number;
  regenerating: boolean;
  onRegenerate: () => void;
}) {
  const stateLabel = selectedStates
    .map((code) => US_STATES.find((state) => state.code === code)?.name || code)
    .join(", ");
  const canRegenerate = regenerateAttempts < 3 && !regenerating;

  return (
    <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
      {draft?.imageUrl ? (
        <img src={draft.imageUrl} alt="Generated ad creative" className="w-full max-h-80 object-cover bg-black/20" />
      ) : (
        <div className="h-56 bg-black/20 flex items-center justify-center text-sm text-gray-500">
          Creative image will appear here
        </div>
      )}
      <div className="p-4 space-y-3">
        <div>
          <p className="text-xs uppercase text-gray-500 font-semibold">Primary Text</p>
          <p className="text-sm text-gray-100 whitespace-pre-line">{draft?.primaryText}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-gray-500 font-semibold">Headline</p>
          <p className="text-base text-white font-semibold">{draft?.headline}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-1 rounded bg-emerald-600/20 text-emerald-200 border border-emerald-500/30">
            {draft?.cta || "LEARN_MORE"}
          </span>
          <span className="px-2 py-1 rounded bg-white/5 text-gray-300 border border-white/10">
            {stateLabel || "No states selected"}
          </span>
        </div>
        <button
          type="button"
          onClick={onRegenerate}
          disabled={!canRegenerate}
          className="w-full px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm font-semibold disabled:opacity-50"
        >
          {regenerating ? "Regenerating..." : `Regenerate (${3 - regenerateAttempts} left)`}
        </button>
      </div>
    </div>
  );
}
