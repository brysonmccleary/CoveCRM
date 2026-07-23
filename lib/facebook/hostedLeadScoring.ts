import { scoreLeadOnArrival } from "@/lib/leads/scoreLead";

export async function scoreHostedLeadOnArrival(
  leadId: string,
  scorer: typeof scoreLeadOnArrival = scoreLeadOnArrival
) {
  return scorer(leadId, "facebook_realtime");
}
