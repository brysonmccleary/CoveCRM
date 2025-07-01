import { useEffect, useState } from "react";

interface Lead {
  _id?: string;
  name?: string;
  email?: string;
  phone?: string;
  [key: string]: any;
}

export default function LeadsPanel({ userId }: { userId: string }) {
  const [leads, setLeads] = useState<Lead[]>([]);

  const fetchLeads = async () => {
    const res = await fetch(`/api/leads?ownerId=${userId}`);
    const data = await res.json();
    setLeads(data);
  };

  useEffect(() => {
    if (userId) {
      fetchLeads();
    }
  }, [userId]);

  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded shadow">
      <h2 className="text-xl font-bold mb-4">Your Leads</h2>
      <button
        onClick={fetchLeads}
        className="mb-4 bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
      >
        Refresh Leads
      </button>
      {leads.length === 0 ? (
        <p>No leads found.</p>
      ) : (
        <ul className="space-y-2">
          {leads.map((lead, idx) => (
            <li key={idx} className="border p-2 rounded">
              <strong>{lead.name}</strong> — {lead.email} — {lead.phone}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

