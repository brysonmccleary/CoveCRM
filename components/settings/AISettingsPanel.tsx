// components/settings/AISettingsPanel.tsx
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

interface AISettings {
  aiTextingEnabled?: boolean;
  aiNewLeadCallEnabled?: boolean;
  aiDialSessionEnabled?: boolean;
  aiCallOverviewEnabled?: boolean;
  aiCallCoachingEnabled?: boolean;
  liveTransferEnabled?: boolean;
  liveTransferPhone?: string;
  newLeadCallDelayMinutes?: number;
  businessHoursOnly?: boolean;
  businessHoursStart?: string;
  businessHoursEnd?: string;
  businessHoursTimezone?: string;
}

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings/ai-settings")
      .then((r) => r.json())
      .then((j) => setSettings(j.settings || {}))
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
            label="AI Dial Sessions"
            description="Let the AI work through an entire lead folder, calling each lead sequentially with a 2-second gap. Start a session from any lead folder. TCPA/A2P compliance is your responsibility — only call leads who have provided express written consent."
          >
            <Toggle
              checked={!!settings.aiDialSessionEnabled}
              onChange={(v) => save({ aiDialSessionEnabled: v })}
              disabled={saving}
            />
          </SettingRow>

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
              description="Your phone number for live transfers (E.164 format, e.g. +14805551234)."
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

      {/* Business Hours */}
      <div className="bg-[#0f172a] border border-white/10 rounded-xl">
        <div className="px-5 pt-4 pb-2 border-b border-white/5">
          <h3 className="text-sm font-semibold text-indigo-400 uppercase tracking-wide">
            Business Hours
          </h3>
        </div>
        <div className="px-5">
          <SettingRow
            label="Business Hours Only"
            description="Only allow AI calls during your configured business hours."
          >
            <Toggle
              checked={settings.businessHoursOnly !== false}
              onChange={(v) => save({ businessHoursOnly: v })}
              disabled={saving}
            />
          </SettingRow>

          {settings.businessHoursOnly !== false && (
            <>
              <SettingRow label="Hours" description="Your daily calling window.">
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={settings.businessHoursStart || "09:00"}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, businessHoursStart: e.target.value }))
                    }
                    onBlur={(e) => save({ businessHoursStart: e.target.value })}
                    className="bg-[#1e293b] border border-white/10 text-white text-sm rounded px-2 py-1"
                    disabled={saving}
                  />
                  <span className="text-gray-400 text-xs">to</span>
                  <input
                    type="time"
                    value={settings.businessHoursEnd || "18:00"}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, businessHoursEnd: e.target.value }))
                    }
                    onBlur={(e) => save({ businessHoursEnd: e.target.value })}
                    className="bg-[#1e293b] border border-white/10 text-white text-sm rounded px-2 py-1"
                    disabled={saving}
                  />
                </div>
              </SettingRow>

              <SettingRow label="Timezone" description="Timezone for business hours enforcement.">
                <select
                  value={settings.businessHoursTimezone || "America/Phoenix"}
                  onChange={(e) => save({ businessHoursTimezone: e.target.value })}
                  className="bg-[#1e293b] border border-white/10 text-white text-sm rounded px-3 py-1.5"
                  disabled={saving}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz.replace("America/", "").replace("Pacific/", "").replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </SettingRow>
            </>
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
            label="Call Overview"
            description="Generate AI summaries after each call."
          >
            <Toggle
              checked={settings.aiCallOverviewEnabled !== false}
              onChange={(v) => save({ aiCallOverviewEnabled: v })}
              disabled={saving}
            />
          </SettingRow>

          <SettingRow
            label="Call Coaching"
            description="Get AI coaching tips after each call to improve performance."
          >
            <Toggle
              checked={!!settings.aiCallCoachingEnabled}
              onChange={(v) => save({ aiCallCoachingEnabled: v })}
              disabled={saving}
            />
          </SettingRow>
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
            description="Let AI draft reply suggestions for incoming SMS messages."
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
