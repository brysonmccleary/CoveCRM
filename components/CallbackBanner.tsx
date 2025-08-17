import { useEffect, useState } from "react";
import axios from "axios";
import { useRouter } from "next/router";

interface CallbackLead {
  _id: string;
  "First Name"?: string;
  "Last Name"?: string;
  Phone?: string;
}

export default function CallbackBanner() {
  const [lead, setLead] = useState<CallbackLead | null>(null);
  const router = useRouter();

  useEffect(() => {
    const fetchCallbackLead = async () => {
      try {
        const res = await axios.get("/api/leads/callback-lead");
        const found = res.data?.lead;
        if (found?._id) {
          setLead(found);
        } else {
          setLead(null); // clear if no lead
        }
      } catch (err) {
        console.error("❌ Failed to fetch callback lead", err);
        setLead(null);
      }
    };

    fetchCallbackLead();
    const interval = setInterval(fetchCallbackLead, 5000); // Poll every 5s
    return () => clearInterval(interval);
  }, []);

  const handleAnswer = async () => {
    if (!lead?._id) return;
    try {
      await axios.post("/api/leads/mark-callback-handled", { leadId: lead._id });
      router.push(`/dial-session?leadId=${lead._id}`);
    } catch (err) {
      console.error("❌ Failed to mark callback as handled", err);
    }
  };

  if (!lead) return null;

  return (
    <div className="w-full bg-yellow-400 text-black p-3 text-center font-semibold shadow-md z-50 fixed top-0 left-0 flex items-center justify-center">
      <span>
        📞 Incoming Call From{" "}
        <strong>
          {lead["First Name"] || "Unknown"} {lead["Last Name"] || ""} — {lead.Phone || "No Number"}
        </strong>
      </span>
      <button
        onClick={handleAnswer}
        className="ml-4 px-4 py-1 bg-black text-white rounded hover:bg-gray-800 transition"
      >
        Answer
      </button>
    </div>
  );
}
