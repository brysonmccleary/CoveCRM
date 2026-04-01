import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import ProvenAd from "@/models/ProvenAd";

function buildSearchableText(payload: any) {
  return [
    payload?.title || "",
    payload?.sourceBrand || "",
    payload?.leadType || "",
    payload?.format || "",
    payload?.audience || "",
    ...(Array.isArray(payload?.angleTags) ? payload.angleTags : []),
    payload?.hookType || "",
    payload?.headline || "",
    payload?.primaryText || "",
    payload?.description || "",
    payload?.transcript || "",
    payload?.visualNotes || "",
    payload?.landingPageNotes || "",
    payload?.whyItWorks || "",
    payload?.cloneNotes || "",
  ]
    .join(" \n ")
    .toLowerCase()
    .trim();
}

const SEEDED_ADS = [
  {
    sourceBrand: "Sitka Life",
    sourceType: "manual",
    title: "Sitka Mortgage Protection — 3 Simple Reasons",
    leadType: "mortgage_protection",
    format: "image",
    hookType: "3 reasons",
    audience: "Homeowners / mortgage holders",
    angleTags: ["mortgage protection", "home protection", "no exam", "family security", "3 reasons"],
    headline: "3 Simple Reasons Why Home Protection Is Worth Considering",
    primaryText: `Secure your family's future with mortgage protection insurance—an invaluable term life policy that ensures your mortgage is covered, no matter what.

Got yourself a sweet mortgage when the market was right? Want to protect those rates and ensure the minimum is paid in case of an accident?

Secure your family's future with mortgage insurance.

You've already done all you can to protect your family thus far, go a step further with mortgage insurance.
Keep your house a home.

3 Simple Reasons Why Home Protection Is Worth Considering:

1. Helps support your home contribution payments.
Home Protection can offer financial assistance in qualifying situations, adding an extra layer of stability for homeowners.

2. Simple, straightforward application.
Some plans don’t require lengthy health checks, making it fast and easy to get started.

3. Provides added confidence for the future.
Many homeowners appreciate the reassurance that comes with having a protection plan in place.

If you’re exploring options to help safeguard your home, this could be a great place to start.

Tap below, answer a few quick questions, and we'll reach out with more information to help you learn what type of coverage may be available in your situation.`,
    cta: "Get Quote",
    visualNotes: "Static/image advertorial style. Simple homeowner trust style. Can be cloned into talking head, static image, or quote-card format.",
    landingPageType: "advertorial_quiz",
    funnelSteps: [
      "Advertorial hook page",
      "Quote CTA",
      "State",
      "Mortgage amount",
      "Beneficiary",
      "Health",
      "Age",
      "Reason / intent",
      "Name / email / phone",
      "Consent",
      "Agent handoff",
    ],
    landingPageNotes: "Sitka structure uses soft trust → quiz → lead capture. Delays contact info until end. Strong for low-friction homeowner qualification.",
    whyItWorks: "Long-running lead-gen pattern. Simple and scalable. Strong because it frames mortgage protection as home/family safety, then uses low-friction micro-commitment quiz flow.",
    complianceNotes: "Prefer safer wording like 'if something unexpected happens' and avoid direct personal-attribute targeting language in live variants.",
    cloneNotes: "Use Sitka structure but stronger emotional hooks. Ideal variants: family security, protect the house, preserve low rate, fast quote, no exam options.",
    likelyWinnerScore: 93,
    isSeeded: true,
  },
  {
    sourceBrand: "Vet Life Coverage",
    sourceType: "manual",
    title: "Vet Life Coverage — Protect Your Loved Ones",
    leadType: "veteran",
    format: "video",
    hookType: "service gratitude / family protection",
    audience: "Veterans",
    angleTags: ["veteran", "family protection", "no exam", "testimonial", "affordable"],
    headline: "Great News For Veterans",
    primaryText: `Great News For Veterans

You protected our country. Now, it’s time to protect your loved ones.

Affordable Life Insurance designed specifically for veterans.
Peace of Mind knowing your family is covered.
Get a Quote today and secure your future.
No health screening required.

Watch Ron’s testimony video and see how Vet Life Coverage was able to secure his family an affordable option, even with preexisting health conditions.

Click the link below, and give your family the security they deserve.`,
    cta: "Get Quote",
    transcript: "Testimonial-style veteran protection video angle. Family security, service gratitude, affordable option, no health screening required.",
    visualNotes: "Talking-head/testimonial video. Should be cloned into 15s and 30s vertical UGC style scripts.",
    landingPageType: "hosted_funnel",
    funnelSteps: [
      "Veteran hook ad",
      "Testimonial / trust video",
      "Click through",
      "Qualification page or quote page",
      "Contact capture",
      "Agent follow-up",
    ],
    landingPageNotes: "Best cloned as a soft trust page or simple veteran benefits page with strong trust + fast qualification CTA.",
    whyItWorks: "Identity-based trust plus family-protection framing. Easier emotional entry than hard-sell insurance copy. Good for testimonial variants.",
    complianceNotes: "Avoid over-claiming preexisting-condition approval. Use compliant phrasing like 'options may be available' where needed.",
    cloneNotes: "Strong variants: served our country, protect your loved ones, no exam options, hear Ron’s story, benefit review.",
    likelyWinnerScore: 88,
    isSeeded: true,
  },
  {
    sourceBrand: "My Affordable Veteran Insurance",
    sourceType: "manual",
    title: "Affordable Veteran Insurance — Elite Benefits",
    leadType: "veteran",
    format: "image",
    hookType: "identity / elite status",
    audience: "Veterans / active service members",
    angleTags: ["veteran", "elite", "identity", "benefits", "living benefits", "no exam"],
    headline: "Elite Force. Elite Training. Elite Benefits.",
    primaryText: `ELITE FORCE. ELITE TRAINING. ELITE BENEFITS.

Less than 1% of Americans serve. That makes you part of an elite force. So why settle for ordinary coverage designed for the other 99%?

2025 ELITE VETERAN BENEFITS - BECAUSE YOU'RE NOT ORDINARY:

FOR THE ELITE WHO SERVED:
Army's best
Navy's finest
Air Force's sharpest
Marine's strongest
Coast Guard's readiest

ELITE BENEFITS FOR ELITE VETERANS:
Substantial coverage
No medical exam
All conditions covered
Premiums locked forever
Living benefits included
Fast-track approvals

Elite service deserves elite benefits. Period.`,
    cta: "See If You Qualify",
    visualNotes: "Strong static advertorial / benefit-style card. Can also be adapted into talking-head script with identity opener.",
    landingPageType: "advertorial_quiz",
    funnelSteps: [
      "Veteran identity hook page",
      "Check eligibility CTA",
      "Military status",
      "Branch of service",
      "Marital status",
      "Coverage amount",
      "DOB",
      "State",
      "Best time to review plans",
      "Contact info",
      "Consent",
      "Agent handoff",
    ],
    landingPageNotes: "This is quiz-funnel / broker-routing style. Uses identity and exclusivity to drive micro-commitments into a multi-step form.",
    whyItWorks: "Very strong audience identity positioning. It sells veteran-specific exclusivity and benefits, not generic insurance. Great for higher CTR and curiosity clicks.",
    complianceNotes: "Tone down absolutes in live variants. Replace hard guarantees with compliant phrasing like 'may qualify', 'options may include', and 'depending on eligibility'.",
    cloneNotes: "Use as source for elite/benefits/identity variants. Best cloned into advertorial + quiz + eligibility framing.",
    likelyWinnerScore: 95,
    isSeeded: true,
  },
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  const user = await User.findOne({ email: session.user.email.toLowerCase() }).select("_id email").lean();
  if (!user) return res.status(404).json({ error: "User not found" });

  const userEmail = session.user.email.toLowerCase();
  const userId = (user as any)._id;

  const results: any[] = [];

  for (const seed of SEEDED_ADS) {
    const payload = {
      userId,
      userEmail,
      scope: "user",
      ...seed,
      searchableText: buildSearchableText(seed),
    };

    const existing = await ProvenAd.findOne({
      userEmail,
      sourceBrand: seed.sourceBrand,
      title: seed.title,
    });

    if (existing) {
      const updated = await ProvenAd.findByIdAndUpdate(
        existing._id,
        { $set: payload },
        { new: true }
      );
      results.push({ action: "updated", id: updated?._id, title: seed.title });
    } else {
      const created = await ProvenAd.create(payload);
      results.push({ action: "created", id: created._id, title: seed.title });
    }
  }

  return res.status(200).json({ ok: true, results });
}
