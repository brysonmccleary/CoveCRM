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
      { text: "Hey there {{ contact.first_name }}! This is {{ agent.name }}. I was assigned to go over your mortgage protection options. Let me know when to give you a call or feel free to book your own appointment with me. (insert calendar link)", day: "Day 1" },
      { text: "Hey {{ contact.first_name }}, it's {{ agent.name }}. Did you get my text the other day about the mortgage protection? - {{ agent.name }}", day: "Day 4" },
      { text: "Hey {{ contact.first_name }}, it's {{ agent.name }}. I wanted to go over mortgage protection with you. It only takes a few minutes. Do you have time today or tomorrow? You can also just book your own appointment instead, which I recommend. (insert calendar link)", day: "Day 7" },
      { text: "Hi {{ contact.first_name }}, it's {{ agent.name }}. You must be pretty busy! If you're still looking to go over some mortgage protection options, let me know, or you can just book your own time. (insert calendar link)", day: "Day 10" },
      { text: "Hi {{ contact.first_name | default:\"there\" }}, it's {{ agent.name }}. Are you still considering mortgage protection? (insert calendar link)", day: "Day 13" },
      { text: "Hi {{ contact.first_name }}, it's {{ agent.name }}. If you're still looking into mortgage protection, let me know. It only takes 5–10 minutes to discuss. Here's my calendar link. (insert calendar link)", day: "Day 16" },
      { text: "Hi {{ contact.first_name }}, this is {{ agent.name }}. A couple weeks ago you requested information on mortgage protection. It only takes about 10 minutes to see if you'd be eligible. When would be the best time for me to give you a ring?", day: "Day 19" },
      { text: "Hi {{ contact.first_name }}, still haven't been able to get in touch with you about the mortgage protection you requested. If you'd like to schedule a specific time for us to chat, feel free to choose a date that works for you here: (insert calendar link)", day: "Day 24" },
      { text: "Hi {{ contact.first_name }}, if you still haven't found a mortgage protection plan, let me know. - {{ agent.name }}", day: "Day 29" },
      { text: "Hey {{ contact.first_name }}, did you give up on mortgage protection? - {{ agent.name }}", day: "Day 33" },
      { text: "Hi {{ contact.first_name }}, hope all is well! You sent in a request to go over some mortgage protection options. Do you have a few minutes today to chat on the phone? Best, {{ agent.name }}", day: "Day 37" },
      { text: "Hi {{ contact.first_name }}, I received your info when you filled out the form about mortgage protection. Are you still looking for more info? I get you're busy, but if you could just update me on where you're at in this process. Best, {{ agent.name }}", day: "Day 41" }
    ]
  },
  {
    id: "veteran_leads",
    name: "Veteran Leads Drip",
    type: "sms",
    messages: [
      { text: "Hey {{ contact.first_name }}, this is {{ agent.name }} with the life insurance for veteran programs. We got your request for information. When's a good time to give you a call?", day: "Day 1" },
      { text: "Hey {{ contact.first_name }}, it's {{ agent.name }}. Just checking if you saw my message about your veteran benefits and options. - {{ agent.name }}", day: "Day 4" },
      { text: "Hey {{ contact.first_name }}, it's {{ agent.name }}. I'd like to go over your veteran life insurance options with you. It only takes a few minutes. (insert calendar link)", day: "Day 7" },
      { text: "Hi {{ contact.first_name }}, it's {{ agent.name }}. Are you still interested in the veteran programs? You can also book your own time here: (insert calendar link)", day: "Day 10" },
      { text: "Hi {{ contact.first_name | default:\"there\" }}, it's {{ agent.name }}. Are you still considering your veteran life insurance options? (insert calendar link)", day: "Day 13" },
      { text: "Hi {{ contact.first_name }}, it's {{ agent.name }}. If you're still looking into veteran options, let me know. It only takes 5–10 minutes. (insert calendar link)", day: "Day 16" },
      { text: "Hi {{ contact.first_name }}, this is {{ agent.name }}. A couple weeks ago you requested info on veteran programs. When would be a good time to connect?", day: "Day 19" },
      { text: "Hi {{ contact.first_name }}, still haven't been able to connect about your veteran benefits. You can book a time here: (insert calendar link)", day: "Day 24" },
      { text: "Hi {{ contact.first_name }}, if you still haven't finalized your veteran life insurance, let me know. - {{ agent.name }}", day: "Day 29" },
      { text: "Hey {{ contact.first_name }}, did you give up on the veteran benefits? - {{ agent.name }}", day: "Day 33" },
      { text: "Hi {{ contact.first_name }}, hope all is well! Do you have a few minutes today to chat about your veteran options? Best, {{ agent.name }}", day: "Day 37" },
      { text: "Hi {{ contact.first_name }}, I received your info from your veteran coverage request. Are you still looking? Let me know where you're at. Best, {{ agent.name }}", day: "Day 41" }
    ]
  },
  {
    id: "iul_leads",
    name: "IUL Leads Drip",
    type: "sms",
    messages: [
      { text: "Hey {{ contact.first_name }}, {{ agent.name }} here with the info you requested on retirement protection programs (IUL). When can we go over it together?", day: "Day 1" },
      { text: "Hey {{ contact.first_name }}, it's {{ agent.name }}. Just checking if you saw my text about the retirement options. - {{ agent.name }}", day: "Day 4" },
      { text: "Hey {{ contact.first_name }}, it's {{ agent.name }}. I'd like to go over retirement and cash growth options with you. It only takes a few minutes. (insert calendar link)", day: "Day 7" },
      { text: "Hi {{ contact.first_name }}, it's {{ agent.name }}. Are you still interested in the IUL retirement options? You can book your own time here: (insert calendar link)", day: "Day 10" },
      { text: "Hi {{ contact.first_name | default:\"there\" }}, it's {{ agent.name }}. Are you still considering retirement protection options? (insert calendar link)", day: "Day 13" },
      { text: "Hi {{ contact.first_name }}, it's {{ agent.name }}. If you'd still like to discuss IUL or retirement options, let me know. (insert calendar link)", day: "Day 16" },
      { text: "Hi {{ contact.first_name }}, this is {{ agent.name }}. A few weeks ago you requested info on retirement protection. When would be a good time to connect?", day: "Day 19" },
      { text: "Hi {{ contact.first_name }}, still haven't been able to connect about your retirement protection. You can book a time here: (insert calendar link)", day: "Day 24" },
      { text: "Hi {{ contact.first_name }}, if you still haven't secured a retirement plan, let me know. - {{ agent.name }}", day: "Day 29" },
      { text: "Hey {{ contact.first_name }}, did you give up on the retirement plan? - {{ agent.name }}", day: "Day 33" },
      { text: "Hi {{ contact.first_name }}, hope all is well! Do you have a few minutes today to chat about your retirement options? Best, {{ agent.name }}", day: "Day 37" },
      { text: "Hi {{ contact.first_name }}, I received your info from your IUL request. Are you still interested? Let me know where you're at. Best, {{ agent.name }}", day: "Day 41" }
    ]
  },
  {
    id: "final_expense_leads",
    name: "Final Expense Leads Drip",
    type: "sms",
    messages: [
      { text: "Hey {{ contact.first_name }}, {{ agent.name }} here regarding the final expense program you requested info on. When would be a good time to talk?", day: "Day 1" },
      { text: "Hey {{ contact.first_name }}, it's {{ agent.name }}. Did you see my text about the final expense options? - {{ agent.name }}", day: "Day 4" },
      { text: "Hey {{ contact.first_name }}, it's {{ agent.name }}. I'd like to go over the final expense options with you. It only takes a few minutes. (insert calendar link)", day: "Day 7" },
      { text: "Hi {{ contact.first_name }}, it's {{ agent.name }}. Are you still interested in the final expense program? You can book a time here: (insert calendar link)", day: "Day 10" },
      { text: "Hi {{ contact.first_name | default:\"there\" }}, it's {{ agent.name }}. Are you still considering final expense coverage? (insert calendar link)", day: "Day 13" },
      { text: "Hi {{ contact.first_name }}, it's {{ agent.name }}. Just checking in again about your final expense options. (insert calendar link)", day: "Day 16" },
      { text: "Hi {{ contact.first_name }}, this is {{ agent.name }}. A few weeks ago you requested info on final expense coverage. When would be a good time to connect?", day: "Day 19" },
      { text: "Hi {{ contact.first_name }}, still haven't been able to connect about your final expense plan. You can book a time here: (insert calendar link)", day: "Day 24" },
      { text: "Hi {{ contact.first_name }}, if you still haven't secured a final expense plan, let me know. - {{ agent.name }}", day: "Day 29" },
      { text: "Hey {{ contact.first_name }}, did you give up on the final expense plan? - {{ agent.name }}", day: "Day 33" },
      { text: "Hi {{ contact.first_name }}, hope all is well! Do you have a few minutes today to chat about your final expense options? Best, {{ agent.name }}", day: "Day 37" },
      { text: "Hi {{ contact.first_name }}, I received your info from your final expense request. Are you still interested? Let me know where you're at. Best, {{ agent.name }}", day: "Day 41" }
    ]
  },
  {
    id: "sold_followup",
    name: "Sold Lead Follow-up Drip",
    type: "sms",
    messages: [
      { text: "Just checking in to make sure you got everything you needed after signing up. Let me know if any questions come up!", day: "Day 3" },
      { text: "Checking in to see how everything is going with your policy! Let me know if you need anything or have any questions.", day: "Month 1" },
      { text: "Hope your policy has been going well! I’m here if you need anything or know someone else looking for coverage. Referrals are always appreciated!", day: "Month 3" },
      { text: "Just wanted to say hi and see if everything is still good with your policy. Let me know if you'd like to review anything.", day: "Month 5" },
      { text: "Checking in again! Remember, if friends or family ever need help, feel free to send them my way — I'd love to help.", day: "Month 7" },
      { text: "Hi again! Just a quick check-in to make sure your policy still fits your needs. I'm always happy to help.", day: "Month 9" },
      { text: "Thank you again for trusting me with your policy. Always here for any questions or updates!", day: "Month 12" }
    ]
  },
  {
    id: "client_retention_text",
    name: "Client Retention Text Drip",
    type: "sms",
    messages: [
      { text: "Hi {{ contact.first_name | default:\"there\" }}, it’s {{ agent.name }}. Thank you again for trusting me with your policy!", day: "Day 1" },
      { text: "Hi {{ contact.first_name }}, I hope you're enjoying peace of mind knowing your coverage is in place! I'm always here for questions.", day: "Day 30" },
      { text: "Hi {{ contact.first_name }}, just checking in — if anything changes with your family or needs, let me know. We can review anytime.", day: "Day 60" },
      { text: "Hi {{ contact.first_name }}, do you know anyone who might benefit from coverage? I always appreciate referrals and will take great care of them!", day: "Day 90" },
      { text: "Hi {{ contact.first_name }}, it's {{ agent.name }}. A quick reminder I'm always here if you need to adjust or review your policy.", day: "Day 120" },
      { text: "Hi {{ contact.first_name }}, hope you’re doing well! A quick check-in to ensure your policy still meets your goals.", day: "Day 150" },
      { text: "Hi {{ contact.first_name }}, just a reminder: as life changes, your insurance needs might too. Happy to review anytime.", day: "Day 180" },
      { text: "Hi {{ contact.first_name }}, hope you're having a great year so far! I'm here if you have questions or want to add any extra coverage.", day: "Day 210" },
      { text: "Hi {{ contact.first_name }}, it’s {{ agent.name }}. Checking in — if friends or family need help, I'd be honored to assist.", day: "Day 240" },
      { text: "Hi {{ contact.first_name }}, just another friendly check-in. Let me know if you'd like to explore additional options or updates.", day: "Day 270" },
      { text: "Hi {{ contact.first_name }}, hope all is well! Quick reminder: policy reviews are always free and can bring peace of mind.", day: "Day 300" },
      { text: "Hi {{ contact.first_name }}, we’re approaching a year together! Thank you for being a valued client. I'm here for any needs.", day: "Day 330" },
      { text: "Hi {{ contact.first_name }}, celebrating one year! Thank you for trusting me. Please reach out anytime, and referrals are always appreciated!", day: "Day 365" }
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
      { text: "Dear {{ contact.first_name }}, Annuities can provide guaranteed lifetime income and tax-deferred growth.", day: "Day 150" },
      { text: "Hi {{ contact.first_name }}, Thank you again for choosing me as your advisor. If you know anyone who could use my help, feel free to refer them. I'd be honored to assist.", day: "Day 180" }
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
      { text: "Hi {{ contact.first_name }}, no rush if now isn’t right. I’m here to help whenever you're ready.", day: "Day 14" },
      { text: "Hi {{ contact.first_name }}, even if now isn’t the right time, keep me in mind for the future or feel free to share my info with a friend who might benefit.", day: "Day 20" }
    ]
  },
  {
    id: "birthday_holiday",
    name: "Birthday & Holiday Drip",
    type: "sms",
    messages: [
      { text: "🎉 Happy Birthday {{ contact.first_name }}! Hope you have an amazing day. Thank you for being such a valued client!", day: "Birthday" },
      { text: "🎄 Happy Holidays, {{ contact.first_name }}! Wishing you and your loved ones a wonderful season and new year ahead.", day: "December 15" },
      { text: "🦃 Happy Thanksgiving, {{ contact.first_name }}! Grateful to have you as a client. Enjoy your time with family!", day: "November 20" },
      { text: "🇺🇸 Happy 4th of July, {{ contact.first_name }}! Hope you're enjoying some fun and relaxation today.", day: "July 3" }
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
    const newCampaign = { name: campaignName, steps: messageSteps };
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
          {[...Array(365)].map((_, i) => (
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
