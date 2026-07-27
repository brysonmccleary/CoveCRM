export type FacebookPageMarket =
  | "general_life"
  | "final_expense"
  | "mortgage_protection"
  | "iul"
  | "veteran"
  | "trucker";

export type FacebookPageStarterOption = {
  market: FacebookPageMarket;
  name: string;
  category: "Insurance Broker";
  bio: string;
  logoStyleId: string;
  paletteId: string;
};

export const FACEBOOK_PAGE_MARKETS: Array<{
  id: FacebookPageMarket;
  label: string;
  shortLabel: string;
}> = [
  { id: "general_life", label: "Life Insurance", shortLabel: "Life" },
  { id: "final_expense", label: "Final Expense", shortLabel: "Final Expense" },
  { id: "mortgage_protection", label: "Mortgage Protection", shortLabel: "Mortgage" },
  { id: "iul", label: "IUL / Cash Value", shortLabel: "IUL" },
  { id: "veteran", label: "Veteran Coverage", shortLabel: "Veteran" },
  { id: "trucker", label: "Trucker Coverage", shortLabel: "Trucker" },
];

const NAME_LIBRARY: Record<FacebookPageMarket, string[]> = {
  general_life: [
    "Your Life Coverage Guide",
    "My Insurance Quote Center",
    "Family Protection Options",
    "Life Coverage Review",
    "Coverage Options Made Simple",
    "Your Family Coverage Hub",
    "Life Protection Match",
    "My Insurance Quotes",
    "The Coverage Review Center",
    "My Life Insurance Request",
  ],
  final_expense: [
    "Final Expense Options",
    "Senior Life Coverage Guide",
    "Family Legacy Coverage",
    "Final Expense Review Center",
    "Burial Coverage Options",
    "Your Final Expense Guide",
    "Simple Senior Coverage",
    "Legacy Protection Review",
    "Your Final Expense Request",
    "Senior Coverage Match",
  ],
  mortgage_protection: [
    "Your Mortgage Protection Guide",
    "Mortgage Protection Review",
    "Home Loan Protection Options",
    "Protect My Mortgage",
    "Family Home Coverage",
    "Mortgage Coverage Center",
    "Your Mortgage Protection Request",
    "Your Home Coverage Review",
    "My Mortgage Protection",
    "Homeowner Protection Guide",
  ],
  iul: [
    "Indexed Life Education Center",
    "Cash Value Life Guide",
    "Future Value Life Options",
    "Life and Legacy Strategies",
    "Indexed Coverage Review",
    "Cash Value Coverage Center",
    "Future-Focused Life Coverage",
    "Your Indexed Life Request",
    "Legacy Growth Options",
    "Indexed Life Options",
  ],
  veteran: [
    "Veteran Life Coverage Guide",
    "Military Family Coverage Options",
    "Veteran Coverage Review",
    "Service Family Protection",
    "Veteran Legacy Options",
    "Life Coverage for Veterans",
    "Military Family Life Guide",
    "Veteran Protection Center",
    "Your Veteran Coverage Request",
    "Veteran Family Coverage",
  ],
  trucker: [
    "Trucker Life Coverage",
    "CDL Family Protection",
    "Road Life Coverage Guide",
    "Driver Coverage Review",
    "Trucker Legacy Options",
    "Life Coverage for Drivers",
    "Owner-Operator Coverage Guide",
    "CDL Coverage Center",
    "Your Trucker Coverage Request",
    "Commercial Driver Life Options",
  ],
};

const BIO_LIBRARY: Record<FacebookPageMarket, string[]> = {
  general_life: [
    "Simple life insurance education and coverage options from a licensed independent agent. Availability and eligibility vary.",
    "Helping individuals and families review private life insurance options with a licensed independent agent.",
    "Straightforward guidance for comparing life coverage options that fit your family and budget.",
  ],
  final_expense: [
    "Helping families review final expense and senior life coverage options with a licensed independent agent.",
    "Simple education about final expense coverage, eligibility, and available private insurance options.",
    "Final expense coverage guidance for families who want to plan ahead. Availability varies by state and carrier.",
  ],
  mortgage_protection: [
    "Helping homeowners review private life insurance options designed to protect their family and mortgage.",
    "Simple mortgage protection education and coverage reviews with a licensed independent insurance agent.",
    "Explore life coverage options that may help your family remain financially secure in their home.",
  ],
  iul: [
    "Educational information about indexed universal life insurance, protection, and cash value concepts from a licensed agent.",
    "Helping families understand IUL and other life insurance options. Products and eligibility vary by carrier and state.",
    "Straightforward education about protection, legacy planning, and cash value life insurance strategies.",
  ],
  veteran: [
    "Private life insurance education and coverage options for veterans and military families. Not affiliated with the VA or any government agency.",
    "Helping veterans and military families review private coverage with a licensed independent agent. No government affiliation.",
    "Independent life coverage guidance for veterans and their families. Availability and eligibility vary.",
  ],
  trucker: [
    "Private life insurance education and coverage options for CDL drivers, owner-operators, and trucking families.",
    "Helping commercial drivers review life coverage with a licensed independent insurance agent.",
    "Straightforward life insurance guidance built around the needs of professional drivers and their families.",
  ],
};

const LOGO_STYLES: Record<FacebookPageMarket, string[]> = {
  general_life: ["shield-heart", "family-circle", "umbrella", "compass"],
  final_expense: ["legacy-tree", "shield-heart", "dove-leaf", "family-circle"],
  mortgage_protection: ["home-shield", "roof-heart", "home-key", "umbrella"],
  iul: ["growth-shield", "bridge", "compass", "legacy-tree"],
  veteran: ["liberty-star", "shield-heart", "torch", "compass"],
  trucker: ["road-shield", "route-badge", "mountain-road", "shield-heart"],
};

const PALETTES = [
  "navy-teal-gold",
  "midnight-blue-silver",
  "forest-cream-gold",
  "charcoal-cobalt-cyan",
  "burgundy-cream-gold",
  "deep-teal-navy-white",
  "slate-blue-copper",
  "indigo-sky-white",
] as const;

export const FACEBOOK_PAGE_STARTER_VARIETY =
  Object.values(NAME_LIBRARY).reduce((total, names) => total + names.length, 0) *
  PALETTES.length;

export function marketForLeadType(leadType: string): FacebookPageMarket {
  if (leadType === "final_expense") return "final_expense";
  if (leadType === "mortgage_protection") return "mortgage_protection";
  if (leadType === "iul") return "iul";
  if (leadType === "veteran") return "veteran";
  if (leadType === "trucker") return "trucker";
  return "general_life";
}

function positiveModulo(value: number, divisor: number) {
  return ((Math.trunc(value) % divisor) + divisor) % divisor;
}

export function getFacebookPageStarterOption(
  market: FacebookPageMarket,
  seed: number,
  offset = 0,
): FacebookPageStarterOption {
  const names = NAME_LIBRARY[market];
  const bios = BIO_LIBRARY[market];
  const styles = LOGO_STYLES[market];
  const value = Math.abs(Math.trunc(seed)) + Math.max(0, Math.trunc(offset)) * 17;
  return {
    market,
    name: names[positiveModulo(value, names.length)],
    category: "Insurance Broker",
    bio: bios[positiveModulo(value * 3 + 1, bios.length)],
    logoStyleId: styles[positiveModulo(value * 5 + 2, styles.length)],
    paletteId: PALETTES[positiveModulo(value * 7 + offset, PALETTES.length)],
  };
}

export function allFacebookPageNames() {
  return Object.values(NAME_LIBRARY).flat();
}
