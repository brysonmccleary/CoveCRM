// /models/Booking.ts
import mongoose, { Schema, models, model } from "mongoose";

const BookingSchema = new Schema(
  {
    leadEmail: { type: String, required: true },
    leadPhone: { type: String, required: true },
    agentEmail: { type: String, required: true }, // Who they're meeting with
    agentPhone: { type: String }, // Optional, for reminder content

    date: { type: Date, required: true }, // Appointment date/time
    timezone: { type: String, default: "America/New_York" }, // ✅ NEW — lead's timezone

    reminderSent: {
      confirm: { type: Boolean, default: false },
      morning: { type: Boolean, default: false },
      hour: { type: Boolean, default: false },
      fifteen: { type: Boolean, default: false },
    },
  },
  { timestamps: true },
);

export default models.Booking || model("Booking", BookingSchema);
