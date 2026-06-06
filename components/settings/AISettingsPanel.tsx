// components/settings/AISettingsPanel.tsx
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

interface AISettings {
  aiTextingEnabled?: boolean;
  aiNewLeadCallEnabled?: boolean;
  aiCallOverviewEnabled?: boolean;
  aiCallCoachingEnabled?: boolean;
  liveTransferEnabled?: boolean;
  liveTransferPhone?: string;
  newLeadCallDelayMinutes?: number;
}

interface AIInsightUsage {
  minutesProcessed: number;
  estimatedCostCents: number;
  estimatedCostDollars: number;
  lastResetAt?: string | null;
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
        checked ? "bg-indigo-600" : "bg-gray-600"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between py-4 border-b border-white/5">
      <div className="flex-1 pr-6">
        <p className="text-white text-sm font-medium">{label}</p>
        {description && <p className="text-gray-400 text-xs mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function AISettingsPanel() {
  const [settings, setSettings] = useState<AISettings>({});
  const [aiInsightUsage, setAiInsightUsage] = useState<AIInsightUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings/ai-settings")
      .then((r) => r.json())
      .then((j) => {
        setSettings(j.settings || {});
        setAiInsightUsage(j.aiInsightUsage || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async (patch: Partial<AISettings>) => {
    setSaving(true);
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      const res = await fetch("/api/settings/ai-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Saved");
    } catch {
      toast.error("Failed to save");
      setSettings(settings); // revert
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 text-gray-500 text-sm">Loading AI settings…</div>
    );
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">AI Settings</h2>
        <p className="text-gray-400 text-sm mt-1">
          Configure AI-powered features for your account.
        </p>
      </div>

      {/* AI Calling */}
      <div className="bg-[#0f172a] border border-white/10 rounded-xl">
        <div className="px-5 pt-4 pb-2 border-b border-white/5">
          <h3 className="text-sm font-semibold text-indigo-400 uppercase tracking-wide">
            AI Calling
          </h3>
        </div>
        <div className="px-5">
          <SettingRow
            label="New Lead Auto-Call"
            description="Automatically call new leads with AI when they're added to your CRM."
          >
            <Toggle
              checked={!!settings.aiNewLeadCallEnabled}
              onChange={(v) => save({ aiNewLeadCallEnabled: v })}
              disabled={saving}
            />
          </SettingRow>

          {settings.aiNewLeadCallEnabled && (
            <SettingRow
              label="Call Delay"
              description="How many minutes to wait before calling a new lead."
            >
              <select
                value={settings.newLeadCallDelayMinutes ?? 5}
                onChange={(e) => save({ newLeadCallDelayMinutes: Number(e.target.value) })}
                className="bg-[#1e293b] border border-white/10 text-white text-sm rounded px-3 py-1.5"
                disabled={saving}
              >
                {[0, 1, 2, 5, 10, 15, 30].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "Immediately" : `${n} min`}
                  </option>
                ))}
              </select>
            </SettingRow>
          )}

          <SettingRow
            label="Live Transfer"
            description="Transfer AI calls to your phone when the lead is ready to talk."
          >
            <Toggle
              checked={!!settings.liveTransferEnabled}
              onChange={(v) => save({ liveTransferEnabled: v })}
              disabled={saving}
            />
          </SettingRow>

          {settings.liveTransferEnabled && (
            <SettingRow
              label="Transfer Phone"
              description="Your phone number for live transfers (E.164 format, e.g. +14805551234). If you don't answer within 25 seconds, the appointment is automatically booked."
            >
              <input
                type="tel"
                value={settings.liveTransferPhone || ""}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, liveTransferPhone: e.target.value }))
                }
                onBlur={(e) => save({ liveTransferPhone: e.target.value })}
                placeholder="+14805551234"
                className="bg-[#1e293b] border border-white/10 text-white text-sm rounded px-3 py-1.5 w-44"
                disabled={saving}
              />
            </SettingRow>
          )}
        </div>
      </div>

      {/* AI Analysis */}
      <div className="bg-[#0f172a] border border-white/10 rounded-xl">
        <div className="px-5 pt-4 pb-2 border-b border-white/5">
          <h3 className="text-sm font-semibold text-indigo-400 uppercase tracking-wide">
            AI Analysis
          </h3>
        </div>
        <div className="px-5">
          <SettingRow
            label="AI Call Insights"
            description="Automatically generates call overviews from recordings. $0.02/min, rounded up, billed only for calls 20 seconds or longer."
          >
            <Toggle
              checked={settings.aiCallOverviewEnabled !== false}
              onChange={(v) => save({ aiCallOverviewEnabled: v })}
              disabled={saving}
            />
          </SettingRow>

          <SettingRow
            label="AI Coaching"
            description="Adds coaching reports when enabled. Included in the same AI Call Insights charge."
          >
            <Toggle
              checked={!!settings.aiCallCoachingEnabled}
              onChange={(v) => save({ aiCallCoachingEnabled: v })}
              disabled={saving}
            />
          </SettingRow>

          <div className="py-4 text-xs text-gray-400">
            <p className="font-medium text-gray-300">AI Call Insights: $0.02/min</p>
            <p className="mt-1">
              Current cycle: {aiInsightUsage?.minutesProcessed || 0} minutes processed · $
              {(aiInsightUsage?.estimatedCostDollars || 0).toFixed(2)} estimated.
            </p>
          </div>
        </div>
      </div>

      {/* AI Texting */}
      <div className="bg-[#0f172a] border border-white/10 rounded-xl">
        <div className="px-5 pt-4 pb-2 border-b border-white/5">
          <h3 className="text-sm font-semibold text-indigo-400 uppercase tracking-wide">
            AI Texting
          </h3>
        </div>
        <div className="px-5">
          <SettingRow
            label="AI SMS Assistant"
            description="Let AI respond to inbound lead texts and send queued AI SMS replies."
          >
            <Toggle
              checked={!!settings.aiTextingEnabled}
              onChange={(v) => save({ aiTextingEnabled: v })}
              disabled={saving}
            />
          </SettingRow>
        </div>
      </div>
    </div>
  );
}
