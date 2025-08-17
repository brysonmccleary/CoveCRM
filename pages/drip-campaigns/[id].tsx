import { useRouter } from "next/router";
import { useState, useEffect } from "react";
import axios from "axios";
import Sidebar from "@/components/Sidebar";

export default function DripCampaignDetail() {
  const router = useRouter();
  const { id } = router.query;

  const [drip, setDrip] = useState<any>(null);
  const [steps, setSteps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const fetchDrip = async () => {
      try {
        const res = await axios.get(`/api/drips/${id}`);
        setDrip(res.data);
        setSteps(res.data.steps || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchDrip();
  }, [id]);

  const handleStepChange = (idx: number, field: string, value: string) => {
    const updated = [...steps];
    updated[idx] = { ...updated[idx], [field]: value };
    setSteps(updated);
  };

  const saveChanges = async () => {
    try {
      await axios.put(`/api/drips/${id}`, { steps });
      alert("Changes saved successfully!");
    } catch (err) {
      alert("Error saving changes");
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this drip campaign?")) return;
    try {
      await axios.delete(`/api/drips/${id}`);
      alert("Drip deleted");
      router.push("/drip-campaigns");
    } catch (err) {
      alert("Error deleting drip");
    }
  };

  const handleAssign = () => {
    alert(`Assigning drip campaign ID: ${id} — connect to folders/leads modal here.`);
  };

  if (loading) return <div className="text-white p-4">Loading...</div>;
  if (!drip) return <div className="text-white p-4">Drip not found</div>;

  return (
    <div className="flex min-h-screen bg-[#0f172a] text-white">
      <Sidebar />
      <div className="flex-1 p-6">
        <h1 className="text-2xl font-bold mb-2">{drip.name}</h1>
        <p className="mb-6">Type: {drip.type.toUpperCase()}</p>

        <h2 className="text-xl font-semibold mb-4">Steps / Messages</h2>

        <div className="space-y-4">
          {steps.map((step: any, idx: number) => (
            <div key={idx} className="border border-gray-700 p-4 rounded bg-[#1e293b] shadow">
              <label className="block mb-1">Day:</label>
              <input
                value={step.day}
                onChange={(e) => handleStepChange(idx, "day", e.target.value)}
                className="w-full p-2 mb-2 border border-gray-600 rounded bg-[#0f172a] text-white"
              />

              <label className="block mb-1">Message:</label>
              <textarea
                value={step.text}
                onChange={(e) => handleStepChange(idx, "text", e.target.value)}
                className="w-full p-2 border border-gray-600 rounded bg-[#0f172a] text-white"
                rows={3}
              />
            </div>
          ))}
        </div>

        <button
          onClick={saveChanges}
          className="mt-4 bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded"
        >
          Save Changes
        </button>

        <button
          onClick={handleAssign}
          className="mt-4 ml-4 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
        >
          Assign to Folder/Leads
        </button>

        <button
          onClick={handleDelete}
          className="mt-4 ml-4 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded"
        >
          Delete Drip
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
