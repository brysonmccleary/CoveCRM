export type FunnelStep =
  | {
      id: string;
      title: string;
      subtitle?: string;
      type: "choice";
      options: string[];
      required?: boolean;
    }
  | {
      id: string;
      title: string;
      subtitle?: string;
      type: "text" | "email" | "tel" | "number" | "date" | "state";
      placeholder?: string;
      required?: boolean;
    }
  | {
      id: string;
      title: string;
      subtitle?: string;
      type: "contact";
      required?: boolean;
    };

export type FunnelTemplate = {
  leadType: string;
  theme: {
    bg: string;
    panel: string;
    text: string;
    muted: string;
    accent: string;
    button: string;
    buttonText: string;
  };
  eyebrow: string;
  defaultHeadline: string;
  defaultSubheadline: string;
  reassurance: string[];
  steps: FunnelStep[];
};

export const FUNNEL_TEMPLATES: Record<string, FunnelTemplate> = {
  mortgage_protection: {
    leadType: "mortgage_protection",
    theme: {
      bg: "#f8fbff",
      panel: "#ffffff",
      text: "#102033",
      muted: "#52657a",
      accent: "#2563eb",
      button: "#2563eb",
      buttonText: "#ffffff",
    },
    eyebrow: "Mortgage Protection Review",
    defaultHeadline: "See mortgage protection options for your family",
    defaultSubheadline: "Answer a few quick questions so a licensed agent can review options for your state.",
    reassurance: ["Trusted by thousands of families", "No obligation", "State-specific review"],
    steps: [
      { id: "state", type: "state", title: "What state do you live in?", required: true },
      { id: "mortgageAmount", type: "choice", title: "About how much do you owe on your mortgage?", options: ["Under $100k", "$100k - $250k", "$250k - $500k", "$500k+"], required: true },
      { id: "beneficiary", type: "choice", title: "Who would you want protected?", options: ["Spouse", "Children", "Family", "Other"], required: true },
      { id: "healthIssues", type: "choice", title: "Any major health issues?", subtitle: "This helps the agent review realistic options.", options: ["No major issues", "Some health concerns", "Prefer to discuss"], required: true },
      { id: "age", type: "number", title: "How old are you?", placeholder: "Age", required: true },
      { id: "whyInterested", type: "choice", title: "Why are you interested in mortgage protection?", options: ["Protect my family", "Cover the mortgage", "Compare options", "New homeowner"], required: true },
      { id: "firstName", type: "text", title: "What is your first name?", placeholder: "First name", required: true },
      { id: "lastName", type: "text", title: "What is your last name?", placeholder: "Last name", required: true },
      { id: "email", type: "email", title: "What is your email address?", placeholder: "Email address", required: true },
      { id: "phone", type: "tel", title: "What is your phone number?", placeholder: "Phone number", required: true },
      { id: "consent", type: "choice", title: "Can a licensed agent contact you about your review?", options: ["Yes, I agree"], required: true },
    ],
  },
  veteran: {
    leadType: "veteran",
    theme: {
      bg: "#ffffff",
      panel: "#ffffff",
      text: "#172033",
      muted: "#5b6472",
      accent: "#b91c1c",
      button: "#b91c1c",
      buttonText: "#ffffff",
    },
    eyebrow: "Private Coverage Review",
    defaultHeadline: "Veterans and families can review private coverage options",
    defaultSubheadline: "Respectful, private-market options. Not affiliated with the VA or any government agency.",
    reassurance: ["Private coverage review", "Respectful qualification flow", "No government endorsement implied"],
    steps: [
      { id: "militaryStatus", type: "choice", title: "What best describes you?", options: ["Veteran", "Spouse", "Dependent", "Active duty"], required: true },
      { id: "militaryBranch", type: "choice", title: "Branch of service", options: ["Army", "Navy", "Air Force", "Marines", "Coast Guard", "Space Force", "Other"], required: true },
      { id: "maritalStatus", type: "choice", title: "Marital status", options: ["Married", "Single", "Widowed", "Divorced"], required: true },
      { id: "coverage", type: "choice", title: "How much coverage do you need?", options: ["$10k - $25k", "$25k - $50k", "$50k - $100k", "$100k+"], required: true },
      { id: "dob", type: "date", title: "Date of birth", required: true },
      { id: "state", type: "state", title: "What state do you live in?", required: true },
      { id: "bestTime", type: "choice", title: "Best time to review plans?", options: ["Morning", "Afternoon", "Evening", "Anytime"], required: true },
      { id: "firstName", type: "text", title: "What is your first name?", placeholder: "First name", required: true },
      { id: "lastName", type: "text", title: "What is your last name?", placeholder: "Last name", required: true },
      { id: "email", type: "email", title: "What is your email address?", placeholder: "Email address", required: true },
      { id: "phone", type: "tel", title: "What is your phone number?", placeholder: "Phone number", required: true },
      { id: "consent", type: "choice", title: "Can a licensed agent contact you about your review?", options: ["Yes, I agree"], required: true },
    ],
  },
  final_expense: {
    leadType: "final_expense",
    theme: {
      bg: "#0f0e0a",
      panel: "#18140d",
      text: "#fff8dc",
      muted: "#f2d992",
      accent: "#d4a017",
      button: "#ca8a04",
      buttonText: "#ffffff",
    },
    eyebrow: "Final Expense Review",
    defaultHeadline: "Help protect your family from final expenses",
    defaultSubheadline: "Simple senior-friendly review with no obligation.",
    reassurance: ["Senior-friendly", "Family protection focus", "Licensed agent review"],
    steps: [
      { id: "age", type: "number", title: "How old are you?", placeholder: "Age", required: true },
      { id: "beneficiary", type: "choice", title: "Who would the policy help protect?", options: ["Spouse", "Children", "Family", "Other"], required: true },
      { id: "healthIssues", type: "choice", title: "Any major health issues?", options: ["No major issues", "Some health concerns", "Prefer to discuss"], required: true },
      { id: "coverage", type: "choice", title: "Desired coverage amount", options: ["$5k - $10k", "$10k - $25k", "$25k - $50k", "$50k+"], required: true },
      { id: "state", type: "state", title: "What state do you live in?", required: true },
      { id: "bestTime", type: "choice", title: "Best time to contact you?", options: ["Morning", "Afternoon", "Evening", "Anytime"], required: true },
      { id: "firstName", type: "text", title: "What is your first name?", placeholder: "First name", required: true },
      { id: "lastName", type: "text", title: "What is your last name?", placeholder: "Last name", required: true },
      { id: "email", type: "email", title: "What is your email address?", placeholder: "Email address", required: true },
      { id: "phone", type: "tel", title: "What is your phone number?", placeholder: "Phone number", required: true },
      { id: "consent", type: "choice", title: "Can a licensed agent contact you about your review?", options: ["Yes, I agree"], required: true },
    ],
  },
  trucker: {
    leadType: "trucker",
    theme: {
      bg: "#f8fafc",
      panel: "#ffffff",
      text: "#122033",
      muted: "#52657a",
      accent: "#b91c1c",
      button: "#1d4ed8",
      buttonText: "#ffffff",
    },
    eyebrow: "CDL Driver Coverage Review",
    defaultHeadline: "Coverage options for truck drivers and families",
    defaultSubheadline: "Simple review built for busy drivers.",
    reassurance: ["CDL-friendly questions", "Fast review", "Family-security angle"],
    steps: [
      { id: "cdlStatus", type: "choice", title: "Do you currently have a CDL?", options: ["Yes", "No", "In progress"], required: true },
      { id: "age", type: "number", title: "How old are you?", placeholder: "Age", required: true },
      { id: "state", type: "state", title: "What state do you live in?", required: true },
      { id: "maritalStatus", type: "choice", title: "Family status", options: ["Married", "Single", "Have children", "Other"], required: true },
      { id: "coverage", type: "choice", title: "Desired coverage", options: ["$25k", "$50k", "$100k", "$250k+"], required: true },
      { id: "bestTime", type: "choice", title: "Best time to contact you?", options: ["Morning", "Afternoon", "Evening", "Anytime"], required: true },
      { id: "firstName", type: "text", title: "What is your first name?", placeholder: "First name", required: true },
      { id: "lastName", type: "text", title: "What is your last name?", placeholder: "Last name", required: true },
      { id: "email", type: "email", title: "What is your email address?", placeholder: "Email address", required: true },
      { id: "phone", type: "tel", title: "What is your phone number?", placeholder: "Phone number", required: true },
      { id: "consent", type: "choice", title: "Can a licensed agent contact you about your review?", options: ["Yes, I agree"], required: true },
    ],
  },
  iul: {
    leadType: "iul",
    theme: {
      bg: "#f8fbff",
      panel: "#ffffff",
      text: "#122033",
      muted: "#52657a",
      accent: "#1d4ed8",
      button: "#1d4ed8",
      buttonText: "#ffffff",
    },
    eyebrow: "IUL Education Review",
    defaultHeadline: "Explore IUL options with a licensed professional",
    defaultSubheadline: "Educational review only. No hype, no guarantees.",
    reassurance: ["Educational tone", "Protection and planning", "Licensed review"],
    steps: [
      { id: "age", type: "number", title: "How old are you?", placeholder: "Age", required: true },
      { id: "state", type: "state", title: "What state do you live in?", required: true },
      { id: "householdIncome", type: "choice", title: "Household income range", options: ["Under $75k", "$75k - $150k", "$150k - $250k", "$250k+"], required: true },
      { id: "currentCoverage", type: "choice", title: "Current coverage amount", options: ["None", "Under $100k", "$100k - $500k", "$500k+"], required: true },
      { id: "reasonInterested", type: "choice", title: "What interests you most?", options: ["Protection", "Cash value education", "Retirement planning", "Legacy planning"], required: true },
      { id: "bestTime", type: "choice", title: "Best time to contact you?", options: ["Morning", "Afternoon", "Evening", "Anytime"], required: true },
      { id: "firstName", type: "text", title: "What is your first name?", placeholder: "First name", required: true },
      { id: "lastName", type: "text", title: "What is your last name?", placeholder: "Last name", required: true },
      { id: "email", type: "email", title: "What is your email address?", placeholder: "Email address", required: true },
      { id: "phone", type: "tel", title: "What is your phone number?", placeholder: "Phone number", required: true },
      { id: "consent", type: "choice", title: "Can a licensed agent contact you about your review?", options: ["Yes, I agree"], required: true },
    ],
  },
  mortgage_protection_veteran: {
    leadType: "mortgage_protection",
    theme: {
      bg: "#0a0e1a",
      panel: "#111827",
      text: "#f0f4ff",
      muted: "#94a3b8",
      accent: "#b91c1c",
      button: "#b91c1c",
      buttonText: "#ffffff",
    },
    eyebrow: "Veteran Mortgage Protection Review",
    defaultHeadline: "Protect your family's home — built for those who served",
    defaultSubheadline: "Private-market mortgage protection for veterans. Not affiliated with the VA.",
    reassurance: ["Built for veterans", "Private market — not VA", "Licensed agent review"],
    steps: [
      { id: "militaryStatus", type: "choice", title: "What best describes you?", options: ["Veteran", "Spouse of veteran", "Dependent", "Active duty"], required: true },
      { id: "militaryBranch", type: "choice", title: "Branch of service", options: ["Army", "Navy", "Air Force", "Marines", "Coast Guard", "Space Force", "Other"], required: true },
      { id: "mortgageAmount", type: "choice", title: "About how much do you owe on your mortgage?", options: ["Under $100k", "$100k - $250k", "$250k - $500k", "$500k+"], required: true },
      { id: "beneficiary", type: "choice", title: "Who would you want protected?", options: ["Spouse", "Children", "Family", "Other"], required: true },
      { id: "healthIssues", type: "choice", title: "Any major health issues?", options: ["No major issues", "Some health concerns", "Prefer to discuss"], required: true },
      { id: "age", type: "number", title: "How old are you?", placeholder: "Age", required: true },
      { id: "state", type: "state", title: "What state do you live in?", required: true },
      { id: "bestTime", type: "choice", title: "Best time to review plans?", options: ["Morning", "Afternoon", "Evening", "Anytime"], required: true },
      { id: "firstName", type: "text", title: "What is your first name?", placeholder: "First name", required: true },
      { id: "lastName", type: "text", title: "What is your last name?", placeholder: "Last name", required: true },
      { id: "email", type: "email", title: "What is your email address?", placeholder: "Email address", required: true },
      { id: "phone", type: "tel", title: "What is your phone number?", placeholder: "Phone number", required: true },
      { id: "consent", type: "choice", title: "Can a licensed agent contact you about your review?", options: ["Yes, I agree"], required: true },
    ],
  },
  iul_veteran: {
    leadType: "iul",
    theme: {
      bg: "#0a0e1a",
      panel: "#111827",
      text: "#f0f4ff",
      muted: "#94a3b8",
      accent: "#1d4ed8",
      button: "#1d4ed8",
      buttonText: "#ffffff",
    },
    eyebrow: "Veteran IUL Review",
    defaultHeadline: "IUL options designed to honor your service and secure your legacy",
    defaultSubheadline: "Educational review only. Licensed professional. Not affiliated with the VA.",
    reassurance: ["Built for veterans", "Legacy and retirement planning", "Licensed review"],
    steps: [
      { id: "militaryStatus", type: "choice", title: "What best describes you?", options: ["Veteran", "Spouse of veteran", "Active duty", "Other"], required: true },
      { id: "militaryBranch", type: "choice", title: "Branch of service", options: ["Army", "Navy", "Air Force", "Marines", "Coast Guard", "Space Force", "Other"], required: true },
      { id: "age", type: "number", title: "How old are you?", placeholder: "Age", required: true },
      { id: "state", type: "state", title: "What state do you live in?", required: true },
      { id: "householdIncome", type: "choice", title: "Household income range", options: ["Under $75k", "$75k - $150k", "$150k - $250k", "$250k+"], required: true },
      { id: "reasonInterested", type: "choice", title: "What interests you most?", options: ["Legacy planning", "Retirement income", "Cash value growth", "Protection for family"], required: true },
      { id: "bestTime", type: "choice", title: "Best time to review plans?", options: ["Morning", "Afternoon", "Evening", "Anytime"], required: true },
      { id: "firstName", type: "text", title: "What is your first name?", placeholder: "First name", required: true },
      { id: "lastName", type: "text", title: "What is your last name?", placeholder: "Last name", required: true },
      { id: "email", type: "email", title: "What is your email address?", placeholder: "Email address", required: true },
      { id: "phone", type: "tel", title: "What is your phone number?", placeholder: "Phone number", required: true },
      { id: "consent", type: "choice", title: "Can a licensed agent contact you about your review?", options: ["Yes, I agree"], required: true },
    ],
  },
  mortgage_protection_trucker: {
    leadType: "mortgage_protection",
    theme: {
      bg: "#f8fafc",
      panel: "#ffffff",
      text: "#122033",
      muted: "#52657a",
      accent: "#b91c1c",
      button: "#1d4ed8",
      buttonText: "#ffffff",
    },
    eyebrow: "Trucker Mortgage Protection Review",
    defaultHeadline: "Protect your family's home — built for CDL drivers",
    defaultSubheadline: "Simple mortgage protection review for truck drivers and their families.",
    reassurance: ["CDL-friendly questions", "Family home protection", "Licensed agent review"],
    steps: [
      { id: "cdlStatus", type: "choice", title: "Do you currently have a CDL?", options: ["Yes", "No", "In progress"], required: true },
      { id: "mortgageAmount", type: "choice", title: "About how much do you owe on your mortgage?", options: ["Under $100k", "$100k - $250k", "$250k - $500k", "$500k+"], required: true },
      { id: "beneficiary", type: "choice", title: "Who would you want protected?", options: ["Spouse", "Children", "Family", "Other"], required: true },
      { id: "healthIssues", type: "choice", title: "Any major health issues?", options: ["No major issues", "Some health concerns", "Prefer to discuss"], required: true },
      { id: "age", type: "number", title: "How old are you?", placeholder: "Age", required: true },
      { id: "state", type: "state", title: "What state do you live in?", required: true },
      { id: "bestTime", type: "choice", title: "Best time to reach you?", options: ["Morning", "Afternoon", "Evening", "Anytime"], required: true },
      { id: "firstName", type: "text", title: "What is your first name?", placeholder: "First name", required: true },
      { id: "lastName", type: "text", title: "What is your last name?", placeholder: "Last name", required: true },
      { id: "email", type: "email", title: "What is your email address?", placeholder: "Email address", required: true },
      { id: "phone", type: "tel", title: "What is your phone number?", placeholder: "Phone number", required: true },
      { id: "consent", type: "choice", title: "Can a licensed agent contact you about your review?", options: ["Yes, I agree"], required: true },
    ],
  },
  iul_trucker: {
    leadType: "iul",
    theme: {
      bg: "#f8fafc",
      panel: "#ffffff",
      text: "#122033",
      muted: "#52657a",
      accent: "#1d4ed8",
      button: "#1d4ed8",
      buttonText: "#ffffff",
    },
    eyebrow: "Trucker IUL Review",
    defaultHeadline: "Build cash value while you haul — IUL options for CDL drivers",
    defaultSubheadline: "Educational IUL review built for truck drivers and families.",
    reassurance: ["Built for CDL drivers", "Cash value and protection", "Licensed review"],
    steps: [
      { id: "cdlStatus", type: "choice", title: "Do you currently have a CDL?", options: ["Yes", "No", "In progress"], required: true },
      { id: "age", type: "number", title: "How old are you?", placeholder: "Age", required: true },
      { id: "state", type: "state", title: "What state do you live in?", required: true },
      { id: "householdIncome", type: "choice", title: "Household income range", options: ["Under $75k", "$75k - $150k", "$150k - $250k", "$250k+"], required: true },
      { id: "reasonInterested", type: "choice", title: "What interests you most?", options: ["Cash value growth", "Retirement income", "Protection for family", "Legacy planning"], required: true },
      { id: "bestTime", type: "choice", title: "Best time to reach you?", options: ["Morning", "Afternoon", "Evening", "Anytime"], required: true },
      { id: "firstName", type: "text", title: "What is your first name?", placeholder: "First name", required: true },
      { id: "lastName", type: "text", title: "What is your last name?", placeholder: "Last name", required: true },
      { id: "email", type: "email", title: "What is your email address?", placeholder: "Email address", required: true },
      { id: "phone", type: "tel", title: "What is your phone number?", placeholder: "Phone number", required: true },
      { id: "consent", type: "choice", title: "Can a licensed agent contact you about your review?", options: ["Yes, I agree"], required: true },
    ],
  },
};

export function getFunnelTemplate(leadType: string, audienceSegment?: string): FunnelTemplate {
  const compositeKey =
    audienceSegment && audienceSegment !== "standard"
      ? `${leadType}_${audienceSegment}`
      : leadType;
  return FUNNEL_TEMPLATES[compositeKey] || FUNNEL_TEMPLATES[leadType] || FUNNEL_TEMPLATES.mortgage_protection;
}
