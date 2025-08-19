// /pages/billing.tsx
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import toast from "react-hot-toast";
import { loadStripe } from "@stripe/stripe-js";
import type { StripeElementsOptions } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import CheckoutForm from "@/components/CheckoutForm";

// Optional DOM cleanup you had — keep safe
if (typeof window !== "undefined") {
  const observer = new MutationObserver(() => {
    // Safer text match (no :has-text selector in browsers)
    const btns = Array.from(document.querySelectorAll("button"));
    const toRemove = btns.find((b) =>
      (b.textContent || "").toLowerCase().includes("ask assistant"),
    );
    if (toRemove) toRemove.remove();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

const STRIPE_PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!;
const stripePromise = loadStripe(STRIPE_PK);

// Where to land after Stripe (and after zero-amount auto-success)
const RETURN_PATH =
  (process.env.NEXT_PUBLIC_BASE_URL
    ? `${process.env.NEXT_PUBLIC_BASE_URL}${
        process.env.AFFILIATE_RETURN_PATH || "/dashboard?tab=settings"
      }`
    : null) || "/dashboard?tab=settings";

export default function BillingPage() {
  const router = useRouter();
  const { email, ai, affiliateEmail, promoCode } = router.query;

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Display data coming back from the server
  const [discount, setDiscount] = useState<string | undefined>();
  const [totalBefore, setTotalBefore] = useState<number | null>(null);
  const [totalAfter, setTotalAfter] = useState<number | null>(null);

  // Helper to coerce query values
  const aiUpgrade = useMemo(() => {
    const v = Array.isArray(ai) ? ai[0] : ai;
    return v === "1" || v === "true";
  }, [ai]);

  const emailStr = useMemo(
    () => (Array.isArray(email) ? email[0] : email) || "",
    [email],
  );
  const affiliateEmailStr = useMemo(
    () =>
      (Array.isArray(affiliateEmail) ? affiliateEmail[0] : affiliateEmail) ||
      "",
    [affiliateEmail],
  );
  const promoCodeStr = useMemo(
    () => (Array.isArray(promoCode) ? promoCode[0] : promoCode) || "",
    [promoCode],
  );

  useEffect(() => {
    // Wait until we have email (required by your API)
    if (!emailStr) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/create-subscription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: emailStr,
            aiUpgrade,
            affiliateEmail: affiliateEmailStr || undefined,
            promoCode: promoCodeStr || undefined, // server treats empty as "no code"
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(
            data?.error || data?.message || "Subscription failed",
          );
        }

        if (cancelled) return;

        setClientSecret(data.clientSecret ?? null);
        setSubscriptionId(data.subscriptionId ?? null);

        // Optional UI info
        if (typeof data.discount === "string") setDiscount(data.discount);
        if (typeof data.totalBeforeDiscount === "number")
          setTotalBefore(data.totalBeforeDiscount);
        if (typeof data.totalAfterDiscount === "number")
          setTotalAfter(data.totalAfterDiscount);

        // If clientSecret is null, Stripe made a $0 invoice: auto-success → redirect
        if (!data.clientSecret) {
          toast.success("Subscription started! Redirecting…");
          setTimeout(() => {
            if (typeof window !== "undefined")
              window.location.href = RETURN_PATH;
          }, 900);
        }
      } catch (err: any) {
        console.error("Error creating subscription:", err);
        toast.error(err?.message || "Failed to start subscription.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [emailStr, aiUpgrade, affiliateEmailStr, promoCodeStr]);

  const elementsOptions = useMemo<StripeElementsOptions | undefined>(
    () =>
      clientSecret
        ? {
            clientSecret,
            appearance: {
              // must be a string literal, not string
              labels: "floating" as const,
            },
          }
        : undefined,
    [clientSecret],
  );

  // Render
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-black px-4">
      <div className="max-w-2xl w-full p-6 bg-white dark:bg-gray-900 text-black dark:text-white shadow-xl rounded">
        <h1 className="text-3xl font-bold mb-6 text-center">Secure Billing</h1>

        {/* Loading */}
        {loading && (
          <p className="text-center text-gray-600 dark:text-gray-400">
            Initializing payment…
          </p>
        )}

        {/* Payment required */}
        {!loading && clientSecret && elementsOptions && (
          <>
            <div className="mb-4 text-center">
              {promoCodeStr && (
                <p className="text-green-600 dark:text-green-400 font-semibold">
                  Promo Code <span className="underline">{promoCodeStr}</span>{" "}
                  applied!
                </p>
              )}
              {discount && (
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Discount: <strong>{discount}</strong>
                </p>
              )}
              {totalBefore !== null && totalAfter !== null && (
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Total: <del>${totalBefore.toFixed(2)}</del> →{" "}
                  <span className="text-green-600 dark:text-green-400 font-bold">
                    ${totalAfter.toFixed(2)}
                  </span>
                </p>
              )}
            </div>

            <Elements stripe={stripePromise} options={elementsOptions}>
              <CheckoutForm
                email={emailStr}
                aiUpgrade={aiUpgrade}
                affiliateEmail={affiliateEmailStr}
                discount={discount}
                promoCode={promoCodeStr}
              />
            </Elements>
          </>
        )}

        {/* Zero-amount success path (no clientSecret) */}
        {!loading && !clientSecret && (
          <div className="text-center space-y-2">
            {promoCodeStr && (
              <p className="text-green-600 dark:text-green-400 font-semibold">
                Promo Code <span className="underline">{promoCodeStr}</span>{" "}
                applied!
              </p>
            )}
            {typeof totalBefore === "number" &&
            typeof totalAfter === "number" ? (
              <p className="text-sm text-gray-700 dark:text-gray-300">
                Total:{" "}
                {totalAfter === 0 && totalBefore > 0 ? (
                  <>
                    <del>${totalBefore.toFixed(2)}</del> →{" "}
                    <span className="text-green-600 dark:text-green-400 font-bold">
                      $0.00
                    </span>
                  </>
                ) : (
                  <>
                    <del>${totalBefore.toFixed(2)}</del> →{" "}
                    <span className="text-green-600 dark:text-green-400 font-bold">
                      ${totalAfter.toFixed(2)}
                    </span>
                  </>
                )}
              </p>
            ) : null}
            {subscriptionId && (
              <p className="text-xs text-gray-500">
                Subscription: {subscriptionId}
              </p>
            )}
            <p className="text-gray-700 dark:text-gray-300">
              Subscription started. Redirecting to your dashboard…
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
