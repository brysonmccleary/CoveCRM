// components/Admin/AffiliatesDashboard.tsx

import { useEffect, useState } from "react";
import axios from "axios";

interface Affiliate {
  name: string;
  email: string;
  promoCode: string;
  totalRedemptions: number;
  totalRevenueGenerated: number;
  payoutDue: number;
}

export default function AffiliatesDashboard() {
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);

  useEffect(() => {
    axios.get("/api/affiliates/all").then((res) => {
      setAffiliates(res.data);
    });
  }, []);

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">Affiliate Dashboard</h2>
      <div className="overflow-x-auto">
        <table className="w-full table-auto text-left bg-gray-800 text-white rounded">
          <thead>
            <tr className="bg-gray-700 text-sm uppercase">
              <th className="p-3">Name</th>
              <th className="p-3">Email</th>
              <th className="p-3">Promo Code</th>
              <th className="p-3">Redemptions</th>
              <th className="p-3">Revenue</th>
              <th className="p-3">Payout Due</th>
            </tr>
          </thead>
          <tbody>
            {affiliates.map((a, idx) => (
              <tr key={idx} className="border-t border-gray-600">
                <td className="p-3">{a.name}</td>
                <td className="p-3">{a.email}</td>
                <td className="p-3">{a.promoCode}</td>
                <td className="p-3">{a.totalRedemptions}</td>
                <td className="p-3">${a.totalRevenueGenerated.toFixed(2)}</td>
                <td className="p-3">${a.payoutDue.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
