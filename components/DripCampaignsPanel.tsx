// /components/DripCampaignsPanel.tsx
import { useEffect, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import AssignDripModal from "@/components/AssignDripModal";
import { prebuiltDrips } from "@/utils/prebuiltDrips";

interface MessageStep {
  text: string;
  day: string;
}

interface Folder {
  _id: string;
  name: string;
  assignedDrip?: string;
}

interface ApiCampaign {
  _id: string;
  name: string;
  key?: string | null;
  isActive: boolean;
  steps?: MessageStep[];
  isGlobal?: boolean;
  createdBy?: string | null;
  user?: string | null;
  userEmail?: string | null;
}

export default function DripCampaignsPanel() {
  const [campaignName, setCampaignName] = useState("");
  const [messageSteps, setMessageSteps] = useState<MessageStep[]>([]);
  const [currentText, setCurrentText] = useState("");
  const [currentDay, setCurrentDay] = useState("immediately");
  const [maxDayUsed, setMaxDayUsed] = useState(0);

  const [folders, setFolders] = useState<Folder[]>([]);

  const [showModal, setShowModal] = useState(false);
  const [selectedDripId, setSelectedDripId] = useState<string | null>(null);

  const [expandedDrips, setExpandedDrips] = useState<Record<string, boolean>>(
    {},
  );
  const [editableDrips, setEditableDrips] = useState<
    Record<string, MessageStep[]>
  >({});

  const [backendCampaigns, setBackendCampaigns] = useState<ApiCampaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);

  // Precompute prebuilt names to distinguish custom campaigns
  const prebuiltNames = new Set(prebuiltDrips.map((d) => d.name));

  // Load folders for assignment
  useEffect(() => {
    const fetchFolders = async () => {
      try {
        const res = await axios.get("/api/folders");
        setFolders(res.data);
      } catch {
        toast.error("❌ Error fetching folders");
      }
    };
    fetchFolders();
  }, []);

  // Load campaigns (global + user-scoped) from API
  useEffect(() => {
    const fetchCampaigns = async () => {
      try {
        setLoadingCampaigns(true);
        const res = await axios.get("/api/drips/campaigns?active=1");
        const campaigns: ApiCampaign[] = res.data?.campaigns || [];
        setBackendCampaigns(campaigns);
      } catch {
        toast.error("❌ Error fetching drip campaigns");
      } finally {
        setLoadingCampaigns(false);
      }
    };
    fetchCampaigns();
  }, []);

  // ---- Step builder for new custom campaigns ----
  const addStep = () => {
    if (!currentText) return;

    const numericDay =
      currentDay === "immediately"
        ? 0
        : parseInt(currentDay.replace("Day ", ""), 10);

    const optOut = " Reply STOP to opt out.";
    const enforcedText = currentText.trim().endsWith(optOut)
      ? currentText.trim()
      : `${currentText.trim()}${optOut}`;

    setMessageSteps((prev) => [...prev, { text: enforcedText, day: currentDay }]);
    setCurrentText("");
    setCurrentDay(`Day ${numericDay + 1}`);
    setMaxDayUsed((prev) => Math.max(prev, numericDay));
  };

  const generateDayOptions = () => {
    const options: string[] = [];
    if (maxDayUsed === 0) options.push("immediately");
    const start = maxDayUsed === 0 ? 1 : maxDayUsed + 1;
    for (let i = start; i <= 365; i++) options.push(`Day ${i}`);
    return options;
  };

  const insertMergeField = (field: string) => {
    // Keep legacy <token> style so it stays compatible with existing rendering logic
    setCurrentText((prev) => `${prev} <${field}>`);
  };

  // ---- Save new custom campaign to backend ----
  const saveCampaign = async () => {
    if (!campaignName || messageSteps.length === 0) {
      toast.error("❌ Please enter a campaign name and at least one message.");
      return;
    }

    try {
      const res = await axios.post("/api/drips/campaigns", {
        name: campaignName,
        steps: messageSteps,
      });

      const created: ApiCampaign | undefined = res.data?.campaign;
      if (created?._id) {
        setBackendCampaigns((prev) => [...prev, created]);
      }

      setCampaignName("");
      setMessageSteps([]);
      setMaxDayUsed(0);
      setCurrentDay("immediately");

      toast.success("✅ Custom drip campaign saved!");
    } catch (err: any) {
      console.error("Error saving custom drip campaign", err);
      toast.error("❌ Error saving custom drip campaign");
    }
  };

  // ---- Expand / edit helpers (works for BOTH prebuilt + custom) ----
  const toggleExpand = (dripId: string) => {
    const isExpanded = expandedDrips[dripId] || false;
    setExpandedDrips((prev) => ({ ...prev, [dripId]: !isExpanded }));

    // If we don't have an editable copy loaded, seed it from either:
    // - prebuiltDrips (static)
    // - backendCampaigns (custom/global)
    if (!editableDrips[dripId]) {
      const foundPrebuilt = prebuiltDrips.find((d) => d.id === dripId);
      if (foundPrebuilt) {
        setEditableDrips((prev) => ({
          ...prev,
          [dripId]: [...foundPrebuilt.messages],
        }));
        return;
      }

      const foundBackend = backendCampaigns.find((c) => c._id === dripId);
      if (foundBackend) {
        const seeded = Array.isArray(foundBackend.steps)
          ? foundBackend.steps.map((s) => ({
              day: String(s.day || "immediately"),
              text: String(s.text || ""),
            }))
          : [];
        setEditableDrips((prev) => ({
          ...prev,
          [dripId]: seeded,
        }));
      }
    }
  };

  const handleEditMessage = (
    dripId: string,
    index: number,
    key: "text" | "day",
    value: string,
  ) => {
    const updated = [...(editableDrips[dripId] || [])];
    if (!updated[index]) return;
    updated[index] = { ...updated[index], [key]: value };
    setEditableDrips({ ...editableDrips, [dripId]: updated });
  };

  const handleAssignDrip = (dripId: string) => {
    setSelectedDripId(dripId);
    setShowModal(true);
    toast.success("✅ Drip selected — now assign it!");
  };

  // Prebuilt: still mock save (unchanged behavior)
  const handleSavePrebuiltDrip = (dripId: string) => {
    toast.success("✅ Changes saved (mock save — hook backend if needed)");
  };

  // Prebuilt: still mock delete (unchanged behavior)
  const handleDeletePrebuiltDrip = (dripId: string) => {
    const newExpanded = { ...expandedDrips };
    const newEditable = { ...editableDrips };
    delete newExpanded[dripId];
    delete newEditable[dripId];
    setExpandedDrips(newExpanded);
    setEditableDrips(newEditable);
    toast.success("🗑️ Drip cleared from view (mock delete)");
  };

  // Custom: REAL save to backend (user-scoped in API)
  const handleSaveCustomDrip = async (dripId: string) => {
    const steps = editableDrips[dripId] || [];

    if (!Array.isArray(steps) || steps.length === 0) {
      toast.error("❌ Add at least one message before saving.");
      return;
    }

    // Enforce opt-out on every message (same rule as builder)
    const optOut = " Reply STOP to opt out.";
    const normalized = steps.map((s) => {
      const day = String(s.day || "immediately");
      const textRaw = String(s.text || "").trim();
      const text = textRaw.endsWith(optOut) ? textRaw : `${textRaw}${optOut}`;
      return { day, text };
    });

    try {
      const res = await axios.put(`/api/drips/${dripId}`, { steps: normalized });

      // Keep UI in sync with backend response
      const updated = res.data;
      setBackendCampaigns((prev) =>
        prev.map((c) =>
          c._id === dripId
            ? {
                ...c,
                steps: Array.isArray(updated?.steps) ? updated.steps : normalized,
              }
            : c,
        ),
      );

      // Ensure editable reflects what we saved
      setEditableDrips((prev) => ({
        ...prev,
        [dripId]: normalized,
      }));

      toast.success("✅ Custom drip updated!");
    } catch (err: any) {
      console.error("Error saving custom drip campaign", err);
      toast.error("❌ Error saving custom drip campaign");
    }
  };

  // Custom: REAL delete (user-scoped in API)
  const handleDeleteCustomDrip = async (dripId: string) => {
    if (!confirm("Delete this custom drip campaign? This cannot be undone.")) return;

    try {
      await axios.delete(`/api/drips/${dripId}`);

      setBackendCampaigns((prev) => prev.filter((c) => c._id !== dripId));

      const newExpanded = { ...expandedDrips };
      const newEditable = { ...editableDrips };
      delete newExpanded[dripId];
      delete newEditable[dripId];
      setExpandedDrips(newExpanded);
      setEditableDrips(newEditable);

      toast.success("🗑️ Custom drip deleted!");
    } catch (err: any) {
      console.error("Error deleting custom drip campaign", err);
      toast.error("❌ Error deleting custom drip campaign");
    }
  };

  const handleAssignConfirm = async (folderId: string) => {
    if (!selectedDripId) return;
    try {
      const res = await axios.post("/api/assign-drip-to-folder", {
        dripId: selectedDripId,
        folderId,
      });
      if (res.status === 200) {
        toast.success("✅ Drip assigned successfully!");
        setShowModal(false);
        setSelectedDripId(null);
      } else {
        toast.error("❌ Error assigning drip");
      }
    } catch {
      toast.error("❌ Error assigning drip");
    }
  };

  // ---- Custom campaigns derived from backend data ----
  const customCampaigns: ApiCampaign[] = backendCampaigns.filter(
    (c) => !prebuiltNames.has(c.name) && !c.isGlobal,
  );

  return (
    <div className="p-4 space-y-6">
      {/* Creator */}
      <div className="border border-black dark:border-white p-4 rounded">
        <h2 className="text-xl font-bold mb-2">Create Custom Drip Campaign</h2>
        <input
          value={campaignName}
          onChange={(e) => setCampaignName(e.target.value)}
          placeholder="Campaign Name"
          className="border border-black dark:border-white p-2 w-full rounded mb-2"
        />

        <div className="mb-2 space-x-2">
          <button
            onClick={() => insertMergeField("client_first_name")}
            className="text-xs bg-gray-700 text-white px-2 py-1 rounded hover:bg-gray-600"
          >
            Insert Client First Name
          </button>
          <button
            onClick={() => insertMergeField("agent_name")}
            className="text-xs bg-gray-700 text-white px-2 py-1 rounded hover:bg-gray-600"
          >
            Insert Agent Name
          </button>
          <button
            onClick={() => insertMergeField("agent_phone")}
            className="text-xs bg-gray-700 text-white px-2 py-1 rounded hover:bg-gray-600"
          >
            Insert Agent Phone
          </button>
          <button
            onClick={() => insertMergeField("folder_name")}
            className="text-xs bg-gray-700 text-white px-2 py-1 rounded hover:bg-gray-600"
          >
            Insert Folder Name
          </button>
        </div>

        <div className="flex flex-col md:flex-row space-y-2 md:space-y-0 md:space-x-2">
          <input
            value={currentText}
            onChange={(e) => setCurrentText(e.target.value)}
            placeholder="Message text"
            className="border border-black dark:border-white p-2 flex-1 rounded"
          />
          <select
            value={currentDay}
            onChange={(e) => setCurrentDay(e.target.value)}
            className="border border-black dark:border-white p-2 rounded"
          >
            {generateDayOptions().map((day, idx) => (
              <option key={idx} value={day}>
                {day}
              </option>
            ))}
          </select>
          <button
            onClick={addStep}
            className="border border-black dark:border-white px-4 rounded cursor-pointer"
          >
            Add
          </button>
        </div>

        {messageSteps.length > 0 && (
          <div className="space-y-2 mt-2">
            <h3 className="font-semibold">Messages in Campaign:</h3>
            {messageSteps.map((step, idx) => (
              <div key={idx} className="border border-black dark:border-white p-2 rounded">
                <p>
                  <strong>When:</strong> {step.day}
                </p>
                <p>
                  <strong>Message:</strong> {step.text}
                </p>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={saveCampaign}
          className="mt-2 border border-black dark:border-white px-4 py-2 rounded cursor-pointer"
        >
          Save Campaign
        </button>
      </div>

      {/* Prebuilt Drips */}
      <h2 className="text-xl font-bold mt-8">Prebuilt Drip Campaigns</h2>
      {prebuiltDrips.map((drip) => (
        <div
          key={drip.id}
          className="border border-black dark:border-white p-3 rounded mb-4"
        >
          <div className="flex justify-between items-center">
            <button
              onClick={() => toggleExpand(drip.id)}
              className="text-left font-semibold text-lg cursor-pointer"
            >
              {drip.name} — {drip.messages.length} messages
            </button>
            <button
              onClick={() => handleAssignDrip(drip.id)}
              className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm cursor-pointer"
            >
              Assign to Folder/Leads
            </button>
          </div>

          {expandedDrips[drip.id] && (
            <div className="mt-4 space-y-3">
              {editableDrips[drip.id]?.map((msg, idx) => (
                <div key={idx} className="space-y-1">
                  <input
                    value={msg.day}
                    onChange={(e) =>
                      handleEditMessage(drip.id, idx, "day", e.target.value)
                    }
                    className="border border-black dark:border-white p-1 rounded w-32 text-sm"
                  />
                  <textarea
                    value={msg.text}
                    onChange={(e) =>
                      handleEditMessage(drip.id, idx, "text", e.target.value)
                    }
                    className="border border-black dark:border-white p-2 rounded w-full text-sm"
                  />
                </div>
              ))}
              <div className="flex space-x-2 pt-2">
                <button
                  onClick={() => handleSavePrebuiltDrip(drip.id)}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded cursor-pointer"
                >
                  Save Changes
                </button>
                <button
                  onClick={() => handleDeletePrebuiltDrip(drip.id)}
                  className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded cursor-pointer"
                >
                  Delete Drip
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Custom Campaigns from backend (NOW expandable + editable like prebuilt) */}
      <h2 className="text-xl font-bold mt-8">
        Your Custom Campaigns{" "}
        {loadingCampaigns && (
          <span className="text-sm font-normal text-gray-400">(loading…)</span>
        )}
      </h2>
      {customCampaigns.length === 0 && !loadingCampaigns && (
        <p className="text-sm text-gray-400">
          You don&apos;t have any custom drip campaigns yet.
        </p>
      )}

      {customCampaigns.map((camp) => (
        <div
          key={camp._id}
          className="border border-black dark:border-white p-3 rounded mb-4"
        >
          <div className="flex justify-between items-center">
            <button
              onClick={() => toggleExpand(camp._id)}
              className="text-left font-semibold text-lg cursor-pointer"
            >
              {camp.name} — {(camp.steps || []).length} messages
            </button>
            <button
              onClick={() => handleAssignDrip(camp._id)}
              className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm cursor-pointer"
            >
              Assign to Folder/Leads
            </button>
          </div>

          {expandedDrips[camp._id] && (
            <div className="mt-4 space-y-3">
              {editableDrips[camp._id]?.map((msg, idx) => (
                <div key={idx} className="space-y-1">
                  <input
                    value={msg.day}
                    onChange={(e) =>
                      handleEditMessage(camp._id, idx, "day", e.target.value)
                    }
                    className="border border-black dark:border-white p-1 rounded w-32 text-sm"
                  />
                  <textarea
                    value={msg.text}
                    onChange={(e) =>
                      handleEditMessage(camp._id, idx, "text", e.target.value)
                    }
                    className="border border-black dark:border-white p-2 rounded w-full text-sm"
                  />
                </div>
              ))}

              <div className="flex space-x-2 pt-2">
                <button
                  onClick={() => handleSaveCustomDrip(camp._id)}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded cursor-pointer"
                >
                  Save Changes
                </button>
                <button
                  onClick={() => handleDeleteCustomDrip(camp._id)}
                  className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded cursor-pointer"
                >
                  Delete Drip
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Assign Drip Modal */}
      {showModal && selectedDripId && (
        <AssignDripModal
          dripId={selectedDripId}
          folders={folders}
          onClose={() => {
            setShowModal(false);
            setSelectedDripId(null);
          }}
          onAssign={handleAssignConfirm}
        />
      )}
    </div>
  );
}
