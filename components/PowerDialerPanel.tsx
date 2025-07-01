import { useState } from "react";

const PowerDialerPanel = () => {
  const [currentLead, setCurrentLead] = useState<any>(null);
  const [callStatus, setCallStatus] = useState("");

  const leads = [
    { name: "John Doe", phone: "555-123-4567" },
    { name: "Jane Smith", phone: "555-987-6543" },
  ];

  const startCall = (lead: any) => {
    setCurrentLead(lead);
    setCallStatus("Calling...");
    setTimeout(() => {
      setCallStatus("Connected");
    }, 2000);
  };

  const endCall = () => {
    setCallStatus("Call Ended");
    setTimeout(() => {
      setCurrentLead(null);
      setCallStatus("");
    }, 1500);
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Power Dialer</h2>
      {currentLead ? (
        <div className="border p-4 rounded bg-gray-100">
          <p><strong>Current Lead:</strong> {currentLead.name}</p>
          <p><strong>Phone:</strong> {currentLead.phone}</p>
          <p><strong>Status:</strong> {callStatus}</p>
          <button
            className="mt-2 bg-red-600 text-white px-4 py-2 rounded"
            onClick={endCall}
          >
            End Call
          </button>
        </div>
      ) : (
        <ul>
          {leads.map((lead, index) => (
            <li key={index} className="mb-2 flex justify-between items-center border p-2 rounded">
              <div>
                <p><strong>{lead.name}</strong></p>
                <p className="text-sm text-gray-600">{lead.phone}</p>
              </div>
              <button
                className="bg-blue-600 text-white px-3 py-1 rounded"
                onClick={() => startCall(lead)}
              >
                Start Call
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default PowerDialerPanel;

