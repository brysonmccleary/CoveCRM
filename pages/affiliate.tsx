// /pages/affiliate.tsx

import { useEffect, useState } from "react";
import axios from "axios";
import { getSession } from "next-auth/react";

interface AffiliateData {
  referralCode: string;
  referredBy?: string;
  affiliateApproved: boolean;
  commissionEarned: number;
  commissionThisMonth: number;
  totalSignups: number;
}

export default function AffiliateDashboard() {
  const [data, setData] = useState<AffiliateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const session = await getSession();
        if (!session) return;

        const res = await axios.get("/api/affiliate");
        setData(res.data);
      } catch (err) {
        console.error("Error fetching affiliate data:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  if (loading) return <div className="p-6">Loading...</div>;
  if (!data) return <div className="p-6">No data available.</div>;

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const signupUrl = `${baseUrl}/signup?code=${data.referralCode}`;

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6 bg-white dark:bg-gray-800 rounded shadow">
      <h1 className="text-2xl font-bold">Affiliate Dashboard</h1>
      <p className="text-gray-600 dark:text-gray-300">
        Earn rewards by sharing your unique link.
      </p>

      <div>
        <p className="font-semibold">Your Referral Code:</p>
        <div className="bg-gray-100 dark:bg-gray-700 p-2 rounded">
          {data.referralCode}
        </div>
      </div>

      <div>
        <p className="font-semibold">Your Referral Link:</p>
        <div className="flex items-center mt-2 space-x-2">
          <input
            value={signupUrl}
            readOnly
            className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded"
          />
          <button
            onClick={() => {
              navigator.clipboard.writeText(signupUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="bg-blue-600 text-white px-3 py-1 rounded"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="font-semibold">Total Signups:</p>
          <p>{data.totalSignups}</p>
        </div>

        <div>
          <p className="font-semibold">Commission This Month:</p>
          <p>${data.commissionThisMonth.toFixed(2)}</p>
        </div>

        <div>
          <p className="font-semibold">Total Commission:</p>
          <p>${data.commissionEarned.toFixed(2)}</p>
        </div>

        <div>
          <p className="font-semibold">Status:</p>
          <p>
            {data.affiliateApproved ? "✅ Approved" : "⏳ Pending Approval"}
          </p>
        </div>
      </div>
    </div>
  );
}
