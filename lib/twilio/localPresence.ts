// lib/twilio/localPresence.ts
// Pure helper — no imports from Twilio, DB, or API routes.
// Safe to unit test in isolation.

export type LocalPresenceResult = {
  fromNumber: string;
  matchSource: "exact_state" | "area_code_state" | "fallback";
  matchedState?: string;
};

// NANP area code → US state abbreviation
// Conservative vetted map — US only
const AREA_CODE_TO_STATE: Record<string, string> = {
  "205": "AL", "251": "AL", "256": "AL", "334": "AL", "659": "AL",
  "907": "AK",
  "480": "AZ", "520": "AZ", "602": "AZ", "623": "AZ", "928": "AZ",
  "479": "AR", "501": "AR", "870": "AR",
  "209": "CA", "213": "CA", "310": "CA", "323": "CA", "408": "CA",
  "415": "CA", "424": "CA", "442": "CA", "510": "CA", "530": "CA",
  "559": "CA", "562": "CA", "619": "CA", "626": "CA", "628": "CA",
  "650": "CA", "657": "CA", "661": "CA", "669": "CA", "707": "CA",
  "714": "CA", "747": "CA", "760": "CA", "764": "CA", "805": "CA",
  "818": "CA", "820": "CA", "831": "CA", "858": "CA", "909": "CA",
  "916": "CA", "925": "CA", "949": "CA", "951": "CA",
  "303": "CO", "719": "CO", "720": "CO", "970": "CO",
  "203": "CT", "475": "CT", "860": "CT", "959": "CT",
  "302": "DE",
  "202": "DC",
  "239": "FL", "305": "FL", "321": "FL", "352": "FL", "386": "FL",
  "407": "FL", "448": "FL", "561": "FL", "689": "FL",
  "727": "FL", "754": "FL", "772": "FL", "786": "FL", "813": "FL",
  "850": "FL", "863": "FL", "904": "FL", "941": "FL", "954": "FL",
  "229": "GA", "404": "GA", "470": "GA", "478": "GA", "678": "GA",
  "706": "GA", "762": "GA", "770": "GA", "912": "GA",
  "808": "HI",
  "208": "ID", "986": "ID",
  "217": "IL", "224": "IL", "309": "IL", "312": "IL", "331": "IL",
  "447": "IL", "464": "IL", "618": "IL", "630": "IL", "708": "IL",
  "730": "IL", "773": "IL", "779": "IL", "815": "IL", "847": "IL", "872": "IL",
  "219": "IN", "260": "IN", "317": "IN", "463": "IN", "574": "IN",
  "765": "IN", "812": "IN", "930": "IN",
  "319": "IA", "515": "IA", "563": "IA", "641": "IA", "712": "IA",
  "316": "KS", "620": "KS", "785": "KS", "913": "KS",
  "270": "KY", "364": "KY", "502": "KY", "606": "KY", "859": "KY",
  "225": "LA", "318": "LA", "337": "LA", "504": "LA", "985": "LA",
  "207": "ME",
  "240": "MD", "301": "MD", "410": "MD", "443": "MD", "667": "MD",
  "339": "MA", "351": "MA", "413": "MA", "508": "MA", "617": "MA",
  "774": "MA", "781": "MA", "857": "MA", "978": "MA",
  "231": "MI", "248": "MI", "269": "MI", "313": "MI", "517": "MI",
  "586": "MI", "616": "MI", "734": "MI", "810": "MI", "906": "MI",
  "947": "MI", "989": "MI",
  "218": "MN", "320": "MN", "507": "MN", "612": "MN", "651": "MN",
  "763": "MN", "952": "MN",
  "228": "MS", "601": "MS", "662": "MS", "769": "MS",
  "314": "MO", "417": "MO", "573": "MO", "636": "MO", "660": "MO", "816": "MO",
  "406": "MT",
  "308": "NE", "402": "NE", "531": "NE",
  "702": "NV", "725": "NV", "775": "NV",
  "603": "NH",
  "201": "NJ", "551": "NJ", "609": "NJ", "640": "NJ", "732": "NJ",
  "848": "NJ", "856": "NJ", "862": "NJ", "908": "NJ", "973": "NJ",
  "505": "NM", "575": "NM",
  "212": "NY", "315": "NY", "332": "NY", "347": "NY", "516": "NY",
  "518": "NY", "585": "NY", "607": "NY", "631": "NY", "646": "NY",
  "680": "NY", "716": "NY", "718": "NY", "838": "NY", "845": "NY",
  "914": "NY", "917": "NY", "929": "NY", "934": "NY",
  "252": "NC", "336": "NC", "704": "NC", "743": "NC", "828": "NC",
  "910": "NC", "919": "NC", "980": "NC", "984": "NC",
  "701": "ND",
  "216": "OH", "220": "OH", "234": "OH", "283": "OH", "330": "OH",
  "380": "OH", "419": "OH", "440": "OH", "513": "OH", "567": "OH",
  "614": "OH", "740": "OH", "937": "OH",
  "405": "OK", "539": "OK", "580": "OK", "918": "OK",
  "458": "OR", "503": "OR", "541": "OR", "971": "OR",
  "215": "PA", "223": "PA", "267": "PA", "272": "PA", "412": "PA",
  "445": "PA", "484": "PA", "570": "PA", "582": "PA", "610": "PA",
  "717": "PA", "724": "PA", "814": "PA", "835": "PA", "878": "PA",
  "401": "RI",
  "803": "SC", "839": "SC", "843": "SC", "854": "SC", "864": "SC",
  "605": "SD",
  "423": "TN", "615": "TN", "629": "TN", "731": "TN", "865": "TN",
  "901": "TN", "931": "TN",
  "210": "TX", "214": "TX", "254": "TX", "281": "TX", "325": "TX",
  "346": "TX", "361": "TX", "409": "TX", "430": "TX", "432": "TX",
  "469": "TX", "512": "TX", "682": "TX", "713": "TX", "726": "TX",
  "737": "TX", "806": "TX", "817": "TX", "830": "TX", "832": "TX",
  "903": "TX", "915": "TX", "936": "TX", "940": "TX", "945": "TX",
  "956": "TX", "972": "TX", "979": "TX",
  "385": "UT", "435": "UT", "801": "UT",
  "802": "VT",
  "276": "VA", "434": "VA", "540": "VA", "571": "VA", "703": "VA",
  "757": "VA", "804": "VA",
  "206": "WA", "253": "WA", "360": "WA", "425": "WA", "509": "WA", "564": "WA",
  "304": "WV", "681": "WV",
  "262": "WI", "414": "WI", "534": "WI", "608": "WI", "715": "WI", "920": "WI",
  "307": "WY",
};

// State name → abbreviation for leads that store full state name
const STATE_NAME_TO_ABBR: Record<string, string> = {
  "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
  "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
  "district of columbia": "DC", "florida": "FL", "georgia": "GA", "hawaii": "HI",
  "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
  "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
  "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
  "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
  "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
  "vermont": "VT", "virginia": "VA", "washington": "WA", "west virginia": "WV",
  "wisconsin": "WI", "wyoming": "WY",
};

/** Normalize any state value to a 2-letter abbreviation, or null */
function normalizeState(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 2) return trimmed.toUpperCase();
  const lower = trimmed.toLowerCase();
  return STATE_NAME_TO_ABBR[lower] ?? null;
}

/** Extract 3-digit area code from any phone format */
function extractAreaCode(phone: string | undefined | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  // E.164 US: +1XXXXXXXXXX → 11 digits, area code starts at index 1
  if (digits.length === 11 && digits[0] === "1") return digits.slice(1, 4);
  if (digits.length === 10) return digits.slice(0, 3);
  return null;
}

/** Extract state from a lead object, checking all known field locations */
export function resolveLeadState(lead: Record<string, any>): string | null {
  // Direct state fields (case variants)
  const directFields = [
    lead?.State, lead?.state, lead?.STATE,
    lead?.rawRow?.State, lead?.rawRow?.state, lead?.rawRow?.STATE,
    lead?.rawRow?.["State/Province"], lead?.rawRow?.["state/province"],
  ];
  for (const val of directFields) {
    const normalized = normalizeState(val);
    if (normalized) return normalized;
  }
  return null;
}

/** Infer state from a lead's phone number area code */
export function inferStateFromPhone(lead: Record<string, any>): string | null {
  const phoneFields = [
    lead?.normalizedPhone, lead?.phone, lead?.Phone,
    lead?.phoneLast10, lead?.rawRow?.Phone, lead?.rawRow?.phone,
  ];
  for (const phone of phoneFields) {
    const areaCode = extractAreaCode(phone);
    if (areaCode && AREA_CODE_TO_STATE[areaCode]) {
      return AREA_CODE_TO_STATE[areaCode];
    }
  }
  return null;
}

/** Get state for an owned number via its area code */
function getNumberState(phoneNumber: string): string | null {
  const areaCode = extractAreaCode(phoneNumber);
  if (!areaCode) return null;
  return AREA_CODE_TO_STATE[areaCode] ?? null;
}

/**
 * Main resolver.
 * Given a lead and the user's owned numbers, returns the best from-number.
 * Always falls back to fallbackFromNumber — never returns null.
 */
export function selectLocalPresenceNumber(
  lead: Record<string, any>,
  ownedNumbers: Array<{ phoneNumber: string; status?: string }>,
  fallbackFromNumber: string
): LocalPresenceResult {
  // Only consider active numbers
  const activeNumbers = ownedNumbers.filter(
    (n) => !n.status || n.status === "active"
  );

  if (activeNumbers.length === 0) {
    return { fromNumber: fallbackFromNumber, matchSource: "fallback" };
  }

  // Step 1: Try exact lead state match
  const leadState = resolveLeadState(lead);
  if (leadState) {
    const exactMatch = activeNumbers.find(
      (n) => getNumberState(n.phoneNumber) === leadState
    );
    if (exactMatch) {
      return {
        fromNumber: exactMatch.phoneNumber,
        matchSource: "exact_state",
        matchedState: leadState,
      };
    }
  }

  // Step 2: Infer lead state from phone area code, then match
  const inferredState = inferStateFromPhone(lead);
  if (inferredState) {
    const areaMatch = activeNumbers.find(
      (n) => getNumberState(n.phoneNumber) === inferredState
    );
    if (areaMatch) {
      return {
        fromNumber: areaMatch.phoneNumber,
        matchSource: "area_code_state",
        matchedState: inferredState,
      };
    }
  }

  // Step 3: Fallback — existing selected/default number unchanged
  return { fromNumber: fallbackFromNumber, matchSource: "fallback" };
}