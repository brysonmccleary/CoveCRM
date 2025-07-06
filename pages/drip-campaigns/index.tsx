import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import dbConnect from "@/lib/dbConnect";
import DripCampaign from "@/models/DripCampaign";

interface Drip {
  _id: string;
  name: string;
  type: string;
  isActive: boolean;
  steps: any[];
}

export default function DripCampaignsList() {
  const [drips, setDrips] = useState<Drip[]>([]);

  useEffect(() => {
    fetchDrips();
  }, []);

  const fetchDrips = async () => {
    const res = await axios.get("/api/drips");
    setDrips(res.data);
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Drip Campaigns</h1>

      <Link href="/drip-campaigns/new" className="bg-blue-600 text-white px-4 py-2 rounded">
        Create New Drip
      </Link>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        {drips.map((drip) => (
          <Link key={drip._id} href={`/drip-campaigns/${drip._id}`} className="border p-4 rounded shadow hover:bg-gray-100">
            <h2 className="font-semibold text-lg">{drip.name}</h2>
            <p>Type: {drip.type.toUpperCase()}</p>
            <p>Status: {drip.isActive ? "Active ✅" : "Inactive ❌"}</p>
            <p>Steps: {drip.steps.length}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
