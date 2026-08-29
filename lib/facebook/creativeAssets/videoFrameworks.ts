import type { CreativeLanguage, CreativeVertical } from "@/lib/facebook/creativeIntelligence/types";

const FRAMEWORKS = [
  "agent_talking_head", "ugc_style_explainer", "story_problem_solution", "educational_explainer", "faq",
  "objection_handling", "benefit_overview", "qualification_cta", "myth_vs_fact", "three_questions",
] as const;

const PRODUCT_LABELS: Record<CreativeVertical, { en: string; es: string }> = {
  veteran: { en: "private coverage options for veterans and their families", es: "opciones privadas de cobertura para veteranos y sus familias" },
  final_expense: { en: "final expense coverage options", es: "opciones de cobertura para gastos finales" },
  mortgage_protection: { en: "mortgage protection options", es: "opciones de protección hipotecaria" },
  iul: { en: "indexed universal life education and options", es: "educación y opciones de vida universal indexada" },
  trucker: { en: "private coverage options for CDL drivers", es: "opciones privadas de cobertura para conductores con CDL" },
};

export type ApprovedVideoFrameworkSpec = {
  frameworkId: string;
  vertical: CreativeVertical;
  family: typeof FRAMEWORKS[number];
  language: CreativeLanguage;
  script: string;
  speakerType: "licensed_agent" | "educator" | "narrator" | "actor_no_testimonial";
  durationSeconds: number;
  aspectRatio: "9:16";
  captionTemplate: string;
  cta: string;
  claimRequirements: string[];
  productCompatibility: CreativeVertical[];
  approvalStatus: "pending";
};

export function buildPendingVideoFrameworks(): ApprovedVideoFrameworkSpec[] {
  const verticals: CreativeVertical[] = ["veteran", "final_expense", "mortgage_protection", "iul", "trucker"];
  const languages: CreativeLanguage[] = ["en", "es"];
  return verticals.flatMap((vertical) => languages.flatMap((language) => FRAMEWORKS.map((family, index) => {
    const product = PRODUCT_LABELS[vertical][language];
    const script = language === "es"
      ? `Explique ${product} de forma clara. Presente el problema sin alarmismo, indique que la elegibilidad y las opciones varían, y invite a una revisión con un agente autorizado. No presente testimonios, resultados, precios ni beneficios garantizados.`
      : `Explain ${product} clearly. Introduce the problem without fear tactics, state that eligibility and options vary, and invite a review with a licensed agent. Do not present testimonials, results, prices, or guaranteed benefits.`;
    return {
      frameworkId: `video_${vertical}_${language}_${family}`,
      vertical, family, language, script,
      speakerType: (index === 0 || index === 5 ? "licensed_agent" : index === 1 ? "actor_no_testimonial" : "educator") as ApprovedVideoFrameworkSpec["speakerType"],
      durationSeconds: index % 3 === 0 ? 30 : index % 3 === 1 ? 45 : 60,
      aspectRatio: "9:16" as const,
      captionTemplate: language === "es" ? "Subtítulos nativos en español; máximo dos líneas" : "Native English captions; maximum two lines",
      cta: language === "es" ? "Revise sus opciones" : "Review your options",
      claimRequirements: [],
      productCompatibility: [vertical],
      approvalStatus: "pending" as const,
    };
  })));
}
