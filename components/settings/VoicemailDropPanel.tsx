// components/settings/VoicemailDropPanel.tsx
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

interface VoicemailDrop {
  _id: string;
  name: string;
  leadType: string;
  scriptText: string;
  ttsVoice: string;
  audioUrl?: string;
  isDefault: boolean;
  dropCount: number;
}

const LEAD_TYPES = ["General", "Final Expense", "Veteran", "Mortgage Protection", "IUL"];

export default function VoicemailDropPanel() {
  const [drops, setDrops] = useState<VoicemailDrop[]>([]);
  const [loading, setLoading] = useState(true);

  // Inline form (always visible)
  const [name, setName] = useState("");
  const [leadType, setLeadType] = useState("General");
  const [audioUrl, setAudioUrl] = useState("");
  const [scriptText, setScriptText] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingAudio, setTestingAudio] = useState(false);

  const fetchDrops = async () => {
    setLoading(true);
    const res = await fetch("/api/voicemail");
    const data = await res.json();
    setDrops(data.drops || []);
    setLoading(false);
  };

  useEffect(() => { fetchDrops(); }, []);

  const handleCreate = async () => {
    if (!name) { toast.error("Name is required"); return; }
    if (!audioUrl && !scriptText) { toast.error("Provide a Recording URL or a script"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/voicemail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          leadType,
          scriptText: scriptText || name,
          audioUrl,
          ttsVoice: "Polly.Matthew",
          isDefault,
        }),
      });
      if (res.ok) {
        toast.success("Voicemail drop saved");
        setName(""); setAudioUrl(""); setScriptText(""); setIsDefault(false);
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
      {/* Instructions */}
      <div className="bg-[#0f172a] rounded-xl border border-white/10 p-5 space-y-3">
        <h2 className="text-base font-semibold text-white">What is Voicemail Drop?</h2>
        <p className="text-sm text-gray-300 leading-relaxed">
          Voicemail Drop lets you leave a pre-recorded message on a lead's voicemail with one click — without waiting for it to ring. Record your message once, then use it on any call. The attempt is automatically logged in the lead's history.
        </p>
      </div>

      {/* How to record */}
      <div className="bg-[#0f172a] rounded-xl border border-white/10 p-5 space-y-3">
        <h2 className="text-base font-semibold text-white">How to get a Recording URL</h2>
        <ol className="space-y-2 text-sm text-gray-300">
          <li className="flex gap-3">
            <span className="h-5 w-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold shrink-0 mt-0.5">1</span>
            <span>Log in to <span className="text-blue-400">twilio.com/console/recordings</span> and find your recording, <strong>OR</strong> host your own MP3 on any public URL (Google Drive, Dropbox, etc.).</span>
          </li>
          <li className="flex gap-3">
            <span className="h-5 w-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold shrink-0 mt-0.5">2</span>
            <span>Copy the direct public URL to your audio file (must end in .mp3 or .wav or be a Twilio recording URL).</span>
          </li>
          <li className="flex gap-3">
            <span className="h-5 w-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold shrink-0 mt-0.5">3</span>
            <span>Paste the URL below and click "Test" to verify it plays correctly.</span>
          </li>
          <li className="flex gap-3">
            <span className="h-5 w-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold shrink-0 mt-0.5">4</span>
            <span>Save your voicemail drop — then use the "📱 Drop VM" button on any lead profile.</span>
          </li>
        </ol>
        <p className="text-xs text-gray-500 pt-1">
          Tip: Keep recordings under 30 seconds for best results.
        </p>
      </div>

      {/* Inline form — always visible */}
      <div className="bg-[#0f172a] rounded-xl border border-white/10 p-5 space-y-4">
        <h2 className="text-base font-semibold text-white">+ New Voicemail Drop</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Final Expense Follow-up"
              className="w-full bg-[#1e293b] border border-white/10 text-white rounded-lg px-3 py-2 text-sm"
            />
          </div>
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
        </div>

        {/* Recording URL */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Recording URL</label>
          <div className="flex gap-2">
            <input
              value={audioUrl}
              onChange={(e) => setAudioUrl(e.target.value)}
              placeholder="https://... (direct link to your .mp3 or .wav)"
              className="flex-1 bg-[#1e293b] border border-white/10 text-white rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={() => setTestingAudio(true)}
              disabled={!audioUrl}
              className="text-xs bg-[#1e293b] border border-white/10 hover:bg-white/10 text-gray-300 px-3 py-1.5 rounded-lg disabled:opacity-40"
            >
              Test
            </button>
          </div>
          {testingAudio && audioUrl && (
            <div className="mt-2">
              <audio
                controls
                autoPlay
                src={audioUrl}
                className="w-full mt-1"
                onEnded={() => setTestingAudio(false)}
              />
            </div>
          )}
        </div>

        {/* Optional fallback script */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Script (optional — used if no Recording URL is set)
          </label>
          <textarea
            value={scriptText}
            onChange={(e) => setScriptText(e.target.value)}
            rows={2}
            placeholder="Hi, this is [Your Name] following up about your life insurance inquiry..."
            className="w-full bg-[#1e293b] border border-white/10 text-white rounded-lg px-3 py-2 text-sm resize-none"
          />
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="rounded"
            />
            Set as default
          </label>

          <button
            onClick={handleCreate}
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold text-white"
          >
            {saving ? "Saving..." : "Save Drop"}
          </button>
        </div>
      </div>

      {/* Existing drops */}
      <div>
        <h2 className="text-base font-semibold text-white mb-3">Your Voicemail Drops</h2>
        {loading ? (
          <p className="text-gray-400 text-sm">Loading...</p>
        ) : drops.length === 0 ? (
          <p className="text-gray-500 text-sm">No voicemail drops yet. Add one above.</p>
        ) : (
          <div className="space-y-3">
            {drops.map((drop) => (
              <div key={drop._id} className="bg-[#0f172a] rounded-xl p-4 border border-white/10 flex items-start justify-between gap-4">
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-white">{drop.name}</span>
                    {drop.isDefault && (
                      <span className="text-xs bg-indigo-800 text-indigo-300 px-2 py-0.5 rounded-full">Default</span>
                    )}
                    <span className="text-xs text-gray-500">{drop.leadType}</span>
                  </div>
                  {drop.audioUrl && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Recording</p>
                      <audio controls preload="none" src={drop.audioUrl} className="h-8 w-full max-w-xs" />
                    </div>
                  )}
                  {!drop.audioUrl && drop.scriptText && (
                    <p className="text-gray-400 text-xs line-clamp-2">{drop.scriptText}</p>
                  )}
                  <p className="text-gray-500 text-xs">Dropped {drop.dropCount}×</p>
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
    </div>
  );
}
