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

export default function DripCampaignsPanel() {
  const [campaignName, setCampaignName] = useState("");
  const [messageSteps, setMessageSteps] = useState<MessageStep[]>([]);
  const [currentText, setCurrentText] = useState("");
  const [currentDay, setCurrentDay] = useState("immediately");
  const [maxDayUsed, setMaxDayUsed] = useState(0);
  const [savedCampaigns, setSavedCampaigns] = useState<any[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [selectedDripId, setSelectedDripId] = useState<string | null>(null);
  const [expandedDrips, setExpandedDrips] = useState<Record<string, boolean>>({});
  const [editableDrips, setEditableDrips] = useState<Record<string, MessageStep[]>>({});

  useEffect(() => {
    const fetchFolders = async () => {
      try {
        const res = await axios.get("/api/folders");
        setFolders(res.data);
      } catch (error) {
        toast.error("❌ Error fetching folders");
      }
    };
    fetchFolders();
  }, []);

  const addStep = () => {
    if (!currentText) return;

    const numericDay =
      currentDay === "immediately" ? 0 : parseInt(currentDay.replace("Day ", ""));

    const optOut = " Reply STOP to opt out.";
    const enforcedText = currentText.trim().endsWith(optOut)
      ? currentText.trim()
      : `${currentText.trim()}${optOut}`;

    setMessageSteps([...messageSteps, { text: enforcedText, day: currentDay }]);
    setCurrentText("");
    setCurrentDay(`Day ${numericDay + 1}`);
    setMaxDayUsed(Math.max(maxDayUsed, numericDay));
  };

  const saveCampaign = () => {
    if (!campaignName || messageSteps.length === 0) {
      toast.error("❌ Please enter a campaign name and at least one message.");
      return;
    }
    const newCampaign = { name: campaignName, steps: messageSteps };
    setSavedCampaigns([...savedCampaigns, newCampaign]);
    setCampaignName("");
    setMessageSteps([]);
    setMaxDayUsed(0);
    toast.success("✅ Custom drip campaign saved!");
  };

  const toggleExpand = (dripId: string) => {
    const isExpanded = expandedDrips[dripId] || false;
    setExpandedDrips({ ...expandedDrips, [dripId]: !isExpanded });

    if (!editableDrips[dripId]) {
      const found = prebuiltDrips.find((d) => d.id === dripId);
      if (found) setEditableDrips({ ...editableDrips, [dripId]: [...found.messages] });
    }
  };

  const handleEditMessage = (
    dripId: string,
    index: number,
    key: "text" | "day",
    value: string
  ) => {
    const updated = [...(editableDrips[dripId] || [])];
    updated[index][key] = value;
    setEditableDrips({ ...editableDrips, [dripId]: updated });
  };

  const handleAssignDrip = (dripId: string) => {
    setSelectedDripId(dripId);
    setShowModal(true);
    toast.success("✅ Drip selected — now assign it!");
  };

  const handleSaveDrip = (dripId: string) => {
    toast.success("✅ Changes saved (mock save — hook backend if needed)");
  };

  const handleDeleteDrip = (dripId: string) => {
    const newExpanded = { ...expandedDrips };
    const newEditable = { ...editableDrips };
    delete newExpanded[dripId];
    delete newEditable[dripId];
    setExpandedDrips(newExpanded);
    setEditableDrips(newEditable);
    toast.success("🗑️ Drip cleared from view (mock delete)");
  };

  const insertMergeField = (field: string) => {
    setCurrentText((prev) => `${prev} <${field}>`);
  };

  const generateDayOptions = () => {
    const options: string[] = [];
    if (maxDayUsed === 0) {
      options.push("immediately");
    }
    const start = maxDayUsed === 0 ? 1 : maxDayUsed + 1;
    for (let i = start; i <= 365; i++) {
      options.push(`Day ${i}`);
    }
    return options;
  };

  return (
    <div className="p-4 space-y-6">
      {/* Custom Campaign Creator */}
      <div className="border border-black dark:border-white p-4 rounded">
        <h2 className="text-xl font-bold mb-2">Create Custom Drip Campaign</h2>
        <input
          value={campaignName}
          onChange={(e) => setCampaignName(e.target.value)}
          placeholder="Campaign Name"
          className="border border-black dark:border-white p-2 w-full rounded mb-2"
        />

        {/* Merge Fields */}
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
              <option key={idx} value={day}>{day}</option>
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
                <p><strong>When:</strong> {step.day}</p>
                <p><strong>Message:</strong> {step.text}</p>
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
        <div key={drip.id} className="border border-black dark:border-white p-3 rounded mb-4">
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
                    onChange={(e) => handleEditMessage(drip.id, idx, "day", e.target.value)}
                    className="border border-black dark:border-white p-1 rounded w-32 text-sm"
                  />
                  <textarea
                    value={msg.text}
                    onChange={(e) => handleEditMessage(drip.id, idx, "text", e.target.value)}
                    className="border border-black dark:border-white p-2 rounded w-full text-sm"
                  />
                </div>
              ))}
              <div className="flex space-x-2 pt-2">
                <button
                  onClick={() => handleSaveDrip(drip.id)}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded cursor-pointer"
                >
                  Save Changes
                </button>
                <button
                  onClick={() => handleDeleteDrip(drip.id)}
                  className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded cursor-pointer"
                >
                  Delete Drip
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Saved Campaigns */}
      {savedCampaigns.length > 0 && (
        <div>
          <h2 className="text-xl font-bold mt-8">Your Custom Campaigns</h2>
          {savedCampaigns.map((camp, idx) => (
            <div key={idx} className="border border-black dark:border-white p-3 rounded mb-4">
              <h3 className="font-semibold">{camp.name}</h3>
              <ul className="list-disc pl-5 text-sm">
                {camp.steps.map((msg: MessageStep, stepIdx: number) => (
                  <li key={stepIdx}>
                    <strong>{msg.day}:</strong> {msg.text}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Assign Drip Modal */}
      {selectedDripId && (
        <AssignDripModal
          isOpen={showModal}
          onClose={() => {
            setShowModal(false);
            setSelectedDripId(null);
          }}
          dripId={selectedDripId}
        />
      )}
    </div>
  );
}
