import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import User from '../models/User.js';
import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import { HttpError } from '../lib/errors.js';
import {
  parse,
  userInput,
  loginInput,
  chatInput,
  messageInput,
  pageInput,
  validId,
  syncInput,
  olderInput,
  historyInput,
} from '../lib/validation.js';
import { publicUser } from '../middleware/auth.js';
import { participantFilter, sendMessage } from '../services/messages.js';
import { agentRouter } from './agent.js';
import { listHistory } from '../services/history.js';
const dummyHash = bcrypt.hashSync(randomBytes(24).toString('hex'), 12);
export function createRouter(auth, authLimit) {
  const router = Router();
  router.use(agentRouter(auth));
  router.post('/users', authLimit, async (req, res) => {
    const input = parse(userInput, req.body);
    const user = await User.create({
      name: input.name,
      email: input.email,
      passwordHash: await bcrypt.hash(input.password, 12),
      role: 'guest',
    });
    auth.issue(res, user);
    res.status(201).json({ user: publicUser(user) });
  });
  router.post('/auth/login', authLimit, async (req, res) => {
    const input = parse(loginInput, req.body);
    const user = await User.findOne({ email: input.email }).select('+passwordHash +sessionVersion');
    const correct = await bcrypt.compare(input.password, user?.passwordHash || dummyHash);
    if (!user || !correct) throw new HttpError(401, 'Email or password is incorrect.');
    auth.issue(res, user);
    res.json({ user: publicUser(user) });
  });
  router.post('/auth/logout', async (req, res) => {
    const userId = await auth.revoke(req.cookies?.hilltop_session);
    if (userId) req.app.locals.realtime?.disconnectUser(userId);
    auth.clear(res);
    res.status(204).end();
  });
  router.get('/auth/me', auth.required, (req, res) => res.json({ user: publicUser(req.user) }));
  router.post('/chats', auth.required, async (req, res) => {
    if (req.user.role !== 'guest') throw new HttpError(403, 'Only guests can start a chat.');
    const input = parse(chatInput, req.body);
    const chat = await Chat.create({ ...input, guest: req.user._id });
    await req.app.locals.realtime?.notifyInbox();
    res.status(201).json(chat);
  });
  router.get('/chats', auth.required, async (req, res) => {
    const { page, limit } = parse(pageInput, req.query);
    const filter =
      req.user.role === 'agent'
        ? { $or: [{ assignedAgent: null }, { assignedAgent: req.user._id }] }
        : { guest: req.user._id };
    const [chats, total] = await Promise.all([
      Chat.find(filter)
        .sort({ updatedAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Chat.countDocuments(filter),
    ]);
    res.json({
      chats,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    });
  });
  router.get('/chats/:id', auth.required, validId, async (req, res) => {
    const chat = await Chat.findOne({ _id: req.params.id, ...participantFilter(req.user) }).lean();
    if (!chat) throw new HttpError(404, 'Chat not found.');
    res.json(chat);
  });
  router.patch('/chats/:id/assign', auth.required, validId, async (req, res) => {
    if (req.user.role !== 'agent') throw new HttpError(403, 'Agent access required.');
    const chat = await Chat.findOneAndUpdate(
      { _id: req.params.id, status: { $ne: 'closed' }, assignedAgent: null },
      { $set: { assignedAgent: req.user._id, status: 'active' } },
      { new: true, runValidators: true },
    );
    if (!chat) throw new HttpError(409, 'Chat is assigned, closed or unavailable.');
    await req.app.locals.realtime?.publishChat(chat);
    res.json(chat);
  });
  router.patch('/chats/:id/close', auth.required, validId, async (req, res) => {
    const chat = await Chat.findOneAndUpdate(
      { _id: req.params.id, ...participantFilter(req.user) },
      { $set: { status: 'closed' } },
      { new: true, runValidators: true },
    );
    if (!chat) throw new HttpError(404, 'Chat not found.');
    await req.app.locals.realtime?.publishChat(chat);
    res.json(chat);
  });
  router.post('/chats/:id/messages', auth.required, validId, async (req, res) => {
    const result = await sendMessage(req.params.id, req.user, parse(messageInput, req.body));
    if (result.created) await req.app.locals.realtime?.publishMessage(result.message);
    res.status(result.created ? 201 : 200).json(result.message);
  });
  router.get('/chats/:id/messages/sync', auth.required, validId, async (req, res) => {
    const { after, limit } = parse(syncInput, req.query);
    const chat = await Chat.findOne({ _id: req.params.id, ...participantFilter(req.user) }).lean();
    if (!chat) throw new HttpError(404, 'Chat not found.');
    const filter = { chat: chat._id };
    if (after) {
      const anchor = await Message.findOne({ _id: after, chat: chat._id }).lean();
      if (!anchor) throw new HttpError(400, 'Recovery cursor does not belong to this chat.');
      filter.$or = [
        { createdAt: { $gt: anchor.createdAt } },
        { createdAt: anchor.createdAt, _id: { $gt: anchor._id } },
      ];
    }
    const results = await Message.find(filter)
      .sort({ createdAt: 1, _id: 1 })
      .limit(limit + 1)
      .lean();
    const messages = results.slice(0, limit);
    res.json({
      messages,
      hasMore: results.length > limit,
      nextCursor: messages.at(-1)?._id ?? after ?? null,
    });
  });
  router.get('/chats/:id/messages/older', auth.required, validId, async (req, res) => {
    const { before, limit } = parse(olderInput, req.query);
    const chat = await Chat.findOne({ _id: req.params.id, ...participantFilter(req.user) }).lean();
    if (!chat) throw new HttpError(404, 'Chat not found.');
    const anchor = await Message.findOne({ _id: before, chat: chat._id }).lean();
    if (!anchor) throw new HttpError(400, 'History cursor does not belong to this chat.');
    const results = await Message.find({
      chat: chat._id,
      $or: [
        { createdAt: { $lt: anchor.createdAt } },
        { createdAt: anchor.createdAt, _id: { $lt: anchor._id } },
      ],
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    const messages = results.slice(0, limit);
    res.json({
      messages,
      hasMore: results.length > limit,
      nextCursor: messages.at(-1)?._id ?? before,
    });
  });
  router.get('/chats/:id/messages', auth.required, validId, async (req, res) => {
    res.json(await listHistory(req.params.id, req.user, parse(historyInput, req.query)));
  });
  return router;
}
