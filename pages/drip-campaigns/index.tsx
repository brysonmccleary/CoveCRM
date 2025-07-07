import { useState, useEffect } from "react";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import axios from "axios";
import type { Drip } from "@/types/drip";

export default function DripCampaignsPanel() {
  const [drips, setDrips] = useState<Drip[]>([]);
  const [campaignName, setCampaignName] = useState("");
  const [currentText, setCurrentText] = useState("");
  const [currentDay, setCurrentDay] = useState("immediately");
  const [messageSteps, setMessageSteps] = useState<{ text: string; day: string }[]>([]);

  // Load drips on mount
  useEffect(() => {
    const fetchDrips = async () => {
      const res = await axios.get("/api/drips");
      setDrips(res.data);
    };
    fetchDrips();
  }, []);

  const addStep = () => {
    if (!currentText) return;
    setMessageSteps([...messageSteps, { text: currentText, day: currentDay }]);
    setCurrentText("");
    setCurrentDay("immediately");
  };

  const saveCampaign = async () => {
    if (!campaignName || messageSteps.length === 0) {
      alert("Please enter a campaign name and at least one message.");
      return;
    }
    try {
      await axios.post("/api/drips", {
        name: campaignName,
        type: "sms",
        steps: messageSteps,
        isActive: true,
      });
      setCampaignName("");
      setMessageSteps([]);
      const res = await axios.get("/api/drips");
      setDrips(res.data);
      alert("Drip campaign saved!");
    } catch (err) {
      alert("Error saving campaign.");
    }
  };

  const assignDrip = async (dripId: string) => {
    alert(`Assigning drip campaign ID: ${dripId}. Connect to folders/leads modal here.`);
  };

  return (
    <div className="flex min-h-screen bg-[#0f172a] text-white">
      <Sidebar />

      <div className="flex-1 p-6 space-y-8">
        <h1 className="text-2xl font-bold">Drip Campaigns</h1>

        {/* ✅ Create Custom Drip Panel */}
        <div className="border border-gray-700 p-4 rounded bg-[#1e293b]">
          <h2 className="text-lg font-semibold mb-2">Create Custom Drip Campaign</h2>
          <input
            value={campaignName}
            onChange={(e) => setCampaignName(e.target.value)}
            placeholder="Campaign Name"
            className="border border-gray-600 p-2 w-full rounded mb-2 bg-[#0f172a] text-white"
          />
          <div className="flex flex-col md:flex-row gap-2 mb-2">
            <input
              value={currentText}
              onChange={(e) => setCurrentText(e.target.value)}
              placeholder="Message text"
              className="border border-gray-600 p-2 flex-1 rounded bg-[#0f172a] text-white"
            />
            <select
              value={currentDay}
              onChange={(e) => setCurrentDay(e.target.value)}
              className="border border-gray-600 p-2 rounded bg-[#0f172a] text-white"
            >
              <option value="immediately">Immediately</option>
              {[...Array(365)].map((_, i) => (
                <option key={i + 1} value={`Day ${i + 1}`}>
                  Day {i + 1}
                </option>
              ))}
            </select>
            <button onClick={addStep} className="border border-green-500 px-4 rounded">
              Add
            </button>
          </div>
          {messageSteps.length > 0 && (
            <div className="space-y-1">
              <h3 className="font-medium">Messages:</h3>
              {messageSteps.map((step, idx) => (
                <div key={idx} className="border border-gray-600 p-2 rounded">
                  <p><strong>When:</strong> {step.day}</p>
                  <p><strong>Message:</strong> {step.text}</p>
                </div>
              ))}
            </div>
          )}
          <button onClick={saveCampaign} className="mt-2 bg-green-600 hover:bg-green-700 px-4 py-2 rounded">
            Save Campaign
          </button>
        </div>

        {/* ✅ Drip List */}
        <div className="grid grid-cols-1 gap-4">
          {drips.map((drip) => (
            <div key={drip._id} className="border border-gray-700 p-4 rounded bg-[#1e293b] shadow">
              <h2 className="font-semibold text-lg">{drip.name}</h2>
              <p>Type: {drip.type.toUpperCase()}</p>
              <p>Steps: {drip.steps.length}</p>
              <Link href={`/drip-campaigns/${drip._id}`} className="text-blue-400 underline text-sm">View & Edit</Link>
              <ul className="list-disc pl-5 text-sm mt-2">
                {drip.steps.map((msg, idx) => (
                  <li key={idx}><strong>{msg.day}:</strong> {msg.text}</li>
                ))}
              </ul>
              <button
                onClick={() => assignDrip(drip._id)}
                className="mt-2 bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded"
              >
                Assign to Folder/Leads
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
