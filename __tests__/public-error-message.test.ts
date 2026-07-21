import { publicErrorMessage } from "@/lib/publicErrorMessage";

describe("publicErrorMessage", () => {
  const fallback = "Something went wrong. Please try again.";

  test.each([
    "Missing required env var: CoveCRM_Base",
    "No such customer: cus_123",
    "MongoDB ECONNREFUSED",
    "TypeError: undefined is not a function",
  ])("hides technical details from customers: %s", (message) => {
    expect(publicErrorMessage(message, fallback)).toBe(fallback);
  });

  test("preserves clear customer-facing guidance", () => {
    expect(publicErrorMessage("Please add a payment method before upgrading.", fallback))
      .toBe("Please add a payment method before upgrading.");
  });
});
