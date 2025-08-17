// /components/Admin/AffiliatePanel.tsx
import { useState, useEffect } from "react";
import axios from "axios";
import toast from "react-hot-toast";

interface Affiliate {
  name: string;
  email: string;
  promoCode: string;
  totalRedemptions: number;
  totalRevenueGenerated: number;
  payoutDue: number;
  onboardingCompleted: boolean;
  connectedAccountStatus: string;
  approved: boolean;
}

export default function AffiliatePanel({ userEmail }: { userEmail: string }) {
  const [affiliate, setAffiliate] = useState<Affiliate | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: userEmail,
    company: "",
    agents: "",
    promoCode: "",
  });
  const [codeAvailable, setCodeAvailable] = useState<null | boolean>(null);

  useEffect(() => {
    if (userEmail) {
      axios.get(`/api/affiliates/me?email=${userEmail}`).then((res) => {
        if (res.data) setAffiliate(res.data);
      });
    }
  }, [userEmail]);

  const checkCode = async () => {
    if (!form.promoCode.trim()) return;
    try {
      const res = await axios.get(`/api/affiliates/check-code?code=${form.promoCode}`);
      setCodeAvailable(res.data.available);
    } catch {
      setCodeAvailable(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.name || !form.company || !form.agents || !form.promoCode) {
      return toast.error("Please complete all fields");
    }
    if (codeAvailable === false) {
      return toast.error("Promo code is already taken");
    }

    setIsSubmitting(true);
    try {
      const res = await axios.post("/api/affiliates/register", {
        ...form,
        email: userEmail,
      });

      const { stripeLink, affiliateData } = res.data;

      setAffiliate(affiliateData);
      toast.success("Application submitted — complete Stripe setup to activate.");

      window.location.href = stripeLink;
    } catch (err) {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const startOnboarding = async () => {
    setLoading(true);
    try {
      const res = await axios.post("/api/affiliates/onboard", { email: userEmail });
      window.location.href = res.data.url;
    } catch (err) {
      toast.error("Stripe onboarding failed");
    } finally {
      setLoading(false);
    }
  };

  if (!affiliate) {
    return (
      <div className="bg-gray-800 text-white p-6 rounded-lg mt-6 max-w-lg space-y-4">
        <h2 className="text-2xl font-bold">Become an Affiliate</h2>

        <input
          type="text"
          placeholder="Your Name"
          className="w-full p-2 rounded text-black"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          type="text"
          placeholder="Your Company"
          className="w-full p-2 rounded text-black"
          value={form.company}
          onChange={(e) => setForm({ ...form, company: e.target.value })}
        />
        <input
          type="number"
          placeholder="# of Agents"
          className="w-full p-2 rounded text-black"
          value={form.agents}
          onChange={(e) => setForm({ ...form, agents: e.target.value })}
        />
        <div className="flex items-center space-x-2">
          <input
            type="text"
            placeholder="Requested Promo Code"
            className="w-full p-2 rounded text-black"
            value={form.promoCode}
            onChange={(e) => {
              setForm({ ...form, promoCode: e.target.value.toUpperCase() });
              setCodeAvailable(null);
            }}
            onBlur={checkCode}
          />
          {codeAvailable === false && <span className="text-red-400 text-sm">Unavailable</span>}
          {codeAvailable === true && <span className="text-green-400 text-sm">Available</span>}
        </div>

        <button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
        >
          {isSubmitting ? "Submitting..." : "Apply + Connect Stripe"}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 p-6 rounded-lg mt-6 text-white space-y-4">
      <h2 className="text-2xl font-bold">Affiliate Dashboard</h2>
      <p><strong>Promo Code:</strong> {affiliate.promoCode}</p>
      <p><strong>Redemptions:</strong> {affiliate.totalRedemptions}</p>
      <p><strong>Revenue Generated:</strong> ${affiliate.totalRevenueGenerated.toFixed(2)}</p>
      <p><strong>Payout Due:</strong> ${affiliate.payoutDue.toFixed(2)}</p>
      <p><strong>Status:</strong> {affiliate.connectedAccountStatus || "Not Connected"}</p>

      {!affiliate.onboardingCompleted && (
        <button
          onClick={startOnboarding}
          disabled={loading}
          className="mt-4 bg-blue-500 px-4 py-2 rounded"
        >
          {loading ? "Redirecting..." : "Connect Stripe to Receive Payouts"}
        </button>
      )}
    </div>
  );
}
