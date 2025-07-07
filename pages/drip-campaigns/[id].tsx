import { useRouter } from "next/router";
import { useState, useEffect } from "react";
import axios from "axios";
import Sidebar from "@/components/Sidebar";

export default function DripCampaignDetail() {
  const router = useRouter();
  const { id } = router.query;

  const [drip, setDrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const fetchDrip = async () => {
      try {
        const res = await axios.get(`/api/drips/${id}`);
        setDrip(res.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchDrip();
  }, [id]);

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

        <ul className="list-disc pl-5 text-sm space-y-2">
          {drip.steps.map((step: any, idx: number) => (
            <li key={idx}>
              <strong>{step.day}:</strong> {step.text}
            </li>
          ))}
        </ul>

        <div className="flex gap-2 mt-6">
          <button
            onClick={handleAssign}
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded"
          >
            Assign to Folder/Leads
          </button>
          <button
            onClick={handleDelete}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded"
          >
            Delete Drip
          </button>
          <button
            onClick={() => router.push("/drip-campaigns")}
            className="bg-gray-700 hover:bg-gray-800 text-white px-4 py-2 rounded"
          >
            Back to Campaigns
          </button>
        </div>
      </div>
    </div>
  );
}
