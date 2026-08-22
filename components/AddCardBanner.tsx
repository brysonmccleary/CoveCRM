import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import Link from "next/link";
import { FaCreditCard } from "react-icons/fa";

export default function AddCardBanner() {
  const { data: session } = useSession();
  const router = useRouter();
  const [needsCard, setNeedsCard] = useState(false);
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.user?.email) return;
    let cancelled = false;
    fetch("/api/billing/card-status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setNeedsCard(data.needsCard === true);
        setTrialEndsAt(data.trialEndsAt || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session?.user?.email, router.asPath]);

  if (!needsCard) return null;

  const email = session?.user?.email || "";
  const billingHref = `/billing?${new URLSearchParams({ email, trial: "1" }).toString()}`;

  const trialDate = trialEndsAt
    ? new Date(trialEndsAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div className="mb-5 overflow-hidden rounded-2xl border border-blue-500/25 bg-gradient-to-r from-[#0f1b33] via-[#12233f] to-[#0f1b33] shadow-lg shadow-blue-950/30">
      <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 ring-1 ring-inset ring-blue-400/30">
          <FaCreditCard className="h-5 w-5 text-blue-300" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-100">
            Add a card to unlock your phone number
          </p>
          <p className="mt-1 text-sm leading-relaxed text-slate-400">
            Your card won&apos;t be charged for your subscription until your free
            trial ends{trialDate ? ` on ${trialDate}` : ""}. Calling and texting
            turn on the moment a card is saved &mdash; usage simply bills as you go.
          </p>
        </div>
        <Link
          href={billingHref}
          className="inline-flex shrink-0 items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-[#0f1b33]"
        >
          Add card
        </Link>
      </div>
    </div>
  );
}
