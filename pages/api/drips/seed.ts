import dbConnect from "@/lib/dbConnect";
import DripCampaign from "@/models/DripCampaign";

export default async function handler(req, res) {
  await dbConnect();

  const prebuilt = new DripCampaign({
    name: "Mortgage Protection Drip",
    type: "sms",
    isActive: true,
    steps: [
      {
        text: "Hey there {{ contact.first_name }}! This is {{ agent.name }}. I was assigned to go over your mortgage protection options. Let me know when to give you a call or feel free to book your own appointment. (insert calendar link)",
        day: "1",
        time: "9:00 AM",
        calendarLink: "",
        analytics: { views: 0, responses: 0 },
      },
      {
        text: "Hey {{ contact.first_name }}, it's {{ agent.name }}. Did you get my text the other day about the mortgage protection?",
        day: "4",
        time: "9:00 AM",
        calendarLink: "",
        analytics: { views: 0, responses: 0 },
      },
      // Add more steps as needed
    ],
  });

  await prebuilt.save();

  res.status(200).json({ message: "Seeded successfully" });
}

