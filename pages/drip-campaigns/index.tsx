import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import Link from "next/link";
import AssignDripModal from "@/components/AssignDripModal";

interface Step {
  text: string;
  day: string;
}

interface Drip {
  _id: string;
  name: string;
  type: string;
  steps: Step[];
}

interface Folder {
  _id: string;
  name: string;
}

export default function DripCampaignsPanel() {
  const [drips, setDrips] = useState<Drip[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [currentText, setCurrentText] = useState("");
  const [currentDay, setCurrentDay] = useState("immediately");
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedDripId, setSelectedDripId] = useState<string | null>(null);

  // Fetch drips on load
  useEffect(() => {
    fetch("/api/drips")
      .then((res) => res.json())
      .then((data) => setDrips(data));

    fetch("/api/get-folders")
      .then((res) => res.json())
      .then((data) => setFolders(data.folders || []))
      .catch((err) => console.error("Error loading folders:", err));
  }, []);

  // Add new step to custom drip
  const addStep = () => {
    if (!currentText) return;
    setSteps([...steps, { text: currentText, day: currentDay }]);
    setCurrentText("");
    setCurrentDay("immediately");
  };

  // Save custom drip
  const saveDrip = async () => {
    if (!name || steps.length === 0) {
      alert("Please add a name and at least one step.");
      return;
    }
    const res = await fetch("/api/drips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type: "sms", steps }),
    });

    if (res.ok) {
      const newDrip = await res.json();
      setDrips([...drips, newDrip]);
      setName("");
      setSteps([]);
      alert("Custom drip saved!");
    } else {
      alert("Error saving drip");
    }
  };

  const handleAssign = (id: string) => {
    setSelectedDripId(id);
    setShowAssignModal(true);
  };

  const handleAssignConfirm = async (folderId: string) => {
    if (!selectedDripId) return;

    const res = await fetch("/api/assign-drip-to-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dripId: selectedDripId, folderId }),
    });

    if (res.ok) {
      alert("Drip assigned successfully!");
      setShowAssignModal(false);
    } else {
      alert("Error assigning drip");
    }
  };

  return (
    <div className="flex min-h-screen bg-[#0f172a] text-white">
      <Sidebar />
      <div className="flex-1 p-6">
        <h1 className="text-2xl font-bold mb-6">Drip Campaigns</h1>

        {/* Create custom drip */}
        <div className="border border-gray-600 p-4 rounded mb-8">
          <h2 className="text-lg font-semibold mb-2">
            Create Custom Drip Campaign
          </h2>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Campaign Name"
            className="border border-gray-600 p-2 w-full rounded mb-2 bg-[#1e293b] text-white"
          />
          <div className="flex flex-col md:flex-row space-y-2 md:space-y-0 md:space-x-2">
            <input
              value={currentText}
              onChange={(e) => setCurrentText(e.target.value)}
              placeholder="Message text"
              className="border border-gray-600 p-2 flex-1 rounded bg-[#1e293b] text-white"
            />
            <select
              value={currentDay}
              onChange={(e) => setCurrentDay(e.target.value)}
              className="border border-gray-600 p-2 rounded bg-[#1e293b] text-white"
            >
              <option value="immediately">Immediately</option>
              {[...Array(365)].map((_, i) => (
                <option key={i + 1} value={`Day ${i + 1}`}>
                  Day {i + 1}
                </option>
              ))}
            </select>
            <button
              onClick={addStep}
              className="border border-gray-600 px-4 rounded bg-green-700 hover:bg-green-800"
            >
              Add
            </button>
          </div>

          {steps.length > 0 && (
            <div className="mt-2 space-y-2">
              <h3 className="font-semibold">Messages:</h3>
              {steps.map((step, idx) => (
                <div key={idx} className="border border-gray-600 p-2 rounded">
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
            onClick={saveDrip}
            className="mt-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded"
          >
            Save Campaign
          </button>
        </div>

        {/* List all drips */}
        <div className="grid grid-cols-1 gap-4">
          {drips.map((drip) => (
            <div
              key={drip._id}
              className="border border-gray-700 p-4 rounded bg-[#1e293b] shadow"
            >
              <h2 className="font-semibold text-lg">{drip.name}</h2>
              <p>Type: {drip.type.toUpperCase()}</p>
              <p>Steps: {drip.steps.length}</p>
              <div className="mt-2 flex space-x-2">
                <Link
                  href={`/drip-campaigns/${drip._id}`}
                  className="underline text-blue-400"
                >
                  View & Edit
                </Link>
                <button
                  onClick={() => handleAssign(drip._id)}
                  className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded"
                >
                  Assign to Folder/Leads
                </button>
              </div>
            </div>
          ))}
        </div>

        {showAssignModal && selectedDripId && (
          <AssignDripModal
            dripId={selectedDripId}
            folders={folders}
            onClose={() => setShowAssignModal(false)}
            onAssign={handleAssignConfirm}
          />
        )}
      </div>
    </div>
  );
}
