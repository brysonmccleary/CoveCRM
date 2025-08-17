import { useEffect, useState } from "react";
import toast from "react-hot-toast";

interface AffiliateCode {
  _id: string;
  referralCode: string;
  email: string;
  createdAt: string;
}

export default function AffiliatePanel() {
  const [referralCode, setReferralCode] = useState("");
  const [email, setEmail] = useState("");
  const [codes, setCodes] = useState<AffiliateCode[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchCodes = async () => {
    try {
      const res = await fetch("/api/admin/get-affiliate-codes");
      if (!res.ok) throw new Error("Failed to load codes");
      const data = await res.json();
      setCodes(data.codes);
    } catch (err) {
      toast.error("Error fetching codes");
    }
  };

  useEffect(() => {
    fetchCodes();
  }, []);

  const handleSubmit = async () => {
    if (!referralCode || !email) return toast.error("Missing fields");
    setLoading(true);

    try {
      const res = await fetch("/api/admin/create-affiliate-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referralCode, email }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Error");
      }

      toast.success("Affiliate code created");
      setReferralCode("");
      setEmail("");
      fetchCodes();
    } catch (err: any) {
      toast.error(err.message || "Failed to create code");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded shadow space-y-6">
      <h2 className="text-xl font-bold">Affiliate Code Manager</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <input
          className="input input-bordered"
          placeholder="Referral Code"
          value={referralCode}
          onChange={(e) => setReferralCode(e.target.value)}
        />
        <input
          className="input input-bordered"
          placeholder="Affiliate Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <button
        onClick={handleSubmit}
        className="btn btn-primary"
        disabled={loading}
      >
        {loading ? "Saving..." : "Create Code"}
      </button>

      <div className="pt-6">
        <h3 className="font-semibold mb-2">All Affiliate Codes</h3>
        <div className="space-y-2 max-h-64 overflow-y-auto border p-3 rounded bg-gray-100 dark:bg-gray-900">
          {codes.map((code) => (
            <div key={code._id} className="text-sm border-b pb-2">
              <div><strong>Code:</strong> {code.referralCode}</div>
              <div><strong>Email:</strong> {code.email}</div>
              <div className="text-xs text-gray-500">Created: {new Date(code.createdAt).toLocaleString()}</div>
            </div>
          ))}
          {codes.length === 0 && <p>No codes yet.</p>}
        </div>
      </div>
    </div>
  );
}
