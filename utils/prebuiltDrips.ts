// /utils/prebuiltDrips.ts

export interface Drip {
  id: string;
  name: string;
  type: "sms" | "email";
  messages: { text: string; day: string }[];
}

function appendOptOut(message: string): string {
  const optOut = " Reply STOP to opt out.";
  return message.trim().endsWith(optOut.trim()) ? message : `${message.trim()}${optOut}`;
}

export const prebuiltDrips: Drip[] = [
  {
    id: "mortgage_protection",
    name: "Mortgage Protection Drip",
    type: "sms",
    messages: [
      { text: appendOptOut("Hey there {{ contact.first_name }}! This is {{ agent.name }}. I was assigned to go over your mortgage protection options. Let me know when to give you a call."), day: "Day 1" },
      { text: appendOptOut("Hey {{ contact.first_name }}, it's {{ agent.name }}. Did you get my text the other day about the mortgage protection?"), day: "Day 4" },
      { text: appendOptOut("Hey {{ contact.first_name }}, it's {{ agent.name }}. I wanted to go over mortgage protection with you. It only takes a few minutes. Do you have time today or tomorrow?"), day: "Day 7" },
      { text: appendOptOut("Hi {{ contact.first_name }}, it's {{ agent.name }}. You must be pretty busy! If you're still looking to go over some mortgage protection options, let me know."), day: "Day 10" },
      { text: appendOptOut("Hi {{ contact.first_name | default:\"there\" }}, it's {{ agent.name }}. Are you still considering mortgage protection?"), day: "Day 13" },
      { text: appendOptOut("Hi {{ contact.first_name }}, it's {{ agent.name }}. If you're still looking into mortgage protection, let me know. It only takes 5–10 minutes to discuss."), day: "Day 16" },
      { text: appendOptOut("Hi {{ contact.first_name }}, this is {{ agent.name }}. A couple weeks ago you requested information on mortgage protection. It only takes about 10 minutes to see if you'd be eligible. When would be the best time for me to give you a ring?"), day: "Day 19" },
      { text: appendOptOut("Hi {{ contact.first_name }}, still haven't been able to get in touch with you about the mortgage protection you requested. Let me know what works."), day: "Day 24" },
      { text: appendOptOut("Hi {{ contact.first_name }}, if you still haven't found a mortgage protection plan, let me know. - {{ agent.name }}"), day: "Day 29" },
      { text: appendOptOut("Hey {{ contact.first_name }}, did you give up on mortgage protection? - {{ agent.name }}"), day: "Day 33" },
      { text: appendOptOut("Hi {{ contact.first_name }}, hope all is well! You sent in a request to go over some mortgage protection options. Do you have a few minutes today to chat on the phone? Best, {{ agent.name }}"), day: "Day 37" },
      { text: appendOptOut("Hi {{ contact.first_name }}, I received your info when you filled out the form about mortgage protection. Are you still looking for more info? Let me know where you're at. Best, {{ agent.name }}"), day: "Day 41" }
    ]
  },
  {
    id: "veteran_leads",
    name: "Veteran Leads Drip",
    type: "sms",
    messages: [
      { text: appendOptOut("Hey {{ contact.first_name }}, this is {{ agent.name }} with the life insurance for veteran programs. We got your request for information. When's a good time to give you a call?"), day: "Day 1" },
      { text: appendOptOut("Hey {{ contact.first_name }}, it's {{ agent.name }}. Just checking if you saw my message about your veteran benefits and options."), day: "Day 4" },
      { text: appendOptOut("Hey {{ contact.first_name }}, it's {{ agent.name }}. I'd like to go over your veteran life insurance options with you. It only takes a few minutes."), day: "Day 7" },
      { text: appendOptOut("Hi {{ contact.first_name }}, it's {{ agent.name }}. Are you still interested in the veteran programs? Let me know."), day: "Day 10" },
      { text: appendOptOut("Hi {{ contact.first_name | default:\"there\" }}, it's {{ agent.name }}. Are you still considering your veteran life insurance options?"), day: "Day 13" },
      { text: appendOptOut("Hi {{ contact.first_name }}, it's {{ agent.name }}. If you're still looking into veteran options, let me know. It only takes 5–10 minutes."), day: "Day 16" },
      { text: appendOptOut("Hi {{ contact.first_name }}, this is {{ agent.name }}. A couple weeks ago you requested info on veteran programs. When would be a good time to connect?"), day: "Day 19" },
      { text: appendOptOut("Hi {{ contact.first_name }}, still haven't been able to connect about your veteran benefits. Let me know what works."), day: "Day 24" },
      { text: appendOptOut("Hi {{ contact.first_name }}, if you still haven't finalized your veteran life insurance, let me know. - {{ agent.name }}"), day: "Day 29" },
      { text: appendOptOut("Hey {{ contact.first_name }}, did you give up on the veteran benefits? - {{ agent.name }}"), day: "Day 33" },
      { text: appendOptOut("Hi {{ contact.first_name }}, hope all is well! Do you have a few minutes today to chat about your veteran options? Best, {{ agent.name }}"), day: "Day 37" },
      { text: appendOptOut("Hi {{ contact.first_name }}, I received your info from your veteran coverage request. Are you still looking? Let me know where you're at. Best, {{ agent.name }}"), day: "Day 41" }
    ]
  },
  {
    id: "iul_leads",
    name: "IUL Leads Drip",
    type: "sms",
    messages: [
      { text: appendOptOut("Hey {{ contact.first_name }}, {{ agent.name }} here with the info you requested on retirement protection programs (IUL). When can we go over it together?"), day: "Day 1" },
      { text: appendOptOut("Hey {{ contact.first_name }}, it's {{ agent.name }}. Just checking if you saw my text about the retirement options."), day: "Day 4" },
      { text: appendOptOut("Hey {{ contact.first_name }}, it's {{ agent.name }}. I'd like to go over retirement and cash growth options with you. It only takes a few minutes."), day: "Day 7" },
      { text: appendOptOut("Hi {{ contact.first_name }}, it's {{ agent.name }}. Are you still interested in the IUL retirement options? Let me know."), day: "Day 10" },
      { text: appendOptOut("Hi {{ contact.first_name | default:\"there\" }}, it's {{ agent.name }}. Are you still considering retirement protection options?"), day: "Day 13" },
      { text: appendOptOut("Hi {{ contact.first_name }}, it's {{ agent.name }}. If you'd still like to discuss IUL or retirement options, let me know."), day: "Day 16" },
      { text: appendOptOut("Hi {{ contact.first_name }}, this is {{ agent.name }}. A few weeks ago you requested info on retirement protection. When would be a good time to connect?"), day: "Day 19" },
      { text: appendOptOut("Hi {{ contact.first_name }}, still haven't been able to connect about your retirement protection. Let me know what works."), day: "Day 24" },
      { text: appendOptOut("Hi {{ contact.first_name }}, if you still haven't secured a retirement plan, let me know. - {{ agent.name }}"), day: "Day 29" },
      { text: appendOptOut("Hey {{ contact.first_name }}, did you give up on the retirement plan? - {{ agent.name }}"), day: "Day 33" },
      { text: appendOptOut("Hi {{ contact.first_name }}, hope all is well! Do you have a few minutes today to chat about your retirement options? Best, {{ agent.name }}"), day: "Day 37" },
      { text: appendOptOut("Hi {{ contact.first_name }}, I received your info from your IUL request. Are you still interested? Let me know where you're at. Best, {{ agent.name }}"), day: "Day 41" }
    ]
  },
  {
    id: "final_expense_leads",
    name: "Final Expense Leads Drip",
    type: "sms",
    messages: [
      { text: appendOptOut("Hey {{ contact.first_name }}, {{ agent.name }} here regarding the final expense program you requested info on. When would be a good time to talk?"), day: "Day 1" },
      { text: appendOptOut("Hey {{ contact.first_name }}, it's {{ agent.name }}. Did you see my text about the final expense options?"), day: "Day 4" },
      { text: appendOptOut("Hey {{ contact.first_name }}, it's {{ agent.name }}. I'd like to go over the final expense options with you. It only takes a few minutes."), day: "Day 7" },
      { text: appendOptOut("Hi {{ contact.first_name }}, it's {{ agent.name }}. Are you still interested in the final expense program? Let me know."), day: "Day 10" },
      { text: appendOptOut("Hi {{ contact.first_name | default:\"there\" }}, it's {{ agent.name }}. Are you still considering final expense coverage?"), day: "Day 13" },
      { text: appendOptOut("Hi {{ contact.first_name }}, it's {{ agent.name }}. Just checking in again about your final expense options."), day: "Day 16" },
      { text: appendOptOut("Hi {{ contact.first_name }}, this is {{ agent.name }}. A few weeks ago you requested info on final expense coverage. When would be a good time to connect?"), day: "Day 19" },
      { text: appendOptOut("Hi {{ contact.first_name }}, still haven't been able to connect about your final expense plan. Let me know what works."), day: "Day 24" },
      { text: appendOptOut("Hi {{ contact.first_name }}, if you still haven't secured a final expense plan, let me know. - {{ agent.name }}"), day: "Day 29" },
      { text: appendOptOut("Hey {{ contact.first_name }}, did you give up on the final expense plan? - {{ agent.name }}"), day: "Day 33" },
      { text: appendOptOut("Hi {{ contact.first_name }}, hope all is well! Do you have a few minutes today to chat about your final expense options? Best, {{ agent.name }}"), day: "Day 37" },
      { text: appendOptOut("Hi {{ contact.first_name }}, I received your info from your final expense request. Are you still interested? Let me know where you're at. Best, {{ agent.name }}"), day: "Day 41" }
    ]
  },

  {
    id: "sold_followup",
    name: "Sold Lead Follow-up Drip",
    type: "sms",
    messages: [
      { text: appendOptOut("Just checking in to make sure you got everything you needed after signing up. Let me know if any questions come up!"), day: "Day 3" },
      { text: appendOptOut("Checking in to see how everything is going with your policy! Let me know if you need anything or have any questions."), day: "Month 1" },
      { text: appendOptOut("Hope your policy has been going well! I’m here if you need anything or know someone else looking for coverage. Referrals are always appreciated!"), day: "Month 3" },
      { text: appendOptOut("Just wanted to say hi and see if everything is still good with your policy. Let me know if you'd like to review anything."), day: "Month 5" },
      { text: appendOptOut("Checking in again! Remember, if friends or family ever need help, feel free to send them my way — I'd love to help."), day: "Month 7" },
      { text: appendOptOut("Hi again! Just a quick check-in to make sure your policy still fits your needs. I'm always happy to help."), day: "Month 9" },
      { text: appendOptOut("Thank you again for trusting me with your policy. Always here for any questions or updates!"), day: "Month 12" }
    ]
  },
  {
    id: "client_retention_text",
    name: "Client Retention Text Drip",
    type: "sms",
    messages: [
      { text: appendOptOut("Hi {{ contact.first_name | default:\"there\" }}, it’s {{ agent.name }}. Thank you again for trusting me with your policy!"), day: "Day 1" },
      { text: appendOptOut("Hi {{ contact.first_name }}, I hope you're enjoying peace of mind knowing your coverage is in place! I'm always here for questions. By the way, referrals are always appreciated!"), day: "Day 30" },
      { text: appendOptOut("Hi {{ contact.first_name }}, just checking in — if anything changes with your family or needs, let me know. We can review anytime."), day: "Day 60" },
      { text: appendOptOut("Hi {{ contact.first_name }}, do you know anyone who might benefit from coverage? I always appreciate referrals and will take great care of them!"), day: "Day 90" },
      { text: appendOptOut("Hi {{ contact.first_name }}, it's {{ agent.name }}. A quick reminder I'm always here if you need to adjust or review your policy."), day: "Day 120" },
      { text: appendOptOut("Hi {{ contact.first_name }}, hope you’re doing well! A quick check-in to ensure your policy still meets your goals. Referrals always welcome!"), day: "Day 150" },
      { text: appendOptOut("Hi {{ contact.first_name }}, just a reminder: as life changes, your insurance needs might too. Happy to review anytime."), day: "Day 180" },
      { text: appendOptOut("Hi {{ contact.first_name }}, it’s {{ agent.name }}. Checking in — if friends or family need help, I'd be honored to assist."), day: "Day 210" },
      { text: appendOptOut("Hi {{ contact.first_name }}, just another friendly check-in. Let me know if you'd like to explore additional options or updates."), day: "Day 240" },
      { text: appendOptOut("Hi {{ contact.first_name }}, I truly value your referrals — feel free to send anyone my way. Thank you!"), day: "Day 270" },
      { text: appendOptOut("Hi {{ contact.first_name }}, hope all is well! Quick reminder: policy reviews are always free and can bring peace of mind."), day: "Day 300" },
      { text: appendOptOut("Hi {{ contact.first_name }}, we’re approaching a year together! Thank you for being a valued client. I'm here for any needs."), day: "Day 330" },
      { text: appendOptOut("Hi {{ contact.first_name }}, celebrating one year! Thank you for trusting me. Please reach out anytime, and referrals are always appreciated!"), day: "Day 365" }
    ]
  },
  {
    id: "birthday_holiday",
    name: "Birthday & Holiday Drip",
    type: "sms",
    messages: [
      { text: appendOptOut("🎉 Happy Birthday {{ contact.first_name }}! Hope you have an amazing day. Thank you for being such a valued client!"), day: "Birthday" },
      { text: appendOptOut("🎄 Happy Holidays, {{ contact.first_name }}! Wishing you and your loved ones a wonderful season and new year ahead."), day: "December 15" },
      { text: appendOptOut("🦃 Happy Thanksgiving, {{ contact.first_name }}! Grateful to have you as a client. Enjoy your time with family!"), day: "November 20" },
      { text: appendOptOut("🇺🇸 Happy 4th of July, {{ contact.first_name }}! Hope you're enjoying some fun and relaxation today."), day: "July 3" },
      { text: appendOptOut("💖 Happy Valentine's Day, {{ contact.first_name }}! Hope you have a wonderful day!"), day: "February 13" },
      { text: appendOptOut("🌸 Happy Mother's Day to all the amazing moms! Thank you for all you do."), day: "May 9" },
      { text: appendOptOut("👨‍👧‍👦 Happy Father's Day! Hope you enjoy your day, {{ contact.first_name }}."), day: "June 18" },
      { text: appendOptOut("🎆 Happy New Year, {{ contact.first_name }}! Wishing you a fantastic year ahead."), day: "December 31" }
    ]
  },
  {
    id: "quoted_unsold",
    name: "Quoted - Unsold SMS Drip",
    type: "sms",
    messages: [
      { text: appendOptOut("Hi {{ contact.first_name | default:\"there\" }}, thank you for going over your options with me. We're almost there — just one step left!"), day: "Day 1" },
      { text: appendOptOut("Hi {{ contact.first_name }}, it’s {{ agent.name }}. Have you had time to think about the quote? Let me know if you're ready to finalize."), day: "Day 3" },
      { text: appendOptOut("Hi {{ contact.first_name }}, just checking in! I don’t want you to miss out on the coverage we discussed."), day: "Day 5" },
      { text: appendOptOut("Hi {{ contact.first_name }}, I understand life gets busy. I want to make sure you’re covered before anything happens."), day: "Day 7" },
      { text: appendOptOut("Hi {{ contact.first_name }}, I haven’t heard back. Just checking in one last time — let me know if you'd like to proceed."), day: "Day 10" },
      { text: appendOptOut("Hi {{ contact.first_name }}, no rush if now isn’t right. I’m here to help whenever you're ready."), day: "Day 14" },
      { text: appendOptOut("Hi {{ contact.first_name }}, even if now isn’t the right time, keep me in mind for the future or feel free to share my info with a friend who might benefit."), day: "Day 20" }
    ]
  },

  // >>> NEW: Missed Appointment / No-Show rebook drip <<<
  {
    id: "missed_appt_7d",
    name: "Missed Appointment – 7 Day Rebook",
    type: "sms",
    messages: [
      { text: appendOptOut("Hey {{ contact.first_name | default:\"there\" }}, it’s {{ agent.name }}. Sorry we missed each other. Want to grab a quick time to reschedule? I can do today or tomorrow."), day: "Day 1" },
      { text: appendOptOut("Hi {{ contact.first_name }}, checking back in — I can hop on a quick call to go over everything. What time works best?"), day: "Day 2" },
      { text: appendOptOut("Quick reminder: I’ve got openings later today and tomorrow. Would you like me to hold a spot for you?"), day: "Day 3" },
      { text: appendOptOut("Still happy to help you get this done, {{ contact.first_name }}. 10 minutes max — want to try again?"), day: "Day 4" },
      { text: appendOptOut("No worries if you’ve been busy. If you still want to review options, I can make it easy. When’s good?"), day: "Day 5" },
      { text: appendOptOut("I can text you a quick calendar link or just book it for you — which do you prefer?"), day: "Day 6" },
      { text: appendOptOut("Last nudge from me this week — want me to reserve a time? If not now, I’ll pause and you can text anytime."), day: "Day 7" }
    ]
  }
];
