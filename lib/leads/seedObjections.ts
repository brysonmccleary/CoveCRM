// lib/leads/seedObjections.ts
// Seeds 7 global objection responses if none exist yet
import ObjectionEntry from "@/models/ObjectionEntry";

const GLOBAL_OBJECTIONS = [
  {
    objection: "It's too expensive.",
    response:
      "I completely understand. Let me show you our most affordable options — many of our clients are paying less than $1 a day for peace of mind. Can I put together a quick quote?",
    category: "price",
  },
  {
    objection: "I need to talk to my spouse first.",
    response:
      "Of course, that makes total sense. Would it help if we set up a short call with both of you so I can answer any questions together? It only takes 10 minutes.",
    category: "spouse",
  },
  {
    objection: "I'm not interested right now.",
    response:
      "No problem at all. Would it be okay if I checked back in a month or two? Life changes fast and I'd hate for your family to be caught off guard.",
    category: "timing",
  },
  {
    objection: "I already have coverage.",
    response:
      "That's great to hear! Many of my clients come to me to review what they have — sometimes there are gaps or better rates available. Would you mind if I took a quick look? It's free.",
    category: "need",
  },
  {
    objection: "I don't trust insurance companies.",
    response:
      "That's a really common concern and I respect it. My job is to represent you, not the company. I shop multiple carriers to find the best fit. Would you be open to just seeing the numbers?",
    category: "trust",
  },
  {
    objection: "I can get it cheaper somewhere else.",
    response:
      "Absolutely — and I'd encourage you to compare! I work with over 20 carriers, so I'm probably already showing you the lowest rate available. What are they quoting you?",
    category: "competitor",
  },
  {
    objection: "I'm too busy right now.",
    response:
      "I totally get it. This won't take long — if you have 10 minutes this week, I can put together a complete quote and walk you through it. What day works best?",
    category: "timing",
  },
];

export async function seedGlobalObjections(): Promise<void> {
  const count = await ObjectionEntry.countDocuments({ isGlobal: true });
  if (count > 0) return; // already seeded

  await ObjectionEntry.insertMany(
    GLOBAL_OBJECTIONS.map((o) => ({ ...o, isGlobal: true, userEmail: "" }))
  );
}
