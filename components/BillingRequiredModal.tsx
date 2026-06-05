// components/BillingRequiredModal.tsx
// Modal shown when any API call returns 402 billing_required.
// Triggered by window event "billing:required" dispatched from API call sites.
import { useEffect, useState } from "react";
import { useRouter } from "next/router";

export const BILLING_REQUIRED_EVENT = "billing:required";

export function dispatchBillingRequired(redirect?: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(BILLING_REQUIRED_EVENT, { detail: { redirect } })
    );
  }
}

export default function BillingRequiredModal() {
  const [open, setOpen] = useState(false);
  const [redirect, setRedirect] = useState<string | undefined>(undefined);
  const router = useRouter();

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { redirect?: string } | undefined;
      setRedirect(detail?.redirect);
      setOpen(true);
    };
    window.addEventListener(BILLING_REQUIRED_EVENT, handler);
    return () => window.removeEventListener(BILLING_REQUIRED_EVENT, handler);
  }, []);

  if (!open) return null;

  const destination = redirect || "/billing";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="max-w-md w-full rounded-2xl p-6 shadow-2xl bg-[var(--cove-card)] border border-[#1e293b] text-white space-y-4">
        <h2 className="text-xl font-bold">Payment Method Required</h2>
        <p className="text-sm text-gray-300">
          It looks like your payment method wasn&apos;t stored at sign up. Add a payment
          method to continue using CoveCRM.
        </p>
        <div className="flex gap-3 pt-2">
          <button
            onClick={() => {
              setOpen(false);
              router.push(destination);
            }}
            className="flex-1 py-2 rounded font-semibold bg-[var(--cove-accent)] hover:opacity-90 text-white"
          >
            Add Payment Method
          </button>
          <button
            onClick={() => setOpen(false)}
            className="flex-1 py-2 rounded font-semibold bg-[#1e293b] hover:bg-[#334155] text-gray-300"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
