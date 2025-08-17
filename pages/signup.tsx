// /pages/signup.tsx

import { useEffect, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { useRouter } from "next/router";

export default function SignUp() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

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
    } catch (err) {
      toast.error("Invalid or expired code.");
      setDiscountApplied(false);
      setFinalPrice(basePrice);
      setAffiliateEmail("");
    }
    setCheckingCode(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !password) {
      toast.error("Please fill out all fields.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await axios.post("/api/register", {
        name,
        email,
        password,
        usedCode: promoCode.trim(),
        affiliateEmail,
      });

      if (res.status === 200) {
        toast.success("✅ Account created! Redirecting to billing...");

        const total = finalPrice + (aiUpgrade ? aiAddOnPrice : 0);

        router.push(
          `/billing?email=${encodeURIComponent(email)}&price=${total}&ai=${aiUpgrade ? 1 : 0}&affiliateEmail=${affiliateEmail}&trial=1`
        );
      }
    } catch (err) {
      toast.error("Signup failed. Try again.");
      console.error(err);
    }
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-black px-4">
      <div className="max-w-md w-full p-6 bg-white dark:bg-gray-900 text-black dark:text-white rounded-xl shadow-lg">
        <h1 className="text-3xl font-bold mb-6 text-center">Create Your CRM Cove Account</h1> {/* ✅ updated */}

        <form onSubmit={handleSubmit} className="space-y-5">
          <input
            type="text"
            placeholder="Full Name"
            className="w-full p-3 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <input
            type="email"
            placeholder="Email"
            className="w-full p-3 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            type="password"
            placeholder="Password"
            className="w-full p-3 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <div>
            <label htmlFor="promoCode" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Referral / Promo Code (optional)
            </label>
            <input
              type="text"
              name="promoCode"
              id="promoCode"
              placeholder="Enter a code"
              className="mt-1 w-full p-3 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value)}
              onBlur={handleCodeBlur}
            />
            {checkingCode && <p className="text-sm text-blue-600 mt-1">Checking code...</p>}
            {discountApplied && (
              <p className="text-green-600 text-sm mt-1">
                ✅ Code applied! Your new base price is ${finalPrice}/month.
              </p>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="aiUpgrade"
              checked={aiUpgrade}
              onChange={() => setAiUpgrade(!aiUpgrade)}
              className="w-5 h-5 text-blue-600"
            />
            <label htmlFor="aiUpgrade" className="text-sm text-gray-700 dark:text-gray-300">
              Add AI Upgrade (+$50/mo)
            </label>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className={`w-full py-3 rounded text-white font-semibold ${
              isSubmitting ? "bg-gray-400" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {isSubmitting ? "Creating Account..." : "Start Free Trial"}
          </button>

          <p className="text-xs text-center text-gray-500 mt-3">
            7-day free trial • CRM access is free, phone usage may still bill
          </p>
        </form>
      </div>
    </div>
  );
}
