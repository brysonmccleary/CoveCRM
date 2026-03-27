// pages/pipeline/index.tsx
// Visual pipeline board — drag-and-drop lead cards across stages
import { useEffect, useState, useRef } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import toast from "react-hot-toast";
import Link from "next/link";

interface Stage {
  _id: string;
  name: string;
  color: string;
  order: number;
}

interface PipelineLead {
  _id: string;
  "First Name"?: string;
  "Last Name"?: string;
  Phone?: string;
  status?: string;
  pipelineStageId?: string;
  pipelineStageName?: string;
  leadType?: string;
  score?: number;
  createdAt?: string;
}

export default function PipelinePage() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [leads, setLeads] = useState<PipelineLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [newStageName, setNewStageName] = useState("");
  const draggingLeadId = useRef<string | null>(null);

  const fetchStages = async () => {
    const res = await fetch("/api/pipeline/stages");
    const data = await res.json();
    setStages(data.stages || []);
  };

  const fetchLeads = async () => {
    // Get leads across all folders (using search-all endpoint)
    const res = await fetch("/api/leads/search?q=&all=true&limit=200");
    if (res.ok) {
      const data = await res.json();
      setLeads(Array.isArray(data) ? data : data.leads || []);
    }
  };

  useEffect(() => {
    Promise.all([fetchStages(), fetchLeads()]).finally(() => setLoading(false));
  }, []);

  const leadsForStage = (stageId: string) =>
    leads.filter((l) => l.pipelineStageId === stageId);

  const unassignedLeads = leads.filter((l) => !l.pipelineStageId);

  const handleDragStart = (leadId: string) => {
    draggingLeadId.current = leadId;
  };

  const handleDrop = async (stageId: string, stageName: string) => {
    const leadId = draggingLeadId.current;
    if (!leadId) return;
    draggingLeadId.current = null;

    // Optimistic update
    setLeads((prev) =>
      prev.map((l) =>
        l._id === leadId ? { ...l, pipelineStageId: stageId, pipelineStageName: stageName } : l
      )
    );

    try {
      await fetch("/api/pipeline/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, stageId, stageName }),
      });
    } catch {
      toast.error("Failed to move lead");
      fetchLeads();
    }
  };

  const addStage = async () => {
    if (!newStageName.trim()) return;
    await fetch("/api/pipeline/stages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newStageName }),
    });
    setNewStageName("");
    fetchStages();
  };

  const deleteStage = async (id: string) => {
    if (!confirm("Delete this stage? Leads in it will become unassigned.")) return;
    await fetch(`/api/pipeline/stages?id=${id}`, { method: "DELETE" });
    fetchStages();
  };

  const LeadCard = ({ lead }: { lead: PipelineLead }) => {
    const name = `${lead["First Name"] || ""} ${lead["Last Name"] || ""}`.trim() || "Unknown";
    return (
      <div
        draggable
        onDragStart={() => handleDragStart(lead._id)}
        className="bg-[#1e293b] rounded-lg p-3 text-sm cursor-grab active:cursor-grabbing border border-white/10 hover:border-indigo-500 transition"
      >
        <div className="flex items-center justify-between">
          <Link href={`/lead/${lead._id}`} className="font-semibold text-white hover:text-indigo-400">
            {name}
          </Link>
          {typeof lead.score === "number" && (
            <span
              className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                lead.score >= 70
                  ? "bg-green-900 text-green-300"
                  : lead.score >= 40
                  ? "bg-yellow-900 text-yellow-300"
                  : "bg-red-900 text-red-300"
              }`}
            >
              {lead.score}
            </span>
          )}
        </div>
        {lead.Phone && <p className="text-gray-400 text-xs mt-1">{lead.Phone}</p>}
        {lead.leadType && (
          <p className="text-gray-500 text-xs">{lead.leadType}</p>
        )}
      </div>
    );
  };

  const StageColumn = ({ stage }: { stage: Stage }) => {
    const [over, setOver] = useState(false);
    const stageLeads = leadsForStage(stage._id);

    return (
      <div
        className={`flex-shrink-0 w-64 bg-[#0f172a] rounded-xl flex flex-col border transition ${
          over ? "border-indigo-500" : "border-white/5"
        }`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={() => { setOver(false); handleDrop(stage._id, stage.name); }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: stage.color }} />
            <span className="font-semibold text-white text-sm">{stage.name}</span>
            <span className="text-xs bg-white/10 rounded-full px-2">{stageLeads.length}</span>
          </div>
          <button
            onClick={() => deleteStage(stage._id)}
            className="text-gray-600 hover:text-red-400 text-xs"
          >
            ×
          </button>
        </div>
        <div className="p-3 space-y-2 flex-1 overflow-y-auto max-h-[60vh]">
          {stageLeads.map((lead) => (
            <LeadCard key={lead._id} lead={lead} />
          ))}
          {stageLeads.length === 0 && (
            <p className="text-gray-600 text-xs text-center py-4">Drop leads here</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Pipeline Board</h1>
          <div className="flex gap-2">
            <input
              value={newStageName}
              onChange={(e) => setNewStageName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addStage()}
              placeholder="New stage name..."
              className="bg-[#0f172a] border border-white/10 text-white rounded-lg px-3 py-1.5 text-sm"
            />
            <button
              onClick={addStage}
              className="bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg text-sm font-semibold"
            >
              + Add Stage
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-gray-400">Loading pipeline...</p>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {/* Unassigned column */}
            {unassignedLeads.length > 0 && (
              <div className="flex-shrink-0 w-64 bg-[#0f172a] rounded-xl flex flex-col border border-white/5">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
                  <span className="w-3 h-3 rounded-full bg-gray-500" />
                  <span className="font-semibold text-white text-sm">Unassigned</span>
                  <span className="text-xs bg-white/10 rounded-full px-2">{unassignedLeads.length}</span>
                </div>
                <div className="p-3 space-y-2 flex-1 overflow-y-auto max-h-[60vh]">
                  {unassignedLeads.slice(0, 20).map((lead) => (
                    <LeadCard key={lead._id} lead={lead} />
                  ))}
                </div>
              </div>
            )}

            {stages.map((stage) => (
              <StageColumn key={stage._id} stage={stage} />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
