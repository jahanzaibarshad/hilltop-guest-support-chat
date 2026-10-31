import { Router } from 'express';
import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import { HttpError } from '../lib/errors.js';
import { parse, inboxInput, readInput, validId } from '../lib/validation.js';
export const unreadChat = (chat) =>
  Boolean(chat.lastGuestMessage && String(chat.lastGuestMessage) !== String(chat.agentReadMessage));
export function agentRouter(auth) {
  const router = Router();
  const agentOnly = (req, res, next) => {
    if (req.user.role !== 'agent') throw new HttpError(403, 'Agent access required.');
    next();
  };
  router.get('/agent/chats', auth.required, agentOnly, async (req, res) => {
    const { status, page, limit } = parse(inboxInput, req.query);
    const scopes = {
      waiting: { status: 'waiting', assignedAgent: null },
      active: { status: 'active', assignedAgent: req.user._id },
      closed: { status: 'closed', assignedAgent: req.user._id },
    };
    const filter = scopes[status];
    const [chats, total, waiting, active, closed, unread] = await Promise.all([
      Chat.find(filter)
        .sort({ updatedAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('guest', 'name')
        .lean(),
      Chat.countDocuments(filter),
      Chat.countDocuments(scopes.waiting),
      Chat.countDocuments(scopes.active),
      Chat.countDocuments(scopes.closed),
      Chat.countDocuments({
        assignedAgent: req.user._id,
        status: { $ne: 'closed' },
        lastGuestMessage: { $ne: null },
        $expr: { $ne: ['$lastGuestMessage', '$agentReadMessage'] },
      }),
    ]);
    res.json({
      chats: chats.map((chat) => ({ ...chat, unread: unreadChat(chat) })),
      summary: { waiting, active, closed, unread },
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    });
  });
  router.post('/chats/:id/read', auth.required, agentOnly, validId, async (req, res) => {
    const { messageId } = parse(readInput, req.body);
    let chat = await Chat.findOne({ _id: req.params.id, assignedAgent: req.user._id }).lean();
    if (!chat) throw new HttpError(404, 'Chat not found.');
    const visible = await Message.findOne({ _id: messageId, chat: chat._id }).lean();
    if (!visible) throw new HttpError(400, 'Read cursor does not belong to this chat.');
    if (unreadChat(chat)) {
      const lastGuest = await Message.findOne({
        _id: chat.lastGuestMessage,
        chat: chat._id,
      }).lean();
      const seen =
        lastGuest &&
        (visible.createdAt > lastGuest.createdAt ||
          (visible.createdAt.getTime() === lastGuest.createdAt.getTime() &&
            String(visible._id) >= String(lastGuest._id)));
      if (seen) {
        const updated = await Chat.findOneAndUpdate(
          {
            _id: chat._id,
            assignedAgent: req.user._id,
            lastGuestMessage: chat.lastGuestMessage,
            agentReadMessage: chat.agentReadMessage,
          },
          { $set: { agentReadMessage: chat.lastGuestMessage } },
          { new: true, timestamps: false },
        ).lean();
        if (updated) {
          chat = updated;
          await req.app.locals.realtime?.notifyInbox();
        } else chat = await Chat.findById(chat._id).lean();
      }
    }
    res.json({ ...chat, unread: unreadChat(chat) });
  });
  return router;
}
