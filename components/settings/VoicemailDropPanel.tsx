// components/settings/VoicemailDropPanel.tsx
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

interface VoicemailDrop {
  _id: string;
  name: string;
  leadType: string;
  scriptText: string;
  ttsVoice: string;
  isDefault: boolean;
  dropCount: number;
}

const TTS_VOICES = [
  { value: "Polly.Matthew", label: "Matthew (Male, US)" },
  { value: "Polly.Joanna", label: "Joanna (Female, US)" },
  { value: "Polly.Joey", label: "Joey (Male, US)" },
  { value: "Polly.Kendra", label: "Kendra (Female, US)" },
];

const LEAD_TYPES = ["General", "Final Expense", "Veteran", "Mortgage Protection", "IUL"];

export default function VoicemailDropPanel() {
  const [drops, setDrops] = useState<VoicemailDrop[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [leadType, setLeadType] = useState("General");
  const [scriptText, setScriptText] = useState("");
  const [ttsVoice, setTtsVoice] = useState("Polly.Matthew");
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchDrops = async () => {
    setLoading(true);
    const res = await fetch("/api/voicemail");
    const data = await res.json();
    setDrops(data.drops || []);
    setLoading(false);
  };

  useEffect(() => { fetchDrops(); }, []);

  const handleCreate = async () => {
    if (!name || !scriptText) {
      toast.error("Name and script are required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/voicemail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, leadType, scriptText, ttsVoice, isDefault }),
      });
      if (res.ok) {
        toast.success("Voicemail drop saved");
        setName(""); setScriptText(""); setIsDefault(false); setShowForm(false);
        fetchDrops();
      } else {
        const d = await res.json();
        toast.error(d.error || "Save failed");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this voicemail drop?")) return;
    await fetch(`/api/voicemail?id=${id}`, { method: "DELETE" });
    fetchDrops();
    toast.success("Deleted");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Voicemail Drops</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg text-sm font-semibold text-white"
        >
          + New Drop
        </button>
      </div>

      {showForm && (
        <div className="bg-[#0f172a] rounded-xl p-5 space-y-4 border border-white/10">
          <h3 className="font-semibold text-white">New Voicemail Drop</h3>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Final Expense Intro"
              className="w-full bg-[#1e293b] border border-white/10 text-white rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Lead Type</label>
              <select
                value={leadType}
                onChange={(e) => setLeadType(e.target.value)}
                className="w-full bg-[#1e293b] border border-white/10 text-white rounded-lg px-3 py-2 text-sm"
              >
                {LEAD_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Voice</label>
              <select
                value={ttsVoice}
                onChange={(e) => setTtsVoice(e.target.value)}
                className="w-full bg-[#1e293b] border border-white/10 text-white rounded-lg px-3 py-2 text-sm"
              >
                {TTS_VOICES.map((v) => (
                  <option key={v.value} value={v.value}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Script (what the voicemail will say)</label>
            <textarea
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              rows={4}
              placeholder="Hi [Name], this is [Your Name] calling about your life insurance inquiry..."
              className="w-full bg-[#1e293b] border border-white/10 text-white rounded-lg px-3 py-2 text-sm resize-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isDefault"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="isDefault" className="text-sm text-gray-300">Set as default voicemail drop</label>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              disabled={saving}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold text-white"
            >
              {saving ? "Saving..." : "Save Drop"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="text-gray-400 hover:text-white text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : drops.length === 0 ? (
        <p className="text-gray-500 text-sm">No voicemail drops yet. Create one above.</p>
      ) : (
        <div className="space-y-3">
          {drops.map((drop) => (
            <div key={drop._id} className="bg-[#0f172a] rounded-xl p-4 border border-white/10 flex items-start justify-between gap-4">
              <div className="space-y-1 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white">{drop.name}</span>
                  {drop.isDefault && (
                    <span className="text-xs bg-indigo-800 text-indigo-300 px-2 py-0.5 rounded-full">Default</span>
                  )}
                  <span className="text-xs text-gray-500">{drop.leadType}</span>
                </div>
                <p className="text-gray-400 text-xs line-clamp-2">{drop.scriptText}</p>
                <p className="text-gray-500 text-xs">Voice: {drop.ttsVoice} · Dropped {drop.dropCount}×</p>
              </div>
              <button
                onClick={() => handleDelete(drop._id)}
                className="text-red-400 hover:text-red-300 text-xs flex-shrink-0"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
