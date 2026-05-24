import { useMemo, useState } from "react";

export type BusinessIdentity = {
  businessName: string;
  leadFocus: string;
  state: string;
  stylePreference: string;
};

type BusinessIdentityStepProps = {
  value: BusinessIdentity;
  onChange: (next: BusinessIdentity) => void;
};

const LEAD_FOCUS_OPTIONS = [
  "Final Expense",
  "Mortgage Protection",
  "Veteran Leads",
  "IUL",
  "General Life Insurance",
];

const STYLE_OPTIONS = ["Professional", "Patriotic", "Modern"];

const STATE_PREFIXES: Record<string, string[]> = {
  AL: ["Heartland", "Magnolia", "Riverbend"],
  AK: ["Northern", "Frontier", "Denali"],
  AZ: ["Desert", "Copper State", "Sonoran"],
  AR: ["Ozark", "River Valley", "Natural State"],
  CA: ["Golden State", "Pacific", "Sierra"],
  CO: ["Summit", "Rocky Mountain", "Front Range"],
  CT: ["Charter Oak", "Harbor", "New England"],
  DE: ["First State", "Bayview", "Coastal"],
  FL: ["Suncoast", "Gulfside", "Palm"],
  GA: ["Peach State", "Southern", "Piedmont"],
  HI: ["Island", "Pacific", "Ohana"],
  ID: ["Gem State", "Sawtooth", "Clearwater"],
  IL: ["Prairie", "Lincoln", "Great Lakes"],
  IN: ["Hoosier", "Crossroads", "Heartland"],
  IA: ["Hawkeye", "Prairie", "Heartland"],
  KS: ["Sunflower", "Prairie", "Heartland"],
  KY: ["Bluegrass", "Commonwealth", "Riverbend"],
  LA: ["Bayou", "Pelican State", "Delta"],
  ME: ["Pine Tree", "Atlantic", "Coastal"],
  MD: ["Chesapeake", "Harbor", "Old Line"],
  MA: ["Bay State", "New England", "Beacon"],
  MI: ["Great Lakes", "Lakeshore", "Mitten"],
  MN: ["North Star", "Lakeside", "Twin Cities"],
  MS: ["Magnolia", "Delta", "Riverbend"],
  MO: ["Gateway", "Show Me", "Ozark"],
  MT: ["Big Sky", "Mountain West", "Yellowstone"],
  NE: ["Cornhusker", "Plains", "Prairie"],
  NV: ["Silver State", "Sierra", "Desert"],
  NH: ["Granite State", "White Mountain", "New England"],
  NJ: ["Garden State", "Shoreline", "Liberty"],
  NM: ["High Desert", "Enchanted", "Mesa"],
  NY: ["Empire", "Hudson", "Lakeview"],
  NC: ["Carolina", "Blue Ridge", "Piedmont"],
  ND: ["Northern Plains", "Dakota", "Prairie"],
  OH: ["Buckeye", "Great Lakes", "Heartland"],
  OK: ["Sooner", "Red River", "Plains"],
  OR: ["Cascade", "Pacific Northwest", "Willamette"],
  PA: ["Keystone", "Allegheny", "Liberty"],
  RI: ["Ocean State", "Harbor", "Coastal"],
  SC: ["Palmetto", "Lowcountry", "Carolina"],
  SD: ["Dakota", "Black Hills", "Prairie"],
  TN: ["Volunteer", "Cumberland", "Smoky Mountain"],
  TX: ["Lone Star", "Hill Country", "Texas Heritage"],
  UT: ["Beehive", "Wasatch", "Mountain West"],
  VT: ["Green Mountain", "Maple", "New England"],
  VA: ["Old Dominion", "Blue Ridge", "Commonwealth"],
  WA: ["Evergreen", "Cascade", "Pacific Northwest"],
  WV: ["Appalachian", "Mountain State", "Blue Ridge"],
  WI: ["Badger", "Great Lakes", "Northwoods"],
  WY: ["Frontier", "Teton", "High Plains"],
};

const GENERAL_PREFIXES = [
  "Heritage", "Liberty", "Legacy", "Ironwood", "Blue Ridge", "Silverline", "Hearthstone", "Cedar",
  "Oak Valley", "Summit", "TrueNorth", "Beacon", "Harbor", "Stonebridge", "Willow", "Maple",
  "Redwood", "BrightPath", "First Light", "Evergreen", "Clearwater", "Pioneer", "Meridian", "Canyon",
  "Prairie", "Lakeside", "Crossroads", "Horizon", "Northstar", "Valley", "Keystone", "Cypress",
  "Sage", "Crown", "Sterling", "Bridgeway", "Highland", "Ashwood", "Briar", "Copper", "Riverstone",
  "Juniper", "Meadow", "Granite", "Trailhead", "Founders", "Elmwood", "Westfield", "Parkway",
  "Fairway", "Rockwell", "Seaside", "Brookstone", "Arbor", "Landmark", "Frontier", "Timberline",
  "Stonehaven", "Golden Oak", "Vista", "Ridgeline",
];

const TRUST_WORDS = [
  "Family", "Senior", "Life", "Legacy", "Coverage", "Protection", "Benefit", "Heritage",
  "Trusted", "Secure", "Guided", "Premier", "Reliable", "Steady", "Advantage", "Assurance",
  "Advisory", "Care", "Promise", "Foundation", "Planning", "Choice", "Freedom", "Guardian",
  "Neighbor", "Horizon", "Pathway", "Essential", "Personal", "Community", "Anchor", "Prime",
  "Select", "Shield", "Future", "Home", "Veteran", "Driver", "Retirement", "Family First",
  "Legacy First", "Lifetime", "Prosper", "ClearPath", "Bridge", "Compass", "Caring", "Cornerstone",
  "Heritage First", "SecurePath", "Benefit First", "LifeBridge",
];

const SUFFIXES = [
  "Benefits", "Coverage", "Protection", "Life Solutions", "Advisors", "Coverage Group", "Benefit Group",
  "Planning", "Insurance Advisors", "Life Advisors", "Coverage Partners", "Benefit Partners",
  "Family Benefits", "Protection Group", "Life Group", "Coverage Center", "Benefit Center",
  "Planning Group", "Solutions", "Insurance Group", "Protection Partners", "Legacy Advisors",
  "Coverage Advisors", "Benefit Advisors", "Life Planning", "Family Protection", "Senior Benefits",
  "Life Coverage", "Protection Services", "Coverage Solutions", "Insurance Solutions", "Guidance Group",
  "Advisory Group", "Family Coverage", "Coverage Network", "Benefit Network", "Life Partners",
  "Planning Partners", "Protection Advisors", "Secure Coverage", "Legacy Group", "Family Advisors",
];

const LEAD_FOCUS_WORDS: Record<string, string[]> = {
  "Final Expense": ["Legacy", "Senior", "Family", "Lifetime", "Heritage", "Caring"],
  "Mortgage Protection": ["Home", "Family", "Secure", "Foundation", "Hearthstone", "Guardian"],
  "Veteran Leads": ["Patriot", "Liberty", "Heritage", "Honor", "Family", "Guardian"],
  IUL: ["Future", "Prosper", "Legacy", "Retirement", "Compass", "Horizon"],
  "General Life Insurance": ["Life", "Family", "Legacy", "Secure", "Trusted", "Compass"],
};

const STYLE_PREFIXES: Record<string, string[]> = {
  Professional: ["Sterling", "Meridian", "Keystone", "Premier", "Landmark", "Bridgeway"],
  Patriotic: ["Liberty", "Heritage", "Patriot", "Founders", "Beacon", "Freedom"],
  Modern: ["BrightPath", "ClearPath", "Horizon", "Northstar", "Vista", "Summit"],
};

function hashSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number) {
  let state = seed || 1;
  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return ((state >>> 0) / 4294967296);
  };
}

function pick<T>(items: T[], random: () => number) {
  return items[Math.floor(random() * items.length) % items.length];
}

function uniqueName(name: string) {
  return name
    .replace(/\s+/g, " ")
    .replace(/\b(Benefits) Benefits\b/g, "$1")
    .replace(/\b(Coverage) Coverage\b/g, "$1")
    .trim();
}

function buildSuggestions(identity: BusinessIdentity, generation: number) {
  const state = identity.state.trim().toUpperCase();
  const random = seededRandom(hashSeed(`${identity.leadFocus}|${identity.stylePreference}|${state}|${generation}`));
  const statePool = STATE_PREFIXES[state] || [];
  const prefixPool = [
    ...statePool,
    ...(STYLE_PREFIXES[identity.stylePreference] || []),
    ...(LEAD_FOCUS_WORDS[identity.leadFocus] || []),
    ...GENERAL_PREFIXES,
  ];
  const trustPool = [
    ...(LEAD_FOCUS_WORDS[identity.leadFocus] || []),
    ...TRUST_WORDS,
  ];

  const names = new Set<string>();
  let guard = 0;
  while (names.size < 8 && guard < 80) {
    guard++;
    const prefix = pick(prefixPool, random);
    const trust = pick(trustPool, random);
    const suffix = pick(SUFFIXES, random);
    const pattern = Math.floor(random() * 5);
    const name =
      pattern === 0 ? `${prefix} ${trust} ${suffix}` :
      pattern === 1 ? `${prefix} ${suffix}` :
      pattern === 2 ? `${trust} ${prefix} ${suffix}` :
      pattern === 3 ? `${prefix} ${trust} Group` :
      `${prefix} ${trust} Advisors`;
    names.add(uniqueName(name));
  }

  return Array.from(names);
}

export default function BusinessIdentityStep({ value, onChange }: BusinessIdentityStepProps) {
  const [generation, setGeneration] = useState(0);
  const update = (patch: Partial<BusinessIdentity>) => onChange({ ...value, ...patch });
  const suggestions = useMemo(() => buildSuggestions(value, generation), [value, generation]);

  return (
    <section className="rounded-3xl border border-white/10 bg-[#0f172a] p-5 shadow-2xl shadow-black/20 sm:p-7">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Step 2</p>
          <h2 className="mt-1 text-2xl font-bold text-white">Choose your business identity</h2>
          <p className="mt-2 text-sm leading-6 text-gray-400">
            Pick a business page name that feels real, local, and trustworthy. These suggestions are generated from your focus, state, and style.
          </p>
        </div>
        <div className="rounded-2xl border border-blue-500/20 bg-blue-950/20 px-4 py-3 text-xs leading-5 text-blue-100 lg:max-w-sm">
          Best names sound like a professional insurance presence, not an official agency or government program.
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_0.8fr_0.55fr_0.65fr]">
        <label className="block">
          <span className="text-xs font-medium text-gray-400">Business name</span>
          <input
            value={value.businessName}
            onChange={(event) => update({ businessName: event.target.value })}
            placeholder="Example: Desert Valley Coverage"
            className="mt-1 w-full rounded-xl border border-white/10 bg-[#111827] px-3 py-3 text-sm text-white outline-none transition placeholder:text-gray-600 focus:border-blue-500"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-gray-400">Lead focus</span>
          <select
            value={value.leadFocus}
            onChange={(event) => update({ leadFocus: event.target.value })}
            className="mt-1 w-full rounded-xl border border-white/10 bg-[#111827] px-3 py-3 text-sm text-white outline-none transition focus:border-blue-500"
          >
            {LEAD_FOCUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-gray-400">State</span>
          <input
            value={value.state}
            onChange={(event) => update({ state: event.target.value.toUpperCase().slice(0, 2) })}
            placeholder="AZ"
            className="mt-1 w-full rounded-xl border border-white/10 bg-[#111827] px-3 py-3 text-sm uppercase text-white outline-none transition placeholder:text-gray-600 focus:border-blue-500"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-gray-400">Style</span>
          <select
            value={value.stylePreference}
            onChange={(event) => update({ stylePreference: event.target.value })}
            className="mt-1 w-full rounded-xl border border-white/10 bg-[#111827] px-3 py-3 text-sm text-white outline-none transition focus:border-blue-500"
          >
            {STYLE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-white">Suggested business page names</p>
            <p className="mt-1 text-xs text-gray-400">Tap one to use it. Regenerate if you want a different feel.</p>
          </div>
          <button
            type="button"
            onClick={() => setGeneration((current) => current + 1)}
            className="min-h-10 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-gray-200 transition hover:bg-white/10"
          >
            Regenerate names
          </button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {suggestions.map((name) => {
            const selected = value.businessName.trim().toLowerCase() === name.toLowerCase();
            return (
              <button
                key={name}
                type="button"
                onClick={() => update({ businessName: name })}
                className={`min-h-16 rounded-2xl border px-3 py-3 text-left text-sm font-semibold transition ${
                  selected
                    ? "border-emerald-400 bg-emerald-500/15 text-white shadow-lg shadow-emerald-950/30"
                    : "border-white/10 bg-[#111827] text-gray-200 hover:border-blue-400/60 hover:bg-blue-950/20"
                }`}
              >
                {name}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
