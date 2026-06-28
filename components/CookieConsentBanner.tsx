import Link from "next/link";
import { useEffect, useState } from "react";

const STORAGE_KEY = "cove.cookieConsent.accepted";

export default function CookieConsentBanner() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    try {
      setIsVisible(localStorage.getItem(STORAGE_KEY) !== "true");
    } catch {
      setIsVisible(false);
    }
  }, []);

  const acceptCookies = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // Keep the banner dismissible even if storage is unavailable.
    }
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[10000] px-4 pb-4 sm:px-6 sm:pb-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 text-slate-700 shadow-2xl shadow-slate-950/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-6">
          We use cookies and similar technologies to improve your experience,
          analyze site traffic, and support essential site functionality. By
          clicking Accept, you agree to our use of cookies.{" "}
          <Link
            href="/legal/privacy"
            className="font-medium text-blue-700 underline-offset-4 hover:underline dark:text-blue-300"
          >
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link
            href="/legal/terms"
            className="font-medium text-blue-700 underline-offset-4 hover:underline dark:text-blue-300"
          >
            Terms
          </Link>
          .
        </p>
        <button
          type="button"
          onClick={acceptCookies}
          className="shrink-0 rounded-md bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 dark:focus:ring-offset-slate-950"
        >
          Accept
        </button>
      </div>
    </div>
  );
}
