import { useEffect, useState } from "react";
import axios from "axios";
import DashboardLayout from "@/components/DashboardLayout";

interface AdminNumber {
  userEmail: string;
  phoneNumber: string;
  status: string;
  nextBillingDate: string | null;
  usage: {
    callsMade: number;
    callsReceived: number;
    textsSent: number;
    textsReceived: number;
    cost: number;
  };
}

export default function AdminNumbersPage() {
  const [data, setData] = useState<AdminNumber[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get("/api/admin/numbers").then((res) => {
      setData(res.data.numbers);
      setLoading(false);
    });
  }, []);

  return (
    <DashboardLayout>
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">📞 Active Numbers</h1>

        {loading ? (
          <p>Loading numbers...</p>
        ) : data.length === 0 ? (
          <div className="text-gray-500 mt-6">
            No numbers found. Users may not have purchased any phone numbers
            yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border border-gray-300">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 text-left">User</th>
                  <th className="p-2 text-left">Phone</th>
                  <th className="p-2 text-left">Status</th>
                  <th className="p-2 text-left">Next Billing</th>
                  <th className="p-2 text-left">Usage</th>
                </tr>
              </thead>
              <tbody>
                {data.map((num, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2">{num.userEmail}</td>
                    <td className="p-2">{num.phoneNumber}</td>
                    <td className="p-2 capitalize">{num.status}</td>
                    <td className="p-2">
                      {num.nextBillingDate
                        ? new Date(num.nextBillingDate).toLocaleDateString()
                        : "-"}
                    </td>
                    <td className="p-2 text-sm">
                      Calls: {num.usage.callsMade}/{num.usage.callsReceived}{" "}
                      <br />
                      Texts: {num.usage.textsSent}/{num.usage.textsReceived}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
