import {
  buildStructuredLeadFields,
  orderedStructuredLeadEntries,
} from "@/lib/leads/structuredLeadFields";
import { renderNewLeadNotificationEmail } from "@/lib/email";

describe("structured lead fields", () => {
  it("maps every veteran answer into agent-facing fields and excludes consent", () => {
    const fields = buildStructuredLeadFields({
      leadType: "veteran",
      selectedOption: "$25k - $50k",
      answers: {
        militaryStatus: "Veteran",
        militaryBranch: "Marines",
        maritalStatus: "Married",
        coverage: "$25k - $50k",
        dob: "1975-06-12",
        bestTime: "Afternoon",
        state: "AZ",
        smsConsentGiven: "yes",
        smsConsentText: "long compliance disclosure",
      },
    });

    expect(fields).toEqual({
      DOB: "1975-06-12",
      "Requested Coverage": "$25k - $50k",
      "Marital Status": "Married",
      "Military Status": "Veteran",
      "Military Branch": "Marines",
      "Best Time To Call": "Afternoon",
    });
  });

  it("keeps mortgage, final-expense, trucker, and IUL answers in their own fields", () => {
    expect(buildStructuredLeadFields({
      leadType: "mortgage_protection",
      selectedOption: "$250k - $500k",
      answers: {
        mortgageAmount: "$250k - $500k",
        beneficiary: "Spouse",
        healthIssues: "No major issues",
        whyInterested: "Protect my family",
      },
    })).toEqual({
      "Mortgage Balance": "$250k - $500k",
      Beneficiary: "Spouse",
      "Health Issues": "No major issues",
      "Why Interested": "Protect my family",
    });

    expect(buildStructuredLeadFields({
      leadType: "trucker",
      answers: { cdlStatus: "Yes", maritalStatus: "Have children", coverage: "$100k" },
    })).toEqual({
      "Requested Coverage": "$100k",
      "Marital Status": "Have children",
      "CDL Status": "Yes",
    });

    expect(buildStructuredLeadFields({
      leadType: "iul",
      answers: {
        householdIncome: "$75k - $150k",
        currentCoverage: "Under $100k",
        reasonInterested: "Retirement planning",
      },
    })).toEqual({
      "Household Income": "$75k - $150k",
      "Current Coverage": "Under $100k",
      "Reason Interested": "Retirement planning",
    });
  });

  it("preserves future custom questions without exposing tracking data", () => {
    const fields = buildStructuredLeadFields({
      answers: {
        tobaccoUse: "No",
        preferred_language: "Spanish",
        metaCampaignId: "internal",
        utm_source: "facebook",
      },
    });

    expect(fields).toEqual({
      "Tobacco Use": "No",
      "Preferred Language": "Spanish",
    });
    expect(orderedStructuredLeadEntries(fields)).toEqual([
      ["Preferred Language", "Spanish"],
      ["Tobacco Use", "No"],
    ]);
  });
});

describe("new lead email", () => {
  it("shows the useful lead summary without internal Meta fields", () => {
    const html = renderNewLeadNotificationEmail({
      leadName: "Bryson Testing",
      leadPhone: "623-385-2820",
      leadEmail: "lead@example.com",
      state: "AZ",
      leadType: "Veteran",
      campaignName: "General Veteran Leads",
      details: {
        DOB: "1997-12-01",
        "Requested Coverage": "$10k - $25k",
        "Marital Status": "Single",
        "Military Branch": "Marines",
        metaCampaignId: "120251599554080306",
      },
      leadUrl: "https://www.covecrm.com/lead/lead-1",
    });

    expect(html).toContain("NEW LEAD");
    expect(html).toContain("Bryson Testing");
    expect(html).toContain("1997-12-01");
    expect(html).toContain("Requested Coverage");
    expect(html).toContain("$10k - $25k");
    expect(html).toContain("Military Branch");
    expect(html).not.toContain("120251599554080306");
  });
});
