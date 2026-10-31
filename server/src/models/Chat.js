import mongoose from 'mongoose';
const schema = new mongoose.Schema(
  {
    guest: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    assignedAgent: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    subject: { type: String, required: true, trim: true, maxlength: 120 },
    category: {
      type: String,
      enum: ['booking', 'amenities', 'general', 'urgent'],
      default: 'general',
    },
    status: { type: String, enum: ['waiting', 'active', 'closed'], default: 'waiting' },
    lastMessageAt: { type: Date, default: null },
    lastGuestMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    agentReadMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  },
  { timestamps: true },
);
schema.index({ guest: 1, updatedAt: -1, _id: -1 });
schema.index({ assignedAgent: 1, status: 1, updatedAt: -1 });
schema.index({ status: 1, assignedAgent: 1, updatedAt: -1, _id: -1 });
export default mongoose.model('Chat', schema);
