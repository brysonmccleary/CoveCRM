// /models/Conversation.ts
import mongoose, { Schema, Document } from "mongoose";

export interface IConversation extends Document {
  user: string; // user email
  leadId: mongoose.Types.ObjectId;
  message: string;
  timestamp?: Date;
}

const ConversationSchema = new Schema<IConversation>(
  {
    user: { type: String, required: true },
    leadId: { type: Schema.Types.ObjectId, required: true },
    message: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

const Conversation =
  mongoose.models.Conversation ||
  mongoose.model<IConversation>("Conversation", ConversationSchema);

export default Conversation;
