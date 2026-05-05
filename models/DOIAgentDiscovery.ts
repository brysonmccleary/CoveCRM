// models/DOIAgentDiscovery.ts
// Stores evidence-backed discovery candidates for DOI agents.
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const DOIAgentDiscoverySchema = new Schema(
  {
    agentId: {
      type: Schema.Types.ObjectId,
      ref: "DOIAgent",
      required: true,
      index: true,
    },
    candidateAgencyName: { type: String, default: "" },
    candidateWebsite: { type: String, default: "" },
    candidateDomain: { type: String, default: "", index: true },
    sourceUrl: { type: String, default: "" },
    sourceType: { type: String, default: "" },
    evidenceText: { type: String, default: "" },
    evidenceScore: { type: Number, default: 0 },
    matchedName: { type: Boolean, default: false },
    matchedState: { type: Boolean, default: false },
    matchedInsuranceTerms: { type: Boolean, default: false },
    matchedAgency: { type: Boolean, default: false },
    matchedLocation: { type: Boolean, default: false },
    finalScore: { type: Number, default: 0, index: true },
    discoveryScore: { type: Number, default: 0, index: true },
    accepted: { type: Boolean, default: false, index: true },
    rejectedReason: { type: String, default: "" },
    checkedAt: { type: Date },
    domainTrustLevel: {
      type: String,
      enum: [
        "",
        "trusted_business",
        "generic_directory",
        "government",
        "social",
        "low_trust",
        "blacklisted",
      ],
      default: "",
      index: true,
    },
    manualDecision: {
      type: String,
      enum: ["", "approved", "rejected"],
      default: "",
      index: true,
    },
    manualNotes: { type: String, default: "" },
    url: { type: String, default: "" },
    rootDomain: { type: String, default: "", index: true },
    title: { type: String, default: "" },
    snippet: { type: String, default: "" },
    sourceQuery: { type: String, default: "" },
    position: { type: Number, default: 0 },
    fetched: { type: Boolean, default: false, index: true },
    parsed: { type: Boolean, default: false, index: true },
    fetchFailedReason: { type: String, default: "" },
    parseFailedReason: { type: String, default: "" },
    lastFetchedAt: { type: Date },
    lastParsedAt: { type: Date },
    fetchAttempts: { type: Number, default: 0 },
    parseAttempts: { type: Number, default: 0 },
    pageTitle: { type: String, default: "" },
    foundEmails: { type: [String], default: [] },
    personalEmails: { type: [String], default: [] },
    workEmails: { type: [String], default: [] },
    foundPhones: { type: [String], default: [] },
    foundNames: { type: [String], default: [] },
    foundAgencyNames: { type: [String], default: [] },
    insuranceTermsFound: { type: [String], default: [] },
    locationHints: { type: [String], default: [] },
    pageText: { type: String, default: "" },
    isGenericJunk: { type: Boolean, default: false },
    isTeamPage: { type: Boolean, default: false },
    isContactPage: { type: Boolean, default: false },
    isAboutPage: { type: Boolean, default: false },
    identityScore: { type: Number, default: 0 },
    identityConfidence: {
      type: String,
      enum: ["", "low", "medium", "high"],
      default: "",
    },
    identityReasons: { type: [String], default: [] },
  },
  { timestamps: true }
);

DOIAgentDiscoverySchema.index({ agentId: 1, candidateDomain: 1, sourceUrl: 1 }, { unique: false });

export type DOIAgentDiscovery = InferSchemaType<typeof DOIAgentDiscoverySchema>;
export default (models.DOIAgentDiscovery as mongoose.Model<DOIAgentDiscovery>) ||
  model<DOIAgentDiscovery>("DOIAgentDiscovery", DOIAgentDiscoverySchema);
