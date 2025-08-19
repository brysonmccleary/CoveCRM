// models/Drip.ts
import mongoose from "mongoose";

const DripSchema = new mongoose.Schema(
  {
    name: String,
    steps: [
      {
        text: String,
        day: String,
      },
    ],
    type: { type: String, default: "prebuilt" }, // "prebuilt" or "custom"
  },
  { timestamps: true },
);

export default mongoose.models.Drip || mongoose.model("Drip", DripSchema);
