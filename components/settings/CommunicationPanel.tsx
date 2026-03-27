// components/settings/CommunicationPanel.tsx
// Default SMS number selector — choose which purchased number sends outbound SMS
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

interface NumberEntry {
  _id?: string;
  sid: string;
  phoneNumber: string;
  friendlyName?: string;
  messagingServiceSid?: string;
}

export default function CommunicationPanel() {
  const [numbers, setNumbers] = useState<NumberEntry[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch("/api/settings/default-number");
        if (res.ok) {
          const data = await res.json();
          setNumbers(data.numbers || []);
          setDefaultId(data.defaultSmsNumberId || null);
        }
      } catch (err) {
        console.error("Failed to load numbers", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/default-number", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numberId: defaultId }),
      });
      if (res.ok) {
        toast.success("Default SMS number saved");
      } else {
        toast.error("Failed to save");
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-gray-400 text-sm p-6">Loading...</p>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white mb-1">Default SMS Number</h2>
        <p className="text-gray-400 text-sm mb-4">
          Choose which number sends outbound SMS by default. If no default is set, CoveCRM will use the first available number.
        </p>

        {numbers.length === 0 ? (
          <div className="bg-[#0f172a] rounded-lg p-4 text-gray-400 text-sm">
            No phone numbers on your account. Purchase a number from the Numbers tab.
          </div>
        ) : (
          <div className="space-y-2">
            {/* "No default" option */}
            <label className="flex items-center gap-3 bg-[#0f172a] rounded-lg px-4 py-3 cursor-pointer hover:border-indigo-500 border border-white/10 transition">
              <input
                type="radio"
                name="defaultNumber"
                value=""
                checked={!defaultId}
                onChange={() => setDefaultId(null)}
                className="accent-indigo-500"
              />
              <span className="text-gray-400 text-sm">Auto (use first available number)</span>
            </label>

            {numbers.map((num) => {
              const id = num._id || num.sid;
              return (
                <label
                  key={id}
                  className="flex items-center gap-3 bg-[#0f172a] rounded-lg px-4 py-3 cursor-pointer hover:border-indigo-500 border border-white/10 transition"
                >
                  <input
                    type="radio"
                    name="defaultNumber"
                    value={id}
                    checked={defaultId === id}
                    onChange={() => setDefaultId(id)}
                    className="accent-indigo-500"
                  />
                  <div>
                    <p className="text-white text-sm font-medium">{num.phoneNumber}</p>
                    {num.friendlyName && (
                      <p className="text-gray-500 text-xs">{num.friendlyName}</p>
                    )}
                    {num.messagingServiceSid && (
                      <p className="text-gray-600 text-xs">MsgSvc: {num.messagingServiceSid.slice(-8)}</p>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        )}

        {numbers.length > 0 && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="mt-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-5 py-2 rounded-lg text-sm font-semibold text-white"
          >
            {saving ? "Saving..." : "Save Default"}
          </button>
        )}
      </div>
    </div>
  );
}
