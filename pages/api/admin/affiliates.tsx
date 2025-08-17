// /pages/admin/affiliates.tsx

import { useEffect, useState } from "react";
import axios from "axios";
import { getSession, useSession } from "next-auth/react";
import Head from "next/head";
import AffiliatesDashboard from "@/components/Admin/AffiliatesDashboard";

interface AffiliateStat {
  _id: string;
  referralCode: string;
  email: string;
  referredCount: number;
}

export default function AdminAffiliateList() {
  const { data: session, status } = useSession();
  const [codes, setCodes] = useState<AffiliateStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      const currentSession = await getSession();
      if (!currentSession || currentSession.user.email !== "bryson.mccleary1@gmail.com") return;

      try {
        const res = await axios.get("/api/admin/get-affiliate-codes");
        setCodes(res.data.codes || []);
      } catch (err) {
        console.error("Error fetching affiliate stats:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, []);

  if (status === "loading" || loading) {
    return <div className="p-6">Loading leaderboard...</div>;
  }

  const isAdmin = session?.user?.email === "bryson.mccleary1@gmail.com";

  if (!isAdmin) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-bold text-red-500">Access Denied</h1>
        <p>You do not have permission to view this page.</p>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Affiliate Dashboard | Admin</title>
      </Head>
      <div className="max-w-5xl mx-auto p-6 bg-white dark:bg-gray-900 rounded shadow">
        <h1 className="text-3xl font-bold mb-6">Affiliate Dashboard (Admin Only)</h1>

        {/* Your original table */}
        <div className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Basic Signups by Referral Code</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-gray-300 dark:border-gray-600">
                <th className="py-2">Affiliate Email</th>
                <th className="py-2">Referral Code</th>
                <th className="py-2">Signups</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((code) => (
                <tr key={code._id} className="border-b border-gray-200 dark:border-gray-700">
                  <td className="py-2">{code.email}</td>
                  <td className="py-2">{code.referralCode}</td>
                  <td className="py-2">{code.referredCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* New full leaderboard */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Full Revenue + Payout Leaderboard</h2>
          <AffiliatesDashboard />
        </div>
      </div>
    </>
  );
}
