import SmsConsentEvidence from "@/models/SmsConsentEvidence";
import FunnelSubmission from "@/models/FunnelSubmission";
import {
  buildHostedConsentText,
  buildHostedConsentEvidence,
  HOSTED_CONSENT_TEXT_VERSION,
} from "@/lib/facebook/hostedConsent";
import { scoreHostedLeadOnArrival } from "@/lib/facebook/hostedLeadScoring";

describe("hosted funnel compliance parity", () => {
  it("uses one frozen canonical consent disclosure on client and server", () => {
    expect(HOSTED_CONSENT_TEXT_VERSION).toBe("hosted-lead-generation-2026-04-v1");
    expect(buildHostedConsentText({
      agentName: "Alex Agent",
      businessName: "Cove Agency",
      leadType: "final_expense",
    })).toBe(
      "Yes, I agree to receive SMS messages from Alex Agent and Cove Agency about my Final Expense request. Messages may include quote discussions, appointment scheduling, application follow-up, customer support, and responses to my inquiry. Message frequency varies. Message and data rates may apply. Reply STOP to opt out. Reply HELP for help. I also agree that a licensed agent may contact me at the phone number I provide via telephone calls, including calls made using artificial or prerecorded voice and AI-assisted voice technology. By checking this box and submitting this form, I agree to the communications described above."
    );
  });

  it("marks consent evidence and raw submission fields immutable", () => {
    for (const path of ["consentGiven", "consentText", "consentTextVersion", "pageUrl", "ip", "submittedAt"]) {
      expect((SmsConsentEvidence.schema.path(path) as any).options.immutable).toBe(true);
    }
    for (const path of ["campaignId", "userEmail", "phone", "rawPayload", "wasDuplicate", "ipAddress"]) {
      expect((FunnelSubmission.schema.path(path) as any).options.immutable).toBe(true);
    }
  });

  it("builds a complete evidence record from server-owned values", () => {
    const submittedAt = new Date("2026-07-14T12:00:00Z");
    expect(buildHostedConsentEvidence({
      userId: "user-1", userEmail: "Agent@Example.com", firstName: " Sam ", lastName: " Smith ",
      phone: "6025550100", email: "Lead@Example.com", consentGiven: true,
      agentName: "Alex", businessName: "Cove", leadType: "final_expense",
      pageUrl: "https://covecrm.com/f/campaign-1", privacyUrl: "https://covecrm.com/privacy",
      termsUrl: "https://covecrm.com/terms", ip: "1.2.3.4", userAgent: "browser", submittedAt,
    })).toEqual(expect.objectContaining({
      userId: "user-1", userEmail: "agent@example.com", firstName: "Sam", lastName: "Smith",
      phone: "6025550100", email: "lead@example.com", consentGiven: true,
      consentTextVersion: HOSTED_CONSENT_TEXT_VERSION, submittedAt, ip: "1.2.3.4", userAgent: "browser",
      pageUrl: "https://covecrm.com/f/campaign-1", privacyUrl: "https://covecrm.com/privacy", termsUrl: "https://covecrm.com/terms",
    }));
  });

  it("scores hosted arrivals through the native Facebook realtime path", async () => {
    const scorer = jest.fn().mockResolvedValue({ score: 82 });
    await scoreHostedLeadOnArrival("lead-123", scorer as any);
    expect(scorer).toHaveBeenCalledWith("lead-123", "facebook_realtime");
  });
});
