// components/SaleModal.tsx
// Shown when marking a lead as Sold. Captures AP + Comp% before committing the disposition.
import { useEffect, useState } from "react";

const VALID_COMP_PERCENTAGES = [80, 85, 90, 95, 100, 105, 110, 115, 120, 125, 130, 135, 140, 145];
const ADVANCE_PERCENTAGE = 75;

interface SaleModalProps {
  leadId: string;
  defaultComp?: number;
  // pre-filled when editing an already-sold lead
  existingAP?: number;
  existingComp?: number;
  onSave: (result: {
    annualPremium: number;
    compPercentage: number;
    grossCommissionRevenue: number;
    advanceRevenue: number;
    holdbackRevenue: number;
  }) => void;
  onCancel: () => void;
}

export default function SaleModal({
  defaultComp = 100,
  existingAP,
  existingComp,
  onSave,
  onCancel,
}: SaleModalProps) {
  const [ap, setAp] = useState<string>(existingAP ? String(existingAP) : "");
  const [comp, setComp] = useState<number>(existingComp ?? defaultComp);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const apNum = parseFloat(ap) || 0;
  const gross = apNum > 0 ? Math.round(apNum * (comp / 100) * 100) / 100 : 0;
  const advance = gross > 0 ? Math.round(gross * 0.75 * 100) / 100 : 0;
  const holdback = gross > 0 ? Math.round((gross - advance) * 100) / 100 : 0;

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  const handleSave = async () => {
    setError("");
    if (!apNum || apNum <= 0) {
      setError("Annual Premium is required and must be a positive number.");
      return;
    }
    if (!VALID_COMP_PERCENTAGES.includes(comp)) {
      setError("Invalid Comp %.");
      return;
    }
    setSaving(true);
    try {
      onSave({ annualPremium: apNum, compPercentage: comp, grossCommissionRevenue: gross, advanceRevenue: advance, holdbackRevenue: holdback });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1e293b] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold text-white">Record Sale</h2>
          <p className="text-sm text-gray-400 mt-1">Enter the policy details to save this sale.</p>
        </div>

        {/* Annual Premium */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Annual Premium (AP) <span className="text-red-400">*</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={ap}
              onChange={(e) => setAp(e.target.value)}
              className="w-full bg-[#0f172a] border border-gray-600 rounded-lg pl-7 pr-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
              autoFocus
            />
          </div>
        </div>

        {/* Comp % */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Comp Percentage (%) <span className="text-red-400">*</span>
          </label>
          <select
            value={comp}
            onChange={(e) => setComp(Number(e.target.value))}
            className="w-full bg-[#0f172a] border border-gray-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
          >
            {VALID_COMP_PERCENTAGES.map((v) => (
              <option key={v} value={v}>{v}%</option>
            ))}
          </select>
        </div>

        {/* Advance % — informational only */}
        <div className="bg-[#0f172a] border border-white/5 rounded-lg px-4 py-3">
          <p className="text-xs text-gray-400 mb-2 uppercase tracking-wide font-semibold">Advance Percentage</p>
          <p className="text-white font-bold">{ADVANCE_PERCENTAGE}%</p>
          <p className="text-xs text-gray-500 mt-0.5">Standard advance — not editable</p>
        </div>

        {/* Preview */}
        {apNum > 0 && (
          <div className="bg-[#0f172a] border border-white/5 rounded-lg px-4 py-3 space-y-1.5">
            <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-2">Revenue Preview</p>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Gross Revenue</span>
              <span className="text-white font-medium">${gross.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Advance Revenue (75%)</span>
              <span className="text-green-400 font-medium">${advance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Holdback (25%)</span>
              <span className="text-gray-400">${holdback.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-lg border border-gray-600 text-gray-300 text-sm hover:bg-gray-700 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !apNum || apNum <= 0}
            className="flex-1 px-4 py-2.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-semibold transition disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save Sale"}
          </button>
        </div>
      </div>
    </div>
  );
}
