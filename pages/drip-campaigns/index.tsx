import Link from "next/link";
import { prebuiltDrips } from "@/utils/prebuiltDrips";
import Sidebar from "@/components/Sidebar";

export default function DripCampaignsPanel() {
  return (
    <div className="flex min-h-screen bg-[#0f172a] text-white">
      <Sidebar />

      <div className="flex-1 p-6">
        <h1 className="text-2xl font-bold mb-6">Drip Campaigns</h1>

        <div className="grid grid-cols-1 gap-4">
          {prebuiltDrips.map((drip) => (
            <Link key={drip.id} href={`/drip-campaigns/${drip.id}`}>
              <div className="border border-gray-700 p-4 rounded bg-[#1e293b] shadow hover:bg-[#334155] cursor-pointer transition">
                <h2 className="font-semibold text-lg">{drip.name}</h2>
                <p>Type: {drip.type.toUpperCase()}</p>
                <p>Steps: {drip.messages.length}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
