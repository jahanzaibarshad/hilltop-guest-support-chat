// Explicit real-database smoke check. Never drops a database or touches existing accounts.
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { io as connect } from 'socket.io-client';
import { connectDatabase } from '../src/config/database.js';
import { createHttpServer } from '../src/http.js';
import User from '../src/models/User.js';
import Chat from '../src/models/Chat.js';
import Message from '../src/models/Message.js';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
const marker = randomUUID();
const password = randomBytes(24).toString('hex');
const guestEmail = `smoke-guest-${marker}@example.invalid`;
const agentEmail = `smoke-agent-${marker}@example.invalid`;
const emails = [guestEmail, agentEmail];
const sockets = [];
let runtime, chatId;
let stage = 'configuration';
try {
  await connectDatabase();
  assert.equal(mongoose.connection.name, 'hilltop_support');
  stage = 'collection indexes';
  assert.ok(
    (await User.collection.indexes()).some((index) => index.unique && index.key.email === 1),
  );
  assert.ok(
    (await Message.collection.indexes()).some(
      (index) => index.unique && index.key.clientMessageId === 1,
    ),
  );
  const origin = process.env.CLIENT_URL || 'http://127.0.0.1:5175';
  runtime = createHttpServer({
    secret: process.env.JWT_SECRET,
    origin,
    production: false,
    trustProxy: 0,
  });
  await new Promise((resolve, reject) => {
    runtime.server.once('error', reject);
    runtime.server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${runtime.server.address().port}/api`;
  async function api(path, cookie, method = 'GET', body, status = 200) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, status);
    return { response, data: status === 204 ? null : await response.json() };
  }
  const cookieOf = (response) => response.headers.get('set-cookie').split(';')[0];
  stage = 'guest registration and agent login';
  const registration = await api(
    '/users',
    null,
    'POST',
    { name: 'Temporary Atlas Check Guest', email: guestEmail, password },
    201,
  );
  const guestCookie = cookieOf(registration.response);
  await User.create({
    name: 'Temporary Atlas Check Agent',
    email: agentEmail,
    role: 'agent',
    passwordHash: await bcrypt.hash(password, 12),
  });
  const agentLogin = await api('/auth/login', null, 'POST', { email: agentEmail, password });
  const agentCookie = cookieOf(agentLogin.response);
  await api('/auth/me', guestCookie);
  stage = 'guest chat and private assignment';
  const created = await api(
    '/chats',
    guestCookie,
    'POST',
    { subject: 'Temporary Atlas acceptance check', category: 'general' },
    201,
  );
  chatId = created.data._id;
  await api(`/chats/${chatId}/messages`, agentCookie, 'GET', undefined, 404);
  await api(`/chats/${chatId}/assign`, agentCookie, 'PATCH');
  const inbox = await api('/agent/chats?status=active', agentCookie);
  assert.ok(inbox.data.chats.some((chat) => chat._id === chatId));
  stage = 'transactional REST message';
  const first = await api(
    `/chats/${chatId}/messages`,
    guestCookie,
    'POST',
    { body: 'Atlas connection check guest message', clientMessageId: randomUUID() },
    201,
  );
  async function socketFor(cookie) {
    const socket = connect(base.replace(/\/api$/, ''), {
      autoConnect: false,
      reconnection: false,
      forceNew: true,
      transports: ['websocket'],
      timeout: 10000,
      extraHeaders: { Origin: origin, Cookie: cookie },
    });
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
      socket.connect();
    });
    assert.equal((await socket.timeout(10000).emitWithAck('joinChat', { chatId })).ok, true);
    return socket;
  }
  stage = 'socket authentication and private rooms';
  const guestSocket = await socketFor(guestCookie),
    agentSocket = await socketFor(agentCookie);
  stage = 'socket persistence and recipient delivery';
  const payload = {
    chatId,
    body: 'Atlas connection check agent reply',
    clientMessageId: randomUUID(),
  };
  let listener, timer;
  const received = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Delivery timeout')), 10000);
    listener = (message) => {
      if (message.clientMessageId === payload.clientMessageId) resolve(message);
    };
    guestSocket.on('newMessage', listener);
  });
  let ack, delivery;
  try {
    [ack, delivery] = await Promise.all([
      agentSocket.timeout(10000).emitWithAck('sendMessage', payload),
      received,
    ]);
  } finally {
    clearTimeout(timer);
    guestSocket.off('newMessage', listener);
  }
  assert.equal(ack.ok, true);
  assert.equal(ack.created, true);
  assert.equal(ack.message._id, delivery._id);
  stage = 'cross-transport idempotent retry';
  await api(`/chats/${chatId}/messages`, agentCookie, 'POST', {
    body: payload.body,
    clientMessageId: payload.clientMessageId,
  });
  assert.equal(await Message.countDocuments({ chat: chatId }), 2);
  stage = 'history search, pagination, date filters and recovery';
  const day = new Date().toISOString().slice(0, 10);
  const history = await api(
    `/chats/${chatId}/messages?search=Atlas&start=${day}&end=${day}&limit=1`,
    agentCookie,
  );
  assert.equal(history.data.pagination.total, 2);
  assert.equal(history.data.pagination.pages, 2);
  const second = await api(
    `/chats/${chatId}/messages?search=Atlas&start=${day}&end=${day}&limit=1&page=2&snapshot=${history.data.pagination.snapshot}`,
    agentCookie,
  );
  assert.equal(second.data.messages.length, 1);
  assert.notEqual(second.data.messages[0]._id, history.data.messages[0]._id);
  const recovery = await api(`/chats/${chatId}/messages/sync?after=${first.data._id}`, guestCookie);
  assert.equal(recovery.data.messages[0]._id, delivery._id);
  stage = 'read marker, closure, logout and readiness';
  const read = await api(`/chats/${chatId}/read`, agentCookie, 'POST', { messageId: delivery._id });
  assert.equal(read.data.unread, false);
  await api(`/chats/${chatId}/close`, agentCookie, 'PATCH');
  await api(
    `/chats/${chatId}/messages`,
    guestCookie,
    'POST',
    { body: 'Must not persist', clientMessageId: randomUUID() },
    409,
  );
  await api('/auth/logout', guestCookie, 'POST', undefined, 204);
  await api('/auth/me', guestCookie, 'GET', undefined, 401);
  assert.equal((await api('/health')).data.database, 'connected');
  console.log(
    'PASS: real Atlas indexes, auth, assignment/privacy, REST/socket delivery, retries, history/date/page filters, recovery, read markers, closure and logout.',
  );
} catch (error) {
  console.error(
    `Atlas check failed at ${stage}: ${error.name}; details suppressed to protect credentials.`,
  );
  process.exitCode = 1;
} finally {
  for (const socket of sockets) socket.disconnect();
  if (runtime) {
    runtime.server.closeAllConnections();
    await new Promise((resolve) => runtime.io.close(resolve));
  }
  if (mongoose.connection.readyState === 1) {
    try {
      const fixtureIds = (
        await User.find({ email: { $in: emails } })
          .select('_id')
          .lean()
      ).map((user) => user._id);
      if (chatId && fixtureIds.length) {
        const owned = await Chat.exists({ _id: chatId, guest: { $in: fixtureIds } });
        if (owned) {
          await Message.deleteMany({ chat: chatId });
          await Chat.deleteOne({ _id: chatId, guest: { $in: fixtureIds } });
        }
      }
      await User.deleteMany({ _id: { $in: fixtureIds }, email: { $in: emails } });
      console.log('Temporary smoke-check accounts/chat/messages cleaned; existing data preserved.');
    } catch {
      console.error(
        'Temporary smoke-check cleanup failed; inspect labelled acceptance fixtures before repeating.',
      );
      process.exitCode = 1;
    }
  }
  await mongoose.disconnect();
}
