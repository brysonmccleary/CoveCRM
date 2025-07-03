import mongoose from "mongoose";

const MappingSchema = new mongoose.Schema(
  {
    userId: { type: String, required: false }, // Add actual user ID if auth connected
    name: { type: String, required: true },
    fields: { type: Object, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "mappings" }
);

export default mongoose.models.Mapping || mongoose.model("Mapping", MappingSchema);

