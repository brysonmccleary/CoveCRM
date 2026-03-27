// components/settings/ObjectionLibraryPanel.tsx
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

interface Objection {
  _id: string;
  objection: string;
  response: string;
  category: string;
  isGlobal: boolean;
  useCount: number;
}

const CATEGORIES = ["all", "price", "trust", "timing", "need", "spouse", "competitor", "other"];

const CATEGORY_COLORS: Record<string, string> = {
  price: "bg-yellow-900 text-yellow-300",
  trust: "bg-blue-900 text-blue-300",
  timing: "bg-purple-900 text-purple-300",
  need: "bg-green-900 text-green-300",
  spouse: "bg-pink-900 text-pink-300",
  competitor: "bg-orange-900 text-orange-300",
  other: "bg-gray-800 text-gray-300",
};

export default function ObjectionLibraryPanel() {
  const [objections, setObjections] = useState<Objection[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [objText, setObjText] = useState("");
  const [responseText, setResponseText] = useState("");
  const [category, setCategory] = useState("other");
  const [saving, setSaving] = useState(false);

  const fetchObjections = async () => {
    setLoading(true);
    const res = await fetch("/api/objections");
    const data = await res.json();
    setObjections(data.objections || []);
    setLoading(false);
  };

  useEffect(() => { fetchObjections(); }, []);

  const filtered = filter === "all"
    ? objections
    : objections.filter((o) => o.category === filter);

  const handleCreate = async () => {
    if (!objText || !responseText) {
      toast.error("Objection and response are required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/objections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objection: objText, response: responseText, category }),
      });
      if (res.ok) {
        toast.success("Objection saved");
        setObjText(""); setResponseText(""); setShowForm(false);
        fetchObjections();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/objections/${id}`, { method: "DELETE" });
    fetchObjections();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Objection Library</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg text-sm font-semibold text-white"
        >
          + Add Response
        </button>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`px-3 py-1 rounded-full text-xs font-semibold capitalize transition ${
              filter === cat
                ? "bg-indigo-600 text-white"
                : "bg-[#1e293b] text-gray-400 hover:text-white"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="bg-[#0f172a] rounded-xl p-5 space-y-4 border border-white/10">
          <h3 className="font-semibold text-white">Add Custom Objection Response</h3>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Objection</label>
            <input
              value={objText}
              onChange={(e) => setObjText(e.target.value)}
              placeholder='e.g. "I need to think about it."'
              className="w-full bg-[#1e293b] border border-white/10 text-white rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Your Response</label>
            <textarea
              value={responseText}
              onChange={(e) => setResponseText(e.target.value)}
              rows={3}
              placeholder="Of course! What specific questions can I answer for you?"
              className="w-full bg-[#1e293b] border border-white/10 text-white rounded-lg px-3 py-2 text-sm resize-none"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="bg-[#1e293b] border border-white/10 text-white rounded-lg px-3 py-2 text-sm"
            >
              {CATEGORIES.filter((c) => c !== "all").map((c) => (
                <option key={c} value={c} className="capitalize">{c}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              disabled={saving}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold text-white"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((obj) => (
            <div
              key={obj._id}
              className="bg-[#0f172a] rounded-xl p-4 border border-white/10 space-y-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${
                      CATEGORY_COLORS[obj.category] || CATEGORY_COLORS.other
                    }`}
                  >
                    {obj.category}
                  </span>
                  {obj.isGlobal && (
                    <span className="text-xs text-gray-500">Global</span>
                  )}
                </div>
                {!obj.isGlobal && (
                  <button
                    onClick={() => handleDelete(obj._id)}
                    className="text-red-400 hover:text-red-300 text-xs flex-shrink-0"
                  >
                    Delete
                  </button>
                )}
              </div>
              <p className="text-white font-medium text-sm">"{obj.objection}"</p>
              <p className="text-gray-300 text-sm italic">→ {obj.response}</p>
            </div>
          ))}

          {filtered.length === 0 && (
            <p className="text-gray-500 text-sm">No objections in this category.</p>
          )}
        </div>
      )}
    </div>
  );
}
