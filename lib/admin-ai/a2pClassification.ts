export type A2PClassification = "simple" | "complex" | "needs_user_input" | "unsafe";

export type A2PIssueType =
  | "missing_opt_out"
  | "weak_opt_in_language"
  | "bad_sample_message"
  | "missing_business_info"
  | "invalid_website"
  | "business_mismatch"
  | "prohibited_content"
  | "unclear_use_case"
  | "unknown";

export type A2PClassificationResult = {
  classification: A2PClassification;
  issueType: A2PIssueType;
  reason: string;
};

export function classifyA2PIssue(args: {
  rejectionReason?: string;
  a2pRecord?: any;
  existingSubmission?: any;
}): A2PClassificationResult {
  const reason = String(args.rejectionReason || args.a2pRecord?.lastError || "").toLowerCase();
  const website = String(args.a2pRecord?.website || args.existingSubmission?.website || "").trim();
  const optIn = String(args.a2pRecord?.optInDetails || args.existingSubmission?.optInDetails || "").toLowerCase();
  const samples = JSON.stringify(args.a2pRecord?.sampleMessagesArr || args.a2pRecord?.sampleMessages || args.existingSubmission?.sampleMessages || "").toLowerCase();

  if (/(prohibited|illegal|cannabis|gambling|debt|loan|hate|adult|high risk)/i.test(reason + samples)) {
    return { classification: "unsafe", issueType: "prohibited_content", reason: "Potential prohibited or high-risk content." };
  }
  if (!website || /(website|url).*(missing|required|invalid)|invalid.*website/i.test(reason)) {
    return { classification: "needs_user_input", issueType: "invalid_website", reason: "Website is missing or invalid." };
  }
  if (/(ein|legal name|tax|business.*match|mismatch|identity)/i.test(reason)) {
    return { classification: "needs_user_input", issueType: "business_mismatch", reason: "Business identity details may not match." };
  }
  if (!optIn || /(opt.?in).*(missing|required|not clear|insufficient|weak)/i.test(reason)) {
    return { classification: "simple", issueType: "weak_opt_in_language", reason: "Opt-in language likely needs clearer consent wording." };
  }
  if (/(stop|help|opt.?out|unsubscribe)/i.test(reason) || !/(stop|unsubscribe|opt out)/i.test(samples)) {
    return { classification: "simple", issueType: "missing_opt_out", reason: "Sample messages likely need opt-out/help language." };
  }
  if (/(sample message|message sample|example message|too vague|clarity)/i.test(reason)) {
    return { classification: "simple", issueType: "bad_sample_message", reason: "Sample messages need clearer compliant language." };
  }
  if (/(use case|purpose|campaign description|unclear|ambiguous)/i.test(reason)) {
    return { classification: "complex", issueType: "unclear_use_case", reason: "Use case or campaign description is unclear." };
  }

  return { classification: "complex", issueType: "unknown", reason: "Rejection reason is ambiguous and needs admin review." };
}

