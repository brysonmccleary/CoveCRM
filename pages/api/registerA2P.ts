import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import twilio from "twilio";
import dbConnect from "@/lib/dbConnect";
import A2PProfile from "@/models/A2PProfile";
import parseAddress from "parse-address";

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;
const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID!;

const twilioClient = twilio(accountSid, authToken);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ message: "Unauthorized" });

  const {
    businessName,
    ein,
    website,
    address,
    email,
    phone,
    contactTitle,
    contactFirstName,
    contactLastName,
    sampleMessages,
    optInDetails,
    volume,
    optInScreenshotUrl,
  } = req.body;

  if (
    !businessName ||
    !ein ||
    !website ||
    !address ||
    !email ||
    !phone ||
    !contactFirstName ||
    !contactLastName ||
    !sampleMessages ||
    !optInDetails ||
    !volume ||
    !optInScreenshotUrl
  ) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    await dbConnect();

    const parsed = parseAddress.parseLocation(address);
    if (
      !parsed ||
      !parsed.number ||
      !parsed.street ||
      !parsed.city ||
      !parsed.state ||
      !parsed.zip
    ) {
      return res.status(400).json({ message: "Invalid address format" });
    }

    const policyList = await twilioClient.trusthub.v1.policies.list();

    const standardA2PPolicy = policyList.find((p) => {
      const name = p.friendlyName?.toLowerCase() || "";
      return (
        name.includes("a2p") &&
        (name.includes("10dlc") || name.includes("messaging") || name.includes("local"))
      );
    });

    if (!standardA2PPolicy) {
      throw new Error("A2P 10DLC policy not found in TrustHub policy list");
    }

    const policySid = standardA2PPolicy.sid;

    const brand = await twilioClient.trusthub.v1.customerProfiles.create({
      policySid,
      friendlyName: businessName,
      businessName,
      businessRegistrationNumber: ein,
      customerProfileType: "END_USER",
      email,
      phoneNumber: phone,
      website,
      addressLine1: `${parsed.number} ${parsed.street}`,
      city: parsed.city,
      stateProvinceRegion: parsed.state,
      postalCode: parsed.zip,
      country: "US",
      authorizedContact: {
        title: contactTitle || "Owner",
        firstName: contactFirstName,
        lastName: contactLastName,
        email,
        phone,
      },
    });

    await A2PProfile.create({
      userId: session.user.id,
      businessName,
      ein,
      website,
      address,
      email,
      phone,
      contactTitle,
      contactFirstName,
      contactLastName,
      profileSid: brand.sid,
      useCaseSid: null,
      sampleMessages,
      optInDetails,
      volume,
      optInScreenshotUrl,
    });

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error("A2P registration error:", error);
    return res.status(500).json({ message: error.message || "Server Error" });
  }
}
