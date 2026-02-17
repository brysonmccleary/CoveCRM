import { useEffect, useState } from "react";
import { useStripe, useElements, CardElement } from "@stripe/react-stripe-js";
import { useRouter } from "next/router";
import toast from "react-hot-toast";

interface CheckoutFormProps {
  email: string;
  aiUpgrade?: boolean;
  affiliateEmail?: string;
  promoCode?: string;
  discount?: string;

  // Trial support
  clientSecret?: string | null;
  mode?: "payment" | "setup";
  subscriptionId?: string | null;
}

export default function CheckoutForm({
  email,
  aiUpgrade,
  affiliateEmail,
  promoCode,
  discount,
  clientSecret,
  mode = "payment",
  subscriptionId,
}: CheckoutFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [cardBrand, setCardBrand] = useState<string>("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      toast.error("Stripe is not ready.");
      return;
    }

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      toast.error("Card element not found.");
      return;
    }

    setLoading(true);

    try {
      if (!clientSecret) {
        toast.error("Missing Stripe client secret.");
        return;
      }

      if (mode === "setup") {
        const { error, setupIntent } = await stripe.confirmCardSetup(
          clientSecret,
          {
            payment_method: {
              card: cardElement,
              billing_details: { email },
            },
          }
        );

        if (error) {
          toast.error(error.message || "Card setup failed.");
          return;
        }

        if (setupIntent?.status === "succeeded") {
          const pm = (setupIntent as any).payment_method;
          if (!pm) {
            toast.error("Card saved, but payment method missing.");
            return;
          }

          try {
            await fetch("/api/stripe/set-default-payment-method", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email,
                subscriptionId,
                paymentMethodId: pm,
              }),
            });
          } catch {
            // non-blocking
          }

          toast.success("✅ Trial started! Card saved for usage billing.");
          router.push("/dashboard");
        } else {
          toast.error("Card setup did not complete.");
        }

        return;
      }

      const { error, paymentIntent } = await stripe.confirmCardPayment(
        clientSecret,
        {
          payment_method: {
            card: cardElement,
            billing_details: { email },
          },
        }
      );

      if (error) {
        toast.error(error.message || "Payment failed.");
        return;
      }

      if (paymentIntent?.status === "succeeded") {
        toast.success("✅ Payment successful!");
        router.push("/dashboard");
      } else {
        toast.error("Payment did not complete.");
      }
    } catch (err: any) {
      console.error("Error confirming payment:", err);
      toast.error("Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const card = elements?.getElement(CardElement);
    if (!card) return;

    const handleChange = (event: any) => {
      if (event.brand) setCardBrand(event.brand);
    };

    card.on("change", handleChange);
    return () => {
      card?.off("change", handleChange);
    };
  }, [elements]);

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 bg-white rounded-lg shadow-lg p-6 text-black"
    >
      {/* Promo code notice */}
      {promoCode && (
        <div className="text-sm text-green-600 font-semibold">
          ✅ Promo code <strong>{promoCode}</strong> applied
          {discount && ` — ${discount}`}
        </div>
      )}

      {/* Card brand feedback */}
      {cardBrand && (
        <div className="text-sm text-gray-500">Card type: {cardBrand}</div>
      )}

      {/* Stripe card input */}
      <div className="border border-gray-300 rounded p-3 bg-white">
        <CardElement
          options={{
            style: {
              base: {
                fontSize: "16px",
                color: "#111827",
                fontFamily: "Inter, sans-serif",
                "::placeholder": {
                  color: "#9CA3AF",
                },
              },
              invalid: {
                color: "#EF4444",
              },
            },
          }}
        />
      </div>

      {/* Submit button */}
      <button
        type="submit"
        disabled={loading || !stripe}
        className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition cursor-pointer"
      >
        {loading ? "Processing..." : "Subscribe Now"}
      </button>
    </form>
  );
}
