import {
  generateWinningVariantList,
  getWinningFamiliesByLeadType,
} from "../lib/facebook/winningAdLibrary";
import { getFunnelTemplate } from "../lib/facebook/funnels/funnelTemplates";

const campaignTypes = ["final_expense", "mortgage_protection", "iul"] as const;
let failures = 0;

function check(name: string, condition: unknown) {
  const passed = Boolean(condition);
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
  if (!passed) failures += 1;
}

for (const leadType of campaignTypes) {
  const families = getWinningFamiliesByLeadType(leadType, "spanish");
  check(`${leadType}: three Spanish ad families`, families.length >= 3);
  check(`${leadType}: Spanish families are research-backed`, families.every((family) => family.vendorStyleTag === "spanish_market_research"));

  const variants = generateWinningVariantList({
    leadType,
    audienceSegment: "spanish",
    userId: "spanish-campaign-verification",
    campaignName: `Spanish verification ${leadType}`,
    variantCount: 3,
  });
  check(`${leadType}: generates three distinct creatives`, variants.length === 3 && new Set(variants.map((item) => item.familyId)).size === 3);
  check(`${leadType}: creatives preserve Spanish audience`, variants.every((item) => item.audienceSegment === "spanish"));
  check(`${leadType}: creative copy is populated`, variants.every((item) => item.primaryText && item.headline && item.cta));

  const template = getFunnelTemplate(leadType, "spanish");
  const required = new Set(template.steps.filter((step) => step.required).map((step) => step.id));
  check(`${leadType}: Spanish hosted funnel is selected`, template.locale === "es");
  check(`${leadType}: Spanish funnel captures a complete lead`, ["state", "firstName", "lastName", "email", "phone", "consent"].every((id) => required.has(id)));
}

if (failures) process.exit(1);
console.log("Spanish campaign verification passed.");
