import { US_STATES } from "@/lib/facebook/geo/usStates";

export default function StateSelector({
  value,
  onChange,
}: {
  value: string[];
  onChange: (states: string[]) => void;
}) {
  const selected = Array.isArray(value) ? value : [];

  const toggle = (code: string) => {
    if (selected.includes(code)) {
      onChange(selected.filter((state) => state !== code));
      return;
    }
    onChange([...selected, code]);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-white">Licensed states</p>
        <span className="text-xs text-gray-400">{selected.length} selected</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-72 overflow-y-auto pr-1">
        {US_STATES.map((state) => {
          const active = selected.includes(state.code);
          return (
            <button
              key={state.code}
              type="button"
              onClick={() => toggle(state.code)}
              className={`text-left px-3 py-2 rounded-lg border text-sm transition ${
                active
                  ? "bg-emerald-600/20 border-emerald-500/60 text-emerald-100"
                  : "bg-white/5 border-white/10 text-gray-300 hover:bg-white/10"
              }`}
            >
              <span className="font-semibold">{state.code}</span>
              <span className="block text-xs opacity-75 truncate">{state.name}</span>
            </button>
          );
        })}
      </div>
      {!selected.length && (
        <p className="text-xs text-yellow-400 mt-2">Select at least one licensed state to continue.</p>
      )}
    </div>
  );
}
