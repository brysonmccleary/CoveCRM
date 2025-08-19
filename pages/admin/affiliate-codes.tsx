import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import toast from "react-hot-toast";
import { getSession } from "next-auth/react";
import { useRouter } from "next/router";

interface Code {
  _id: string;
  referralCode: string;
  email: string;
  referredCount: number;
}

export default function AffiliateCodesPage() {
  const [codes, setCodes] = useState<Code[]>([]);
  const [newCode, setNewCode] = useState("");
  const [assignEmail, setAssignEmail] = useState("");
  const router = useRouter();

  useEffect(() => {
    fetchCodes();
  }, []);

  const fetchCodes = async () => {
    const res = await fetch("/api/admin/get-affiliate-codes");
    const data = await res.json();
    if (res.ok) setCodes(data.codes);
    else toast.error("Failed to load codes.");
  };

  const createCode = async () => {
    const res = await fetch("/api/admin/create-affiliate-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        referralCode: newCode.trim(),
        email: assignEmail.trim(),
      }),
    });

    if (res.ok) {
      toast.success("Referral code created!");
      setNewCode("");
      setAssignEmail("");
      fetchCodes();
    } else {
      const error = await res.json();
      toast.error(error.message || "Error creating code.");
    }
  };

  const deleteCode = async (id: string) => {
    const res = await fetch("/api/admin/delete-affiliate-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });

    if (res.ok) {
      toast.success("Code deleted.");
      fetchCodes();
    } else {
      toast.error("Error deleting code.");
    }
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-8">
        <h1 className="text-2xl font-bold">Affiliate Code Admin Panel</h1>

        {/* Create New Code */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded shadow space-y-4">
          <h2 className="text-lg font-semibold">Create New Referral Code</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block font-medium">Referral Code</label>
              <input
                type="text"
                className="input input-bordered w-full"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
              />
            </div>
            <div>
              <label className="block font-medium">Assign to Email</label>
              <input
                type="email"
                className="input input-bordered w-full"
                value={assignEmail}
                onChange={(e) => setAssignEmail(e.target.value)}
              />
            </div>
          </div>
          <button className="btn btn-primary" onClick={createCode}>
            Create Code
          </button>
        </div>

        {/* Existing Codes */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded shadow">
          <h2 className="text-lg font-semibold mb-4">Existing Codes</h2>
          {codes.length === 0 ? (
            <p>No referral codes yet.</p>
          ) : (
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Referral Code</th>
                  <th>Signups</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((code) => (
                  <tr key={code._id}>
                    <td>{code.email}</td>
                    <td>{code.referralCode}</td>
                    <td>{code.referredCount}</td>
                    <td>
                      <button
                        className="btn btn-sm btn-error"
                        onClick={() => deleteCode(code._id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
