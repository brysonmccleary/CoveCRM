// models/DOIAgentEnrichment.ts
// Per-agent enrichment tracking for DOI pipeline.
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const DOIAgentEnrichmentSchema = new Schema(
  {
    agentId: {
      type: Schema.Types.ObjectId,
      ref: "DOIAgent",
      required: true,
      unique: true,
      index: true,
    },
    stage: {
      type: String,
      enum: [
        "pending",
        "agency_found",
        "website_found",
        "domain_found",
        "patterns_generated",
        "verified",
        "failed",
      ],
      default: "pending",
      index: true,
    },
    attempts: { type: Number, default: 0 },
    lastAttemptAt: { type: Date },
    notes: { type: String, default: "" },
    selectedDomain: { type: String, default: "" },
    selectedDomainScore: { type: Number, default: 0 },
    selectedIdentityScore: { type: Number, default: 0 },
    selectedIdentityConfidence: {
      type: String,
      enum: ["", "low", "medium", "high"],
      default: "",
    },
    evidenceSummary: { type: String, default: "" },
    bestEmail: { type: String, default: "" },
    bestEmailType: {
      type: String,
      enum: ["", "domain", "personal", "work"],
      default: "",
    },
    bestEmailConfidence: { type: Number, default: 0 },
    workEmail: { type: String, default: "" },
    workEmailConfidence: { type: Number, default: 0 },
    personalEmail: { type: String, default: "" },
    personalEmailConfidence: { type: Number, default: 0 },
    emailDiscoveryMode: { type: String, default: "" },
    discoveredEmails: [
      {
        email: { type: String, default: "" },
        emailType: {
          type: String,
          enum: ["work", "personal"],
          default: "work",
        },
        source: { type: String, default: "" },
        sourceUrl: { type: String, default: "" },
        createdAt: { type: Date, default: () => new Date() },
      },
    ],
  },
  { timestamps: true }
);

export type DOIAgentEnrichment = InferSchemaType<typeof DOIAgentEnrichmentSchema>;
export default (models.DOIAgentEnrichment as mongoose.Model<DOIAgentEnrichment>) ||
  model<DOIAgentEnrichment>("DOIAgentEnrichment", DOIAgentEnrichmentSchema);
