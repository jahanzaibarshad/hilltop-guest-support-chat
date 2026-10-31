import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import { HttpError } from '../lib/errors.js';
export function participantFilter(user) {
  return user.role === 'agent' ? { assignedAgent: user._id } : { guest: user._id };
}
export async function sendMessage(chatId, user, input) {
  const clientMessageId = input.clientMessageId || randomUUID();
  const key = { chat: chatId, sender: user._id, clientMessageId };
  try {
    return await mongoose.connection.transaction(async (session) => {
      const chat = await Chat.findOne({ _id: chatId, ...participantFilter(user) }).session(session);
      if (!chat) throw new HttpError(404, 'Chat not found.');
      const existing = await Message.findOne(key).session(session);
      if (existing) {
        if (existing.body !== input.body)
          throw new HttpError(409, 'Message ID already used for different text.');
        return { message: existing, created: false };
      }
      if (chat.status === 'closed')
        throw new HttpError(409, 'This chat is closed. Start a new conversation.');
      const [message] = await Message.create(
        [{ ...key, body: input.body, senderRole: user.role }],
        { session },
      );
      chat.lastMessageAt = message.createdAt;
      if (user.role === 'guest') chat.lastGuestMessage = message._id;
      await chat.save({ session });
      return { message, created: true };
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const existing = await Message.findOne(key);
    if (!existing || existing.body !== input.body)
      throw new HttpError(409, 'Message ID already used.');
    return { message: existing, created: false };
  }
}
