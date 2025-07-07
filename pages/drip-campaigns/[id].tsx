import { useRouter } from "next/router";
import { useState } from "react";
import { prebuiltDrips } from "@/utils/prebuiltDrips";
import Sidebar from "@/components/Sidebar";

export default function DripCampaignDetail() {
  const router = useRouter();
  const { id } = router.query;

  const drip = prebuiltDrips.find((d) => d.id === id);
  const [steps, setSteps] = useState(drip?.messages || []);

  if (!drip) return <p>Drip not found</p>;

  const handleStepChange = (idx: number, field: string, value: string) => {
    const updated = [...steps];
    updated[idx] = { ...updated[idx], [field]: value };
    setSteps(updated);
  };

  return (
    <div className="flex min-h-screen bg-[#0f172a] text-white">
      <Sidebar />

      <div className="flex-1 p-6">
        <h1 className="text-2xl font-bold mb-2">{drip.name}</h1>
        <p className="mb-6">Type: {drip.type.toUpperCase()}</p>

        <h2 className="text-xl font-semibold mb-4">Steps / Messages</h2>

        <div className="space-y-4">
          {steps.map((step, idx) => (
            <div key={idx} className="border border-gray-700 p-4 rounded bg-[#1e293b] shadow">
              <textarea
                value={step.text}
                onChange={(e) => handleStepChange(idx, "text", e.target.value)}
                className="w-full p-2 border border-gray-600 rounded mb-2 bg-[#0f172a] text-white"
                rows={3}
              />
              <input
                value={step.day}
                onChange={(e) => handleStepChange(idx, "day", e.target.value)}
                className="w-full p-2 border border-gray-600 rounded mb-2 bg-[#0f172a] text-white"
                placeholder="Day"
              />
            </div>
          ))}
        </div>

        <button
          onClick={() => alert("Changes saved locally (implement DB save if needed)")}
          className="mt-4 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded"
        >
          Save Changes
        </button>

        <button
          onClick={() => router.push("/drip-campaigns")}
          className="mt-4 ml-4 bg-gray-700 hover:bg-gray-800 text-white px-4 py-2 rounded"
        >
          Back to Campaigns
        </button>
      </div>
    </div>
  );
}
