import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import { HttpError } from '../lib/errors.js';
import { participantFilter } from './messages.js';
export async function listHistory(chatId, user, { page, limit, search, start, end, snapshot }) {
  const chat = await Chat.findOne({ _id: chatId, ...participantFilter(user) })
    .maxTimeMS(3000)
    .lean();
  if (!chat) throw new HttpError(404, 'Chat not found.');
  let anchor = null;
  if (snapshot && snapshot !== 'empty') {
    anchor = await Message.findOne({ _id: snapshot, chat: chat._id })
      .select('_id createdAt')
      .maxTimeMS(3000)
      .lean();
    if (!anchor)
      throw new HttpError(400, 'History snapshot does not belong to this chat. Refresh results.');
  } else if (!snapshot)
    anchor = await Message.findOne({ chat: chat._id })
      .sort({ createdAt: -1, _id: -1 })
      .select('_id createdAt')
      .maxTimeMS(3000)
      .lean();
  const bound = anchor ? String(anchor._id) : 'empty';
  const filter = { chat: chat._id };
  if (!anchor) filter._id = { $exists: false };
  else
    filter.$or = [
      { createdAt: { $lt: anchor.createdAt } },
      { createdAt: anchor.createdAt, _id: { $lte: anchor._id } },
    ];
  if (search)
    filter.body = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  if (start || end) {
    filter.createdAt = {};
    if (start) filter.createdAt.$gte = new Date(`${start}T00:00:00.000Z`);
    if (end) filter.createdAt.$lt = new Date(new Date(`${end}T00:00:00.000Z`).getTime() + 86400000);
  }
  // $or's date predicates and the explicit date range are intersected, not overwritten.
  const [messages, total] = await Promise.all([
    Message.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .maxTimeMS(3000)
      .lean(),
    Message.countDocuments(filter).maxTimeMS(3000),
  ]);
  return {
    messages,
    pagination: {
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
      snapshot: bound,
    },
  };
}
