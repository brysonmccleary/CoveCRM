import React, { useState } from "react";

interface MessageStep {
  text: string;
  day: string; // "immediately" or "Day X"
}

interface Drip {
  id: string;
  name: string;
  type: "sms" | "email";
  messages: string[];
}

const prebuiltDrips: Drip[] = [
  {
    id: "mortgage_protection",
    name: "Mortgage Protection Drip",
    type: "sms",
    messages: [
      "Hey there {{ contact.first_name }}! This is {{ agent.name }}. I was assigned to go over your mortgage protection options. Let me know when you'd like me to give you a call, or feel free to book your own appointment here: (insert calendar link).",
      "Hey {{ contact.first_name }}, did you receive my text the other day about the mortgage protection? — {{ agent.name }}",
      "Hey {{ contact.first_name }}, it's {{ agent.name }}. I wanted to go over mortgage protection with you. It only takes a few minutes. Do you have time today or tomorrow? You can also just book your own appointment here (recommended): (insert calendar link).",
      "Hi {{ contact.first_name }}, it's {{ agent.name }}. You must be pretty busy! If you're still looking to review some mortgage protection options, let me know — or you can book your own time here: (insert calendar link).",
      "Hi {{ contact.first_name | default: \"there\" }}, it's {{ agent.name }}. Are you still considering mortgage protection? (insert calendar link)",
      "Hi {{ contact.first_name }}, it's {{ agent.name }}. If you're still looking into mortgage protection, let me know. It only takes 5–10 minutes to discuss. Here's my calendar link: (insert calendar link).",
      "Hi {{ contact.first_name }}, this is {{ agent.name }}. A couple of weeks ago you requested information on mortgage protection. It only takes about 10 minutes to see if you'd be eligible. When would be the best time for me to give you a ring?",
      "Hi {{ contact.first_name }}, I still haven't been able to get in touch with you about the mortgage protection you requested. If you'd like to schedule a specific time for us to chat, feel free to choose a time that works for you here: (insert calendar link).",
      "Hi {{ contact.first_name }}, if you still haven't found a mortgage protection plan, let me know. — {{ agent.name }}",
      "Hey {{ contact.first_name }}, did you give up on mortgage protection? — {{ agent.name }}",
      "Hi {{ contact.first_name }}, hope all is well! You sent in a request to go over some mortgage protection options. Do you have a few minutes today to chat on the phone? Best, {{ agent.name }}",
      "Hi {{ contact.first_name }}, I received your info when you filled out the form about mortgage protection. Are you still looking for more info? I know you're busy, but if you could just update me on where you're at in the process, that would be great. Best, {{ agent.name }}"
    ]
  },
  {
    id: "client_retention_email",
    name: "Client Retention Email Drip",
    type: "email",
    messages: [
      "Dear {{ contact.first_name | default:\"there\" }}, I sincerely appreciate your trust in allowing me to assist with your insurance needs. It is an honor to serve as your dedicated agent, and I am fully committed to providing service that is personalized and insightful.",
      "Hi {{ contact.first_name | default:\"there\" }}, I hope you’ve been doing well! I wanted to check in and see how everything is going with your policy. If you have any questions or want to review your coverage, please reach out anytime. I’m here to support you.",
      "Dear {{ contact.first_name | default:\"there\" }}, Life insurance can help you leave a legacy and build wealth for future generations. If you'd like to discuss maximizing your policy's impact, I’d love to help.",
      "Hi {{ contact.first_name }}, Did you know some policies allow you to access funds during emergencies or big life changes? If you'd like to explore these options, let’s set up a time to talk.",
      "Dear {{ contact.first_name }}, Have you thought about using your life insurance policy to enhance your retirement income? Some policies build cash value that can support your retirement plans. Let’s discuss if you’re interested.",
      "Hi {{ contact.first_name }}, Life changes like new homes or income changes often mean it’s time to update your insurance. Let’s make sure your policy still fits your current goals.",
      "Dear {{ contact.first_name }}, Annuities can provide guaranteed lifetime income, tax-deferred growth, and legacy planning. If you'd like to learn more about using annuities as part of your retirement strategy, I’d be happy to help."
    ]
  },
  {
    id: "quoted_unsold",
    name: "Quoted - Unsold SMS Drip",
    type: "sms",
    messages: [
      "Hi {{ contact.first_name | default:\"there\" }}, I just wanted to say thank you for taking the time to go over your insurance options with me. We're almost there — just one small step left to secure your coverage. I'm here to help whenever you're ready. Best, {{ agent.name }}",
      "Hi {{ contact.first_name }}, it’s {{ agent.name }}. I hope you’ve had some time to think about the quote we discussed. I’d love to help you get everything in place sooner rather than later, so you can have peace of mind knowing you’re covered. Let me know if you have any questions or if you’re ready to move forward!",
      "Hi {{ contact.first_name }}, just checking in! I want to make sure you don’t miss out on the coverage we discussed. If you have any concerns or need more info before moving forward, I’m here to help. Let’s make sure we get everything sorted for you. Best, {{ agent.name }}",
      "Hi {{ contact.first_name }}, I understand life gets busy, but I want to make sure you’re fully covered before any unexpected situations arise. This is a great opportunity to lock in your rate, and I’d hate for you to miss out. Let me know if you’re ready, and we can get it done quickly!",
      "Hi {{ contact.first_name }}, I haven’t heard back from you, so I just wanted to check in one last time. I’m here to make this as easy as possible for you. If you’re still interested, let me know, and we can finalize everything quickly. If now isn’t the right time, just let me know — no pressure!",
      "Hi {{ contact.first_name }}, I completely understand if the timing hasn’t been right. If you’re still considering the coverage we discussed, I’m happy to help you get it all set up whenever you’re ready. Just shoot me a quick message, and we can pick things up from where we left off.",
      "Hi {{ contact.first_name }}, just checking in to see if you'd like to continue where we left off to see if you're eligible for the coverage options we discussed. Let me know! — {{ agent.name }}"
    ]
  },
  {
    id: "client_retention_text",
    name: "Client Retention Text Drip",
    type: "sms",
    messages: [
      "Hi {{ contact.first_name | default:\"there\" }}, it’s {{ agent.name }}. I just wanted to say thank you again for trusting me with your policy. I’m always here if you have questions or need help with anything. 😊",
      "Hi {{ contact.first_name }}, I hope you’re enjoying the peace of mind knowing your coverage is in place! If you ever have any questions or changes, just let me know. I’m here to help!",
      "Hi {{ contact.first_name }}, I wanted to ask — do you know anyone else who might benefit from the same coverage or advice we went over together? Referrals mean a lot to me, and I’d be happy to help your friends or family too!",
      "Hi {{ contact.first_name }}, just checking in again to see how everything’s going with your policy. If you or anyone you know needs help with coverage, I’m always here. Thank you again for being such a valued client!"
    ]
  }
];

const userHasAIUpgrade = true;

const sendAIResponse = (leadType: string, incomingMessage: string) => {
  if (userHasAIUpgrade) {
    if (leadType === "mortgage_protection") {
      return `Thanks for your reply! I'm here to help with your mortgage protection questions. When is a good time to connect?`;
    }
    if (leadType === "client_retention_email" || leadType === "client_retention_text") {
      return `Thank you for reaching out! I'm always here if you'd like to discuss your coverage or explore new options.`;
    }
    if (leadType === "quoted_unsold") {
      return `Thanks for your reply! Let me know if you're ready to secure your coverage or if you'd like to review any details together.`;
    }
    return `Thanks for your message! How can I assist you further?`;
  }
  return null;
};

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
              <li key={idx}>{msg}</li>
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

