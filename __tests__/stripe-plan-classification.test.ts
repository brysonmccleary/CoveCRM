import {
  findActiveCrmPlanSubscription,
  isPhoneNumberSubscription,
} from "@/lib/billing/stripePlanClassification";

const env = {
  CoveCRM_Base: "price_base",
  CoveCRM_AI_Plan: "price_ai",
  STRIPE_PHONE_PRICE_ID: "price_phone",
  LEGACY_AI_GRANDFATHER_PRICE_IDS: "price_legacy_program",
} as NodeJS.ProcessEnv;

describe("Stripe CRM plan classification", () => {
  test("ignores active phone-number subscriptions and selects the legacy CRM plan", () => {
    const phone = {
      id: "sub_phone",
      status: "active",
      items: { data: [{ price: { id: "price_phone" } }] },
    };
    const legacyPlan = {
      id: "sub_legacy",
      status: "active",
      items: { data: [{ price: { id: "price_legacy_program" } }] },
    };

    expect(isPhoneNumberSubscription(phone, env)).toBe(true);
    expect(findActiveCrmPlanSubscription([phone, phone, legacyPlan], env)).toBe(legacyPlan);
  });

  test("does not treat an expired CRM checkout as an active plan", () => {
    expect(findActiveCrmPlanSubscription([
      {
        status: "incomplete_expired",
        items: { data: [{ price: { id: "price_base" } }] },
      },
    ], env)).toBeUndefined();
  });

  test("uses phone subscription metadata even if its price configuration changes", () => {
    expect(isPhoneNumberSubscription({
      status: "active",
      metadata: { purpose: "phone_number" },
      items: { data: [{ price: { id: "price_unknown" } }] },
    }, env)).toBe(true);
  });
});
