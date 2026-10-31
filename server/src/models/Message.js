import mongoose from 'mongoose';
const schema = new mongoose.Schema(
  {
    chat: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    senderRole: { type: String, enum: ['guest', 'agent'], required: true },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    clientMessageId: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
schema.index({ chat: 1, createdAt: -1, _id: -1 });
schema.index({ chat: 1, sender: 1, clientMessageId: 1 }, { unique: true });
export default mongoose.model('Message', schema);
