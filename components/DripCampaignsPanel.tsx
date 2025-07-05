import React, { useState } from "react";

interface MessageStep {
  text: string;
  day: string; // "immediately" or "Day X"
}

interface Drip {
  id: string;
  name: string;
  type: "sms" | "email";
  messages: { text: string; day: string }[];
}

const prebuiltDrips: Drip[] = [
  {
    id: "mortgage_protection",
    name: "Mortgage Protection Drip",
    type: "sms",
    messages: [
      { text: "Hey there {{ contact.first_name }}! This is {{ agent.name }}. I was assigned to go over your mortgage protection options. Let me know when you'd like me to give you a call, or feel free to book your own appointment here: (insert calendar link).", day: "Day 1" },
      { text: "Hey {{ contact.first_name }}, did you receive my text the other day about the mortgage protection? — {{ agent.name }}", day: "Day 3" },
      { text: "Hey {{ contact.first_name }}, it's {{ agent.name }}. I wanted to go over mortgage protection with you. It only takes a few minutes. Do you have time today or tomorrow? You can also just book your own appointment here: (insert calendar link).", day: "Day 5" },
      { text: "Hi {{ contact.first_name }}, it's {{ agent.name }}. You must be pretty busy! If you're still looking to review some mortgage protection options, let me know — or you can book your own time here: (insert calendar link).", day: "Day 7" }
    ]
  },
  {
    id: "veteran_leads",
    name: "Veteran Leads Drip",
    type: "sms",
    messages: [
      { text: "Hey {{ contact.first_name }}, this is {{ agent.name }} with the life insurance for veteran programs. We got your request for information, when’s a good time to give you a call?", day: "Day 1" }
    ]
  },
  {
    id: "iul_leads",
    name: "IUL Leads Drip",
    type: "sms",
    messages: [
      { text: "Hey {{ contact.first_name }}, {{ agent.name }} here with the info you requested on the retirement protection programs. When can we go over it together?", day: "Day 1" }
    ]
  },
  {
    id: "final_expense_leads",
    name: "Final Expense Leads Drip",
    type: "sms",
    messages: [
      { text: "Hey {{ contact.first_name }}, {{ agent.name }} here regarding the final expense program you requested info on. When would be a good time to talk?", day: "Day 1" }
    ]
  },
  {
    id: "sold_followup",
    name: "Sold Lead Follow-up Drip",
    type: "sms",
    messages: [
      { text: "Just checking in to make sure you got everything you needed after signing up. Let me know if any questions come up!", day: "Day 3" },
      { text: "Checking in to see how everything is going with your policy! Let me know if you need anything or have any questions.", day: "Month 1" },
      { text: "Checking in to see how everything is going with your policy! Let me know if you need anything or have any questions.", day: "Month 3" },
      { text: "Checking in to see how everything is going with your policy! Let me know if you need anything or have any questions.", day: "Month 5" },
      { text: "Checking in to see how everything is going with your policy! Let me know if you need anything or have any questions.", day: "Month 7" },
      { text: "Checking in to see how everything is going with your policy! Let me know if you need anything or have any questions.", day: "Month 9" },
      { text: "Checking in to see how everything is going with your policy! Let me know if you need anything or have any questions.", day: "Month 12" }
    ]
  },
  {
    id: "client_retention_email",
    name: "Client Retention Email Drip",
    type: "email",
    messages: [
      { text: "Dear {{ contact.first_name | default:\"there\" }}, I sincerely appreciate your trust in allowing me to assist with your insurance needs.", day: "Day 1" },
      { text: "Hi {{ contact.first_name | default:\"there\" }}, I hope you’ve been doing well! Let me know if you have any questions about your policy.", day: "Day 15" },
      { text: "Dear {{ contact.first_name | default:\"there\" }}, Life insurance can help you leave a legacy and build wealth for future generations.", day: "Day 30" },
      { text: "Hi {{ contact.first_name }}, Did you know some policies allow you to access funds during emergencies or big life changes?", day: "Day 60" },
      { text: "Dear {{ contact.first_name }}, Have you thought about using your life insurance policy to enhance your retirement income?", day: "Day 90" },
      { text: "Hi {{ contact.first_name }}, Life changes often mean it’s time to update your insurance. Let’s make sure your policy still fits.", day: "Day 120" },
      { text: "Dear {{ contact.first_name }}, Annuities can provide guaranteed lifetime income and tax-deferred growth.", day: "Day 150" }
    ]
  },
  {
    id: "quoted_unsold",
    name: "Quoted - Unsold SMS Drip",
    type: "sms",
    messages: [
      { text: "Hi {{ contact.first_name | default:\"there\" }}, thank you for going over your options with me. We're almost there — just one step left!", day: "Day 1" },
      { text: "Hi {{ contact.first_name }}, it’s {{ agent.name }}. Have you had time to think about the quote? Let me know if you're ready to finalize.", day: "Day 3" },
      { text: "Hi {{ contact.first_name }}, just checking in! I don’t want you to miss out on the coverage we discussed.", day: "Day 5" },
      { text: "Hi {{ contact.first_name }}, I understand life gets busy. I want to make sure you’re covered before anything happens.", day: "Day 7" },
      { text: "Hi {{ contact.first_name }}, I haven’t heard back. Just checking in one last time — let me know if you'd like to proceed.", day: "Day 10" },
      { text: "Hi {{ contact.first_name }}, no rush if now isn’t right. I’m here to help whenever you're ready.", day: "Day 14" }
    ]
  },
  {
    id: "client_retention_text",
    name: "Client Retention Text Drip",
    type: "sms",
    messages: [
      { text: "Hi {{ contact.first_name | default:\"there\" }}, it’s {{ agent.name }}. Thank you again for trusting me with your policy!", day: "Day 1" },
      { text: "Hi {{ contact.first_name }}, I hope you're enjoying peace of mind knowing your coverage is in place! I'm here for any questions.", day: "Day 30" },
      { text: "Hi {{ contact.first_name }}, do you know anyone who might benefit from coverage? Referrals mean a lot to me!", day: "Day 60" },
      { text: "Hi {{ contact.first_name }}, just checking in again to see how things are going. I’m always here if you need anything!", day: "Day 90" }
    ]
  }
];

export default function DripCampaignsPanel() {
  const [campaignName, setCampaignName] = useState("");
  const [messageSteps, setMessageSteps] = useState<MessageStep[]>([]);
  const [currentText, setCurrentText] = useState("");
  const [currentDay, setCurrentDay] = useState("immediately");
  const [savedCampaigns, setSavedCampaigns] = useState<any[]>([]);

  const addStep = () => {
    if (!currentText) return;
    setMessageSteps([...messageSteps, { text: currentText, day: currentDay }]);
    setCurrentText("");
    setCurrentDay("immediately");
  };

  const saveCampaign = () => {
    if (!campaignName || messageSteps.length === 0) {
      alert("Please enter a campaign name and add at least one message.");
      return;
    }
    const newCampaign = {
      name: campaignName,
      steps: messageSteps,
    };
    setSavedCampaigns([...savedCampaigns, newCampaign]);
    setCampaignName("");
    setMessageSteps([]);
    alert("Drip campaign saved!");
  };

  return (
    <div className="border border-black dark:border-white p-4 mt-4 rounded space-y-6">
      <h2 className="text-xl font-bold">Create Drip Campaign</h2>

      <input
        value={campaignName}
        onChange={(e) => setCampaignName(e.target.value)}
        placeholder="Campaign Name"
        className="border border-black dark:border-white p-2 w-full rounded"
      />

      <div className="flex flex-col md:flex-row space-y-2 md:space-y-0 md:space-x-2">
        <input
          value={currentText}
          onChange={(e) => setCurrentText(e.target.value)}
          placeholder="Message text"
          className="border border-black dark:border-white p-2 flex-1 rounded"
        />
        <select
          value={currentDay}
          onChange={(e) => setCurrentDay(e.target.value)}
          className="border border-black dark:border-white p-2 rounded"
        >
          <option value="immediately">Immediately</option>
          {[...Array(30)].map((_, i) => (
            <option key={i + 1} value={`Day ${i + 1}`}>
              Day {i + 1}
            </option>
          ))}
        </select>
        <button
          onClick={addStep}
          className="border border-black dark:border-white px-4 rounded"
        >
          Add
        </button>
      </div>

      {messageSteps.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold">Messages in Campaign:</h3>
          {messageSteps.map((step, idx) => (
            <div key={idx} className="border border-black dark:border-white p-2 rounded">
              <p><strong>When:</strong> {step.day}</p>
              <p><strong>Message:</strong> {step.text}</p>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={saveCampaign}
        className="border border-black dark:border-white px-4 py-2 rounded"
      >
        Save Campaign
      </button>

      <h2 className="text-xl font-bold mt-8">Prebuilt Drip Campaigns</h2>
      {prebuiltDrips.map((drip) => (
        <div key={drip.id} className="border border-black dark:border-white p-3 rounded mb-4">
          <h3 className="font-semibold">{drip.name}</h3>
          <p className="text-xs italic">Type: {drip.type.toUpperCase()}</p>
          <ul className="list-disc pl-5 text-sm">
            {drip.messages.map((msg, idx) => (
              <li key={idx}>
                <strong>{msg.day}:</strong> {msg.text}
              </li>
            ))}
          </ul>
          <button
            onClick={() => alert(`Assign ${drip.name} (hook up logic here)`)}
            className="mt-2 border border-black dark:border-white px-3 py-1 rounded"
          >
            Assign to Folder/Leads
          </button>
        </div>
      ))}
    </div>
  );
}

