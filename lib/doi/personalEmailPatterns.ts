// lib/doi/personalEmailPatterns.ts
// Generates candidate personal emails for DOI agents based on names and context.

const PERSONAL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
  "protonmail.com",
];

const YEAR_SUFFIXES = ["1970", "1975", "1980", "1985", "1990", "1995", "1999"];
const KEYWORDS = ["ins", "agent", "life"];

type AgentLike = {
  firstName?: string | null;
  lastName?: string | null;
  state?: string | null;
  city?: string | null;
};

export type PersonalEmailCandidate = {
  email: string;
  label: string;
  confidence: number;
};

const slug = (value?: string | null) => (value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function generatePersonalEmailCandidates(agent: AgentLike): PersonalEmailCandidate[] {
  const first = slug(agent.firstName);
  const last = slug(agent.lastName);
  const state = slug(agent.state);
  const city = slug(agent.city);

  if (!first && !last) return [];

  const base = first && last ? `${first}${last}` : first || last;
  const initials = first && last ? `${first.charAt(0)}${last}` : "";
  const candidates = new Map<string, PersonalEmailCandidate>();

  const addCandidate = (localPart: string, domain: string, label: string, confidence = 60) => {
    if (!localPart) return;
    const email = `${localPart}@${domain}`;
    if (candidates.has(email)) return;
    candidates.set(email, { email, label, confidence });
  };

  const addCommonPatterns = (domain: string) => {
    addCandidate(base, domain, `personal:${domain}:firstlast`, 65);
    addCandidate(`${first}.${last}`.replace(/\.+/g, "."), domain, `personal:${domain}:first.last`, 65);
    addCandidate(`${first}_${last}`, domain, `personal:${domain}:first_last`, 63);
    addCandidate(initials, domain, `personal:${domain}:flast`, 60);
    addCandidate(`${first}${last?.charAt(0) || ""}`, domain, `personal:${domain}:firstl`, 58);
    addCandidate(`${last}${first}`, domain, `personal:${domain}:lastfirst`, 58);
    if (state) addCandidate(`${base}${state}`, domain, `personal:${domain}:state`, 70);
    KEYWORDS.forEach((kw) => addCandidate(`${base}${kw}`, domain, `personal:${domain}:${kw}`, 68));
    YEAR_SUFFIXES.forEach((yr) => addCandidate(`${base}${yr}`, domain, `personal:${domain}:year`, 55));
    addCandidate(`${base}1`, domain, `personal:${domain}:num1`, 55);
    addCandidate(`${base}01`, domain, `personal:${domain}:num01`, 55);
    if (city) addCandidate(`${base}${city}`, domain, `personal:${domain}:city`, 62);
  };

  PERSONAL_DOMAINS.forEach((domain) => addCommonPatterns(domain));

  return Array.from(candidates.values()).filter((candidate) => candidate.email.includes("@"));
}
