import type { NextApiRequest, NextApiResponse } from "next";
import twilioClient from "@/lib/twilioClient";

// Extended area code city map (many major US cities)
const areaCodeCityMap: Record<string, string> = {
  "212": "New York",
  "213": "Los Angeles",
  "305": "Miami",
  "312": "Chicago",
  "404": "Atlanta",
  "415": "San Francisco",
  "425": "Seattle Eastside",
  "512": "Austin",
  "602": "Phoenix",
  "617": "Boston",
  "702": "Las Vegas",
  "703": "Northern Virginia",
  "704": "Charlotte",
  "713": "Houston",
  "714": "Orange County",
  "718": "Brooklyn",
  "720": "Denver",
  "801": "Salt Lake City",
  "808": "Honolulu",
  "816": "Kansas City",
  "901": "Memphis",
  "904": "Jacksonville",
  "916": "Sacramento",
  "919": "Raleigh",
  "202": "Washington DC",
  "210": "San Antonio",
  "214": "Dallas",
  "215": "Philadelphia",
  "216": "Cleveland",
  "303": "Denver",
  "305": "Miami",
  "312": "Chicago",
  "313": "Detroit",
  "317": "Indianapolis",
  "323": "Los Angeles",
  "347": "New York",
  "408": "San Jose",
  "415": "San Francisco",
  "480": "Phoenix East",
  "502": "Louisville",
  "503": "Portland",
  "504": "New Orleans",
  "512": "Austin",
  "513": "Cincinnati",
  "520": "Tucson",
  "530": "Northern California",
  "562": "Long Beach",
  "602": "Phoenix",
  "612": "Minneapolis",
  "615": "Nashville",
  "619": "San Diego",
  "626": "Pasadena",
  "628": "San Francisco",
  "650": "Peninsula (CA)",
  "657": "Anaheim",
  "661": "Bakersfield",
  "678": "Atlanta",
  "682": "Fort Worth",
  "702": "Las Vegas",
  "704": "Charlotte",
  "713": "Houston",
  "714": "Anaheim",
  "720": "Denver",
  "732": "New Jersey Shore",
  "754": "Fort Lauderdale",
  "757": "Virginia Beach",
  "770": "Atlanta Suburbs",
  "772": "Treasure Coast (FL)",
  "773": "Chicago",
  "774": "Central Massachusetts",
  "786": "Miami",
  "801": "Salt Lake City",
  "813": "Tampa",
  "817": "Fort Worth",
  "818": "San Fernando Valley",
  "832": "Houston",
  "850": "Tallahassee",
  "858": "San Diego North",
  "859": "Lexington",
  "860": "Hartford",
  "862": "Newark",
  "863": "Lakeland",
  "864": "Greenville (SC)",
  "865": "Knoxville",
  "901": "Memphis",
  "904": "Jacksonville",
  "913": "Kansas City",
  "914": "Westchester",
  "916": "Sacramento",
  "919": "Raleigh",
  "920": "Green Bay",
  "925": "East Bay",
  "928": "Flagstaff",
  "940": "Wichita Falls",
  "941": "Sarasota",
  "954": "Fort Lauderdale",
  "971": "Portland",
  "980": "Charlotte",
  "984": "Raleigh",
  "985": "Houma"
  // Add more if you'd like
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { country = "US", areaCode } = req.query;

  if (!areaCode) {
    return res.status(400).json({ message: "Missing area code" });
  }

  try {
    const numbers = await twilioClient.availablePhoneNumbers(country as string).local.list({
      areaCode: areaCode as string,
      smsEnabled: true,
      voiceEnabled: true,
      limit: 10,
    });

    const formatted = numbers.map((num) => {
      const match = num.phoneNumber.match(/\+1(\d{3})/);
      const extractedAreaCode = match ? match[1] : "";

      const city = num.locality || areaCodeCityMap[extractedAreaCode] || "Available city";
      const state = num.region || "US";

      return {
        phoneNumber: num.phoneNumber,
        city,
        state,
      };
    });

    res.status(200).json({ numbers: formatted });
  } catch (error) {
    console.error("Error fetching available numbers:", error);
    res.status(500).json({ message: "Failed to fetch numbers" });
  }
}
