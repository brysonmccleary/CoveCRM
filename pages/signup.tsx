import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { useRouter } from "next/router";

export default function SignUp() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [promoCode, setPromoCode] = useState("");
  const [discountApplied, setDiscountApplied] = useState(false);
  const [finalPrice, setFinalPrice] = useState(199.99);
  const [affiliateEmail, setAffiliateEmail] = useState("");
  const [checkingCode, setCheckingCode] = useState(false);

  const [aiUpgrade, setAiUpgrade] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const basePrice = 199.99;
  const aiAddOnPrice = 50;

  useEffect(() => {
    if (router.query.code && typeof router.query.code === "string") {
      setPromoCode(router.query.code);
    }
  }, [router.query.code]);

  const pwMismatch = useMemo(
    () => confirmPassword.length > 0 && password !== confirmPassword,
    [password, confirmPassword]
  );

  const canSubmit = useMemo(() => {
    return !!name && !!email && !!password && !!confirmPassword && !pwMismatch && !isSubmitting;
  }, [name, email, password, confirmPassword, pwMismatch, isSubmitting]);

  const handleCodeBlur = async () => {
    if (!promoCode.trim()) {
      setDiscountApplied(false);
      setFinalPrice(basePrice);
      setAffiliateEmail("");
      return;
    }
    setCheckingCode(true);
    try {
      const res = await axios.post("/api/apply-code", { code: promoCode.trim() });
      const { price, ownerEmail } = res.data || {};
      if (typeof price === "number") setFinalPrice(price);
      setAffiliateEmail(ownerEmail || "");
      setDiscountApplied(true);
      toast.success("✅ Code applied! Price updated.");
    } catch {
      toast.error("Invalid or expired code.");
      setDiscountApplied(false);
      setFinalPrice(basePrice);
      setAffiliateEmail("");
    } finally {
      setCheckingCode(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      if (pwMismatch) toast.error("Passwords do not match.");
      else toast.error("Please fill out all fields.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await axios.post("/api/register", {
        name,
        email,
        password,
        confirmPassword,
        usedCode: promoCode.trim(),
        affiliateEmail,
      });

      const isAdmin = !!res.data?.admin;
      if (isAdmin) {
        toast.success("Account created! (admin — no billing)");
        return router.push("/");
      }

      // compute display total only for the querystring (server enforces real pricing)
      const uiTotal = (discountApplied ? finalPrice : basePrice) + (aiUpgrade ? aiAddOnPrice : 0);

      toast.success("Account created! Redirecting to billing…");
      router.push(
        `/billing?email=${encodeURIComponent(email)}&price=${uiTotal}&ai=${aiUpgrade ? 1 : 0}&trial=1&code=${encodeURIComponent(
          promoCode.trim() || ""
        )}`
      );
    } catch (err: any) {
      const msg = err?.response?.data?.message || "Signup failed. Try again.";
      toast.error(msg);
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4
                    bg-gradient-to-b from-[var(--cove-bg-dark)] to-[var(--cove-bg)]">
      <div className="max-w-md w-full p-6 rounded-2xl shadow-xl
                      bg-[var(--cove-card)] text-white border border-[#1e293b]">
        <h1 className="text-3xl font-bold mb-6 text-center">
          Create Your Cove CRM Account
        </h1>

        <form onSubmit={handleSubmit} className="space-y-5">
          <input
            type="text"
            placeholder="Full Name"
            className="w-full p-3 rounded bg-[#0f172a] border border-[#1e293b] text-white placeholder-gray-400"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="email"
            placeholder="Email"
            className="w-full p-3 rounded bg-[#0f172a] border border-[#1e293b] text-white placeholder-gray-400"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <div className="space-y-3">
            <input
              type="password"
              placeholder="Password"
              className="w-full p-3 rounded bg-[#0f172a] border border-[#1e293b] text-white placeholder-gray-400"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div>
              <input
                type="password"
                placeholder="Confirm Password"
                className="w-full p-3 rounded bg-[#0f172a] border border-[#1e293b] text-white placeholder-gray-400"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {pwMismatch && (
                <p className="text-xs text-red-400 mt-1">Passwords do not match.</p>
              )}
            </div>
          </div>

          <label className="block text-sm font-medium text-gray-300">
            Referral / Promo Code (optional)
          </label>
          <input
            type="text"
            placeholder="Enter a code"
            className="w-full p-3 rounded bg-[#0f172a] border border-[#1e293b] text-white placeholder-gray-400"
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value)}
            onBlur={handleCodeBlur}
          />
          {checkingCode && <p className="text-sm text-blue-300 mt-1">Checking code...</p>}
          {discountApplied && (
            <p className="text-green-400 text-sm mt-1">
              ✅ Code applied! Your new base price is ${finalPrice}/month.
            </p>
          )}

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="aiUpgrade"
              checked={aiUpgrade}
              onChange={() => setAiUpgrade(!aiUpgrade)}
              className="w-5 h-5 accent-[var(--cove-accent)]"
            />
            <label htmlFor="aiUpgrade" className="text-sm text-gray-300">
              Add AI Upgrade (+$50/mo)
            </label>
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full py-3 rounded text-white font-semibold
                       bg-[var(--cove-accent)] hover:opacity-95 disabled:opacity-60"
          >
            {isSubmitting ? "Creating Account..." : "Start Free Trial"}
          </button>

          <p className="text-xs text-center text-gray-400 mt-3">
            3-day free trial • CRM access is free, phone usage may still bill
          </p>
        </form>
      </div>
    </div>
  );
}
