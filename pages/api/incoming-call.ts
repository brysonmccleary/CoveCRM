import type { NextApiRequest, NextApiResponse } from 'next';
import { buffer } from 'micro';

export const config = {
  api: {
    bodyParser: false,
  },
};

// 🟢 Example static leads list (replace with your DB call later)
const leads = [
  { name: "John Doe", phoneNumber: "5551234567" },
  { name: "Jane Smith", phoneNumber: "5559876543" },
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Parse raw buffer
  const buf = await buffer(req);
  const bodyStr = buf.toString();
  const params = new URLSearchParams(bodyStr);

  // Get From field sent by Twilio
  const From = params.get("From");

  if (!From) {
    return res.status(400).json({ message: "Missing From number" });
  }

  // Format number: remove +1 and non-numeric characters
  const formattedNumber = From.replace("+1", "").replace(/[^0-9]/g, "");

  // Find matching lead
  const foundLead = leads.find((lead) => lead.phoneNumber === formattedNumber);

  if (foundLead) {
    console.log(`Incoming call from ${foundLead.name} (${formattedNumber})`);
    // Later: Save or notify frontend here
    return res.status(200).json({ success: true, lead: foundLead });
  }

  return res.status(404).json({ message: "Lead not found" });
}

