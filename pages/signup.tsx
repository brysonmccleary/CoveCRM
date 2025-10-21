import { useEffect, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { useRouter } from "next/router";
import { z } from "zod";

const SignupClientSchema = z.object({
  name: z.string().min(1, "Please enter your name"),
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
  promoCode: z.string().optional(),
  affiliateEmail: z.string().email().optional(),
}).superRefine((val, ctx) => {
  if (val.confirmPassword !== val.password) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirmPassword"],
      message: "Passwords do not match.",
    });
  }
});

export default function SignUp() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);

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

  const handleCodeBlur = async () => {
    if (!promoCode.trim()) return;
    setCheckingCode(true);
    try {
      const res = await axios.post("/api/apply-code", { code: promoCode.trim() });
      const { price, ownerEmail } = res.data;
      setFinalPrice(price);
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

  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const pwTooShort = password.length > 0 && password.length < 8;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Client-side schema validation (friendly early errors)
    const parsed = SignupClientSchema.safeParse({
      name,
      email,
      password,
      confirmPassword,
      promoCode: promoCode.trim() || undefined,
      affiliateEmail: affiliateEmail || undefined,
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast.error(first?.message || "Please check the form.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await axios.post("/api/register", {
        name,
        email,
        password,
        confirmPassword, // also enforced server-side
        usedCode: promoCode.trim(),
        affiliateEmail,
      });

      const isAdmin = !!res.data?.admin;
      if (isAdmin) {
        toast.success("Account created! You’re all set (admin — no billing).");
        return router.push("/");
      }

      toast.success("Account created! Redirecting to billing...");
      const total = finalPrice + (aiUpgrade ? aiAddOnPrice : 0);
      router.push(
        `/billing?email=${encodeURIComponent(email)}&price=${total}&ai=${
          aiUpgrade ? 1 : 0
        }&trial=1`,
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
          Create Your CRM Cove Account
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

          {/* Password */}
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              placeholder="Password (min 8 characters)"
              className="w-full p-3 pr-24 rounded bg-[#0f172a] border border-[#1e293b] text-white placeholder-gray-400"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPw((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-sm px-2 py-1 rounded bg-gray-700 hover:bg-gray-600"
            >
              {showPw ? "Hide" : "Show"}
            </button>
            {pwTooShort && (
              <p className="text-xs text-amber-300 mt-1">
                Password must be at least 8 characters.
              </p>
            )}
          </div>

          {/* Confirm Password */}
          <div className="relative">
            <input
              type={showPw2 ? "text" : "password"}
              placeholder="Confirm Password"
              className={`w-full p-3 pr-24 rounded bg-[#0f172a] border ${
                confirmPassword.length > 0
                  ? passwordsMatch
                    ? "border-emerald-500"
                    : "border-rose-500"
                  : "border-[#1e293b]"
              } text-white placeholder-gray-400`}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPw2((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-sm px-2 py-1 rounded bg-gray-700 hover:bg-gray-600"
            >
              {showPw2 ? "Hide" : "Show"}
            </button>
            {confirmPassword.length > 0 && !passwordsMatch && (
              <p className="text-xs text-rose-300 mt-1">Passwords do not match.</p>
            )}
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
            disabled={
              isSubmitting ||
              !name ||
              !email ||
              !password ||
              !confirmPassword ||
              pwTooShort ||
              !passwordsMatch
            }
            className="w-full py-3 rounded text-white font-semibold
                       bg-[var(--cove-accent)] hover:opacity-95 disabled:opacity-60"
          >
            {isSubmitting ? "Creating Account..." : "Start Free Trial"}
          </button>

          <p className="text-xs text-center text-gray-400 mt-3">
            7-day free trial • CRM access is free, phone usage may still bill
          </p>
        </form>
      </div>
    </div>
  );
}
