import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import request from 'supertest';
import { io as connect } from 'socket.io-client';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createHttpServer } from '../src/http.js';
import User from '../src/models/User.js';
import Chat from '../src/models/Chat.js';
import Message from '../src/models/Message.js';
import { mergeMessages } from '../../client/src/realtime.js';
const secret = 'isolated-socket-test-secret-never-used-in-production-42';
const origin = 'http://127.0.0.1:5175';
const password = 'Private-socket-test-password42';
let database, directory, runtime, guest, agent, outsider;
const sockets = new Set(),
  extraRuntimes = new Set();
async function identity(role = 'guest') {
  const user = await User.create({
    name: 'Socket Test',
    email: `${randomUUID()}@example.com`,
    passwordHash: await bcrypt.hash(password, 4),
    role,
  });
  const response = await request(runtime.app)
    .post('/api/auth/login')
    .send({ email: user.email, password });
  expect(response.status).toBe(200);
  return { user, cookie: response.headers['set-cookie'][0].split(';')[0] };
}
async function listening(options = {}) {
  const result = createHttpServer({ secret, origin, rateLimits: false, ...options });
  await new Promise((resolve, reject) => {
    result.server.once('error', reject);
    result.server.listen(0, '127.0.0.1', resolve);
  });
  result.url = `http://127.0.0.1:${result.server.address().port}`;
  return result;
}
function rawSocket(person, options = {}, host = runtime) {
  const socket = connect(host.url, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    transports: ['websocket'],
    timeout: 2500,
    extraHeaders: { Origin: origin, ...(person ? { Cookie: person.cookie } : {}) },
    ...options,
  });
  sockets.add(socket);
  return socket;
}
async function socketFor(person, options = {}, host = runtime) {
  const socket = rawSocket(person, options, host);
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
    socket.connect();
  });
  return socket;
}
const acknowledge = (socket, event, input) =>
  new Promise((resolve, reject) =>
    socket
      .timeout(5000)
      .emit(event, input, (error, result) => (error ? reject(error) : resolve(result))),
  );
const eventOnce = (socket, event) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Missing ${event}`)), 5000);
    socket.once(event, (value) => {
      clearTimeout(timeout);
      resolve(value);
    });
  });
async function chatFor(person = guest, assigned = false) {
  const response = await request(runtime.app)
    .post('/api/chats')
    .set('Cookie', person.cookie)
    .send({ subject: 'A real-time question' });
  expect(response.status).toBe(201);
  if (assigned)
    expect(
      (
        await request(runtime.app)
          .patch(`/api/chats/${response.body._id}/assign`)
          .set('Cookie', agent.cookie)
      ).status,
    ).toBe(200);
  return response.body;
}
const input = (chat, body = 'Hello support') => ({
  chatId: chat._id,
  body,
  clientMessageId: randomUUID(),
});
beforeAll(async () => {
  directory = await mkdtemp(join(process.env.TEST_DB_ROOT || tmpdir(), 'hilltop-socket-test-'));
  database = await MongoMemoryReplSet.create({
    instanceOpts: [{ dbPath: directory }],
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(database.getUri('hilltop_socket_test'));
  await Promise.all([User.init(), Chat.init(), Message.init()]);
  runtime = await listening();
  guest = await identity();
  agent = await identity('agent');
  outsider = await identity();
});
afterEach(async () => {
  for (const socket of sockets) {
    socket.removeAllListeners();
    socket.disconnect();
  }
  sockets.clear();
  for (const extra of extraRuntimes) await new Promise((resolve) => extra.io.close(resolve));
  extraRuntimes.clear();
});
afterAll(async () => {
  if (runtime) await new Promise((resolve) => runtime.io.close(resolve));
  await mongoose.disconnect();
  if (database) await database.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('Socket authentication and private rooms', () => {
  test.each([undefined, { cookie: 'hilltop_session=tampered' }])(
    'rejects missing/tampered cookies %#',
    async (person) => {
      await expect(socketFor(person)).rejects.toMatchObject({ data: { status: 401 } });
    },
  );
  test('rejects expired JWTs', async () => {
    const token = jwt.sign({ v: 0 }, secret, {
      subject: String(guest.user._id),
      issuer: 'hilltop-support',
      audience: 'hilltop-web',
      expiresIn: -1,
    });
    await expect(socketFor({ cookie: 'hilltop_session=' + token })).rejects.toMatchObject({
      data: { status: 401 },
    });
  });
  test('rejects a foreign WebSocket origin, not just CORS reads', async () => {
    await expect(
      socketFor(guest, { extraHeaders: { Origin: 'https://evil.example', Cookie: guest.cookie } }),
    ).rejects.toThrow();
  });
  test('polling and REST share the same HTTP server', async () => {
    const socket = await socketFor(guest, { transports: ['polling'] });
    expect(socket.connected).toBe(true);
    expect((await fetch(runtime.url + '/api/health')).status).toBe(200);
  });
  test('guest can join their own room but cannot join another guest room', async () => {
    const chat = await chatFor();
    const own = await socketFor(guest),
      stranger = await socketFor(outsider);
    expect((await acknowledge(own, 'joinChat', { chatId: chat._id })).ok).toBe(true);
    expect(await acknowledge(stranger, 'joinChat', { chatId: chat._id })).toMatchObject({
      ok: false,
      status: 404,
    });
  });
  test('agent must be assigned before joining', async () => {
    const chat = await chatFor();
    const socket = await socketFor(agent);
    expect((await acknowledge(socket, 'joinChat', { chatId: chat._id })).status).toBe(404);
    await request(runtime.app).patch(`/api/chats/${chat._id}/assign`).set('Cookie', agent.cookie);
    expect((await acknowledge(socket, 'joinChat', { chatId: chat._id })).ok).toBe(true);
  });
  test.each([{ chatId: 'bad' }, { chatId: 'a'.repeat(24), role: 'agent' }, {}])(
    'validates room payload %#',
    async (payload) => {
      const socket = await socketFor(guest);
      expect((await acknowledge(socket, 'joinChat', payload)).status).toBe(400);
    },
  );
  test('room switches and explicit leave stop receiving the previous chat', async () => {
    const first = await chatFor(),
      second = await chatFor();
    const socket = await socketFor(guest);
    await acknowledge(socket, 'joinChat', { chatId: first._id });
    await acknowledge(socket, 'joinChat', { chatId: second._id });
    const rooms = runtime.io.sockets.sockets.get(socket.id).rooms;
    expect(rooms.has('chat:' + first._id)).toBe(false);
    expect(rooms.has('chat:' + second._id)).toBe(true);
    expect((await acknowledge(socket, 'leaveChat', { chatId: second._id })).ok).toBe(true);
    expect(rooms.has('chat:' + second._id)).toBe(false);
  });
});

describe('Persisted delivery and cross-transport retries', () => {
  test('acknowledges persistence before inbox publication completes or rejects', async () => {
    const host = await listening();
    extraRuntimes.add(host);
    const chat = await chatFor();
    const sender = await socketFor(guest, {}, host);
    let rejectPublication;
    const publication = new Promise((resolve, reject) => {
      rejectPublication = reject;
    });
    const notify = jest.spyOn(host.app.locals.realtime, 'notifyInbox').mockReturnValue(publication);
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const payload = input(chat);
    const replies = [];
    try {
      const result = await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Success ack waited for publication')),
          4000,
        );
        sender.emit('sendMessage', payload, (reply) => {
          replies.push(reply);
          clearTimeout(timeout);
          resolve(reply);
        });
      });
      expect(result).toMatchObject({ ok: true, created: true });
      expect(await Message.exists({ _id: result.message._id })).not.toBeNull();
      rejectPublication(new Error('Simulated inbox delivery failure'));
      for (let attempt = 0; attempt < 100 && !log.mock.calls.length; attempt++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      expect(notify).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith('Live delivery deferred to history recovery:', 'Error');
      expect(replies).toEqual([result]);
      const history = await request(host.app)
        .get(`/api/chats/${chat._id}/messages`)
        .set('Cookie', guest.cookie);
      expect(history.status).toBe(200);
      expect(history.body.messages.some((message) => message._id === result.message._id)).toBe(
        true,
      );
      const retry = await acknowledge(sender, 'sendMessage', payload);
      expect(retry).toMatchObject({
        ok: true,
        created: false,
        message: { _id: result.message._id },
      });
      expect(await Message.countDocuments({ chat: chat._id })).toBe(1);
    } finally {
      rejectPublication(new Error('Test teardown'));
      notify.mockRestore();
      log.mockRestore();
    }
  });
  test('guest and assigned agent receive one saved message, outsiders receive none', async () => {
    const chat = await chatFor(guest, true);
    const sender = await socketFor(guest),
      recipient = await socketFor(agent),
      stranger = await socketFor(outsider);
    await acknowledge(sender, 'joinChat', { chatId: chat._id });
    await acknowledge(recipient, 'joinChat', { chatId: chat._id });
    const unrelated = [];
    stranger.on('newMessage', (m) => unrelated.push(m));
    const received = eventOnce(recipient, 'newMessage');
    const result = await acknowledge(sender, 'sendMessage', input(chat));
    const message = await received;
    expect(result).toMatchObject({ ok: true, created: true });
    expect(message._id).toBe(result.message._id);
    expect(message.sender).toBe(String(guest.user._id));
    expect(await Message.exists({ _id: message._id })).not.toBeNull();
    expect(unrelated).toHaveLength(0);
    const reply = eventOnce(sender, 'newMessage');
    expect((await acknowledge(recipient, 'sendMessage', input(chat, 'Happy to help'))).ok).toBe(
      true,
    );
    expect((await reply).senderRole).toBe('agent');
  });
  test('REST messages broadcast to connected participants', async () => {
    const chat = await chatFor();
    const socket = await socketFor(guest);
    await acknowledge(socket, 'joinChat', { chatId: chat._id });
    const delivered = eventOnce(socket, 'newMessage');
    const response = await request(runtime.app)
      .post(`/api/chats/${chat._id}/messages`)
      .set('Cookie', guest.cookie)
      .send({ body: 'REST to socket' });
    expect(response.status).toBe(201);
    expect((await delivered)._id).toBe(response.body._id);
  });
  test('socket/REST retries save and broadcast exactly once', async () => {
    const chat = await chatFor();
    const socket = await socketFor(guest);
    await acknowledge(socket, 'joinChat', { chatId: chat._id });
    const events = [];
    socket.on('newMessage', (m) => events.push(m));
    const payload = input(chat);
    const first = await acknowledge(socket, 'sendMessage', payload);
    const second = await acknowledge(socket, 'sendMessage', payload);
    const rest = await request(runtime.app)
      .post(`/api/chats/${chat._id}/messages`)
      .set('Cookie', guest.cookie)
      .send({ body: payload.body, clientMessageId: payload.clientMessageId });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(rest.status).toBe(200);
    expect(await Message.countDocuments({ chat: chat._id })).toBe(1);
    expect(events).toHaveLength(1);
    expect(
      (await acknowledge(socket, 'sendMessage', { ...payload, body: 'different' })).status,
    ).toBe(409);
  });
  test.each([
    { body: ' ' },
    { body: 'x'.repeat(2001) },
    { body: 'text', clientMessageId: undefined },
    { body: 'text', sender: 'forged' },
    { body: { $ne: null } },
  ])('invalid message never persists or broadcasts %#', async (overrides) => {
    const chat = await chatFor();
    const socket = await socketFor(guest);
    const result = await acknowledge(socket, 'sendMessage', { ...input(chat), ...overrides });
    expect(result.status).toBe(400);
    expect(await Message.countDocuments({ chat: chat._id })).toBe(0);
  });
  test('guessing a chat ID does not authorize sending', async () => {
    const chat = await chatFor();
    const socket = await socketFor(outsider);
    expect((await acknowledge(socket, 'sendMessage', input(chat))).status).toBe(404);
    expect(await Message.countDocuments({ chat: chat._id })).toBe(0);
  });
  test('closing a chat updates participants and prevents new messages', async () => {
    const chat = await chatFor();
    const socket = await socketFor(guest);
    await acknowledge(socket, 'joinChat', { chatId: chat._id });
    const updated = eventOnce(socket, 'chatUpdated');
    expect(
      (await request(runtime.app).patch(`/api/chats/${chat._id}/close`).set('Cookie', guest.cookie))
        .status,
    ).toBe(200);
    expect((await updated).status).toBe('closed');
    expect((await acknowledge(socket, 'sendMessage', input(chat))).status).toBe(409);
  });
});

describe('Revocation, rate limits and offline recovery', () => {
  test('logout disconnects live sessions and revokes copied JWTs across REST and sockets', async () => {
    const person = await identity();
    const socket = await socketFor(person);
    const disconnected = eventOnce(socket, 'disconnect');
    await request(runtime.app).post('/api/auth/logout').set('Cookie', person.cookie);
    await disconnected;
    expect(socket.connected).toBe(false);
    expect(
      (await request(runtime.app).get('/api/auth/me').set('Cookie', person.cookie)).status,
    ).toBe(401);
    await expect(socketFor(person)).rejects.toMatchObject({ data: { status: 401 } });
  });
  test('connected sockets are disconnected when their JWT expires', async () => {
    const person = await identity();
    const token = jwt.sign({ v: 0 }, secret, {
      subject: String(person.user._id),
      issuer: 'hilltop-support',
      audience: 'hilltop-web',
      expiresIn: 2,
    });
    const socket = await socketFor({ cookie: 'hilltop_session=' + token });
    const expired = eventOnce(socket, 'sessionError');
    await eventOnce(socket, 'disconnect');
    expect((await expired).status).toBe(401);
  });
  test('logout also revokes sessions for legacy users without a stored sessionVersion field', async () => {
    const person = await identity();
    await User.collection.updateOne({ _id: person.user._id }, { $unset: { sessionVersion: '' } });
    expect(
      (await request(runtime.app).post('/api/auth/logout').set('Cookie', person.cookie)).status,
    ).toBe(204);
    expect(
      (await request(runtime.app).get('/api/auth/me').set('Cookie', person.cookie)).status,
    ).toBe(401);
  });
  test('deleted users cannot keep using an existing socket', async () => {
    const person = await identity();
    const socket = await socketFor(person);
    await User.deleteOne({ _id: person.user._id });
    expect(
      (await acknowledge(socket, 'joinChat', { chatId: new mongoose.Types.ObjectId().toString() }))
        .status,
    ).toBe(401);
  });
  test('recipient permissions are rechecked before broadcast, not only at room join', async () => {
    const person = await identity('agent'),
      chat = await chatFor();
    await request(runtime.app).patch(`/api/chats/${chat._id}/assign`).set('Cookie', person.cookie);
    const socket = await socketFor(person);
    await acknowledge(socket, 'joinChat', { chatId: chat._id });
    await User.updateOne({ _id: person.user._id }, { $set: { role: 'guest' } });
    const events = [];
    socket.on('newMessage', (m) => events.push(m));
    await request(runtime.app)
      .post(`/api/chats/${chat._id}/messages`)
      .set('Cookie', guest.cookie)
      .send({ body: 'Private after role change' });
    expect(events).toHaveLength(0);
    expect(runtime.io.sockets.sockets.get(socket.id).rooms.has('chat:' + chat._id)).toBe(false);
  });
  test('event limits are shared across a user’s connections and reconnects', async () => {
    const limited = await listening({ socketOptions: { eventLimit: 2 } });
    extraRuntimes.add(limited);
    const first = await socketFor(guest, {}, limited),
      second = await socketFor(guest, {}, limited),
      chat = await chatFor();
    expect((await acknowledge(first, 'joinChat', { chatId: chat._id })).ok).toBe(true);
    expect((await acknowledge(second, 'joinChat', { chatId: chat._id })).ok).toBe(true);
    expect((await acknowledge(first, 'leaveChat', { chatId: chat._id })).status).toBe(429);
    first.disconnect();
    const again = await socketFor(guest, {}, limited);
    expect((await acknowledge(again, 'joinChat', { chatId: chat._id })).status).toBe(429);
  });
  test('connection limit rejects excess sockets without disconnecting the first', async () => {
    const limited = await listening({ socketOptions: { maxConnectionsPerIp: 1 } });
    extraRuntimes.add(limited);
    const first = await socketFor(guest, {}, limited),
      second = rawSocket(outsider, {}, limited);
    const rejected = eventOnce(second, 'sessionError');
    second.connect();
    expect((await rejected).status).toBe(429);
    expect(first.connected).toBe(true);
  });
  test('reconnect recovery retrieves more than 20 missed persisted messages without a gap', async () => {
    const chat = await chatFor(guest, true);
    const socket = await socketFor(guest);
    await acknowledge(socket, 'joinChat', { chatId: chat._id });
    const baseline = await acknowledge(socket, 'sendMessage', input(chat, 'Before disconnect'));
    socket.disconnect();
    for (let i = 0; i < 25; i++)
      expect(
        (
          await request(runtime.app)
            .post(`/api/chats/${chat._id}/messages`)
            .set('Cookie', agent.cookie)
            .send({ body: `Offline message ${i}` })
        ).status,
      ).toBe(201);
    const reconnected = await socketFor(guest);
    expect((await acknowledge(reconnected, 'joinChat', { chatId: chat._id })).ok).toBe(true);
    const recovered = [];
    let cursor = baseline.message._id,
      more = true;
    while (more) {
      const response = await request(runtime.app)
        .get(`/api/chats/${chat._id}/messages/sync?after=${cursor}&limit=10`)
        .set('Cookie', guest.cookie);
      expect(response.status).toBe(200);
      recovered.push(...response.body.messages);
      more = response.body.hasMore;
      cursor = response.body.nextCursor;
    }
    expect(recovered).toHaveLength(25);
    expect(new Set(recovered.map((m) => m._id)).size).toBe(25);
    expect(recovered[0].body).toBe('Offline message 0');
    expect(recovered.at(-1).body).toBe('Offline message 24');
  });
  test('sync validates its cursor, limit and participant access', async () => {
    const chat = await chatFor();
    const path = `/api/chats/${chat._id}/messages/sync`;
    expect((await request(runtime.app).get(path).set('Cookie', outsider.cookie)).status).toBe(404);
    for (const query of [
      '?after=bad',
      '?limit=21',
      '?unexpected=true',
      `?after=${new mongoose.Types.ObjectId()}`,
    ])
      expect(
        (
          await request(runtime.app)
            .get(path + query)
            .set('Cookie', guest.cookie)
        ).status,
      ).toBe(400);
    const response = await request(runtime.app).get(path).set('Cookie', guest.cookie);
    expect(response.body).toEqual({ messages: [], hasMore: false, nextCursor: null });
  });
  test('client merge deduplicates acknowledgements/events and orders timestamp ties by ID', () => {
    const a = { _id: 'a', createdAt: '2026-10-27T00:00:00Z', body: 'first' },
      b = { ...a, _id: 'b', body: 'second' };
    expect(mergeMessages([b, a], [a, b])).toEqual([a, b]);
    expect(mergeMessages([a], [{ ...a, body: 'updated' }])).toEqual([{ ...a, body: 'updated' }]);
  });
});
