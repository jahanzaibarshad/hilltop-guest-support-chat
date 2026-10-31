import { beforeAll, afterAll, afterEach, describe, expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import request from 'supertest';
import { io } from 'socket.io-client';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createHttpServer } from '../src/http.js';
import User from '../src/models/User.js';
import Chat from '../src/models/Chat.js';
import Message from '../src/models/Message.js';
const secret = 'isolated-agent-inbox-test-secret-not-production-123';
let database, directory, runtime, guest, agent, other;
const sockets = [];
async function identity(role) {
  const user = await User.create({
    name: role === 'agent' ? 'Support Person' : 'Private Guest',
    email: `${randomUUID()}@example.com`,
    passwordHash: await bcrypt.hash('Private-Test-Password42', 4),
    role,
  });
  const response = await request(runtime.app)
    .post('/api/auth/login')
    .send({ email: user.email, password: 'Private-Test-Password42' });
  return { user, cookie: response.headers['set-cookie'][0].split(';')[0] };
}
async function createChat(assigned = false, person = agent) {
  const response = await request(runtime.app)
    .post('/api/chats')
    .set('Cookie', guest.cookie)
    .send({ subject: 'Inbox question', category: 'booking' });
  expect(response.status).toBe(201);
  if (assigned)
    expect(
      (
        await request(runtime.app)
          .patch(`/api/chats/${response.body._id}/assign`)
          .set('Cookie', person.cookie)
      ).status,
    ).toBe(200);
  return response.body;
}
async function message(chat, body = 'A guest question') {
  const response = await request(runtime.app)
    .post(`/api/chats/${chat._id}/messages`)
    .set('Cookie', guest.cookie)
    .send({ body });
  expect(response.status).toBe(201);
  return response.body;
}
const inbox = (person = agent, query = '') =>
  request(runtime.app)
    .get('/api/agent/chats' + query)
    .set('Cookie', person.cookie);
const read = (chat, id, person = agent) =>
  request(runtime.app)
    .post(`/api/chats/${chat._id}/read`)
    .set('Cookie', person.cookie)
    .send({ messageId: id });
async function socketFor(person) {
  const socket = io(runtime.url, {
    autoConnect: false,
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    extraHeaders: { Origin: 'http://127.0.0.1:5175', Cookie: person.cookie },
  });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
    socket.connect();
  });
  return socket;
}
const eventOnce = (socket, event) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Missing ' + event)), 5000);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
beforeAll(async () => {
  directory = await mkdtemp(join(process.env.TEST_DB_ROOT || tmpdir(), 'hilltop-inbox-test-'));
  database = await MongoMemoryReplSet.create({
    instanceOpts: [{ dbPath: directory }],
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(database.getUri('hilltop_inbox_test'));
  await Promise.all([User.init(), Chat.init(), Message.init()]);
  runtime = createHttpServer({ secret, rateLimits: false });
  await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
  runtime.url = `http://127.0.0.1:${runtime.server.address().port}`;
  guest = await identity('guest');
  agent = await identity('agent');
  other = await identity('agent');
});
afterEach(() => {
  for (const socket of sockets) socket.disconnect();
  sockets.length = 0;
});
afterAll(async () => {
  if (runtime) await new Promise((resolve) => runtime.io.close(resolve));
  await mongoose.disconnect();
  if (database) await database.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});
describe('Scoped agent inbox', () => {
  test('requires authenticated agent role', async () => {
    expect((await request(runtime.app).get('/api/agent/chats')).status).toBe(401);
    expect((await inbox(guest)).status).toBe(403);
  });
  test('waiting queue exposes metadata and guest name, not message bodies or email', async () => {
    const chat = await createChat();
    await message(chat, 'Do not leak this message');
    const response = await inbox();
    expect(response.status).toBe(200);
    const row = response.body.chats.find((c) => c._id === chat._id);
    expect(row.guest.name).toBe('Private Guest');
    expect(row.guest.email).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('Do not leak this message');
    expect(
      (
        await request(runtime.app)
          .get(`/api/chats/${chat._id}/messages`)
          .set('Cookie', agent.cookie)
      ).status,
    ).toBe(404);
  });
  test('active and closed scopes show only this agent’s assignments', async () => {
    const mine = await createChat(true),
      foreign = await createChat(true, other);
    let response = await inbox(agent, '?status=active');
    expect(response.body.chats.some((c) => c._id === mine._id)).toBe(true);
    expect(response.body.chats.some((c) => c._id === foreign._id)).toBe(false);
    await request(runtime.app).patch(`/api/chats/${mine._id}/close`).set('Cookie', agent.cookie);
    response = await inbox(agent, '?status=closed');
    expect(response.body.chats.some((c) => c._id === mine._id)).toBe(true);
    expect(response.body.chats.every((c) => c.assignedAgent === String(agent.user._id))).toBe(true);
  });
  test('summary counts use the same agent scope', async () => {
    await createChat(true, other);
    const response = await inbox(agent, '?status=active');
    expect(response.body.summary.active).toBe(
      await Chat.countDocuments({ assignedAgent: agent.user._id, status: 'active' }),
    );
    expect(response.body.summary.waiting).toBe(
      await Chat.countDocuments({ assignedAgent: null, status: 'waiting' }),
    );
  });
  test('closed unassigned chats leave the waiting queue', async () => {
    const chat = await createChat();
    await request(runtime.app).patch(`/api/chats/${chat._id}/close`).set('Cookie', guest.cookie);
    expect((await inbox()).body.chats.some((c) => c._id === chat._id)).toBe(false);
  });
  test.each([
    '?status=invalid',
    '?page=0',
    '?limit=21',
    '?search=not-yet-supported',
    '?status[$ne]=closed',
  ])('rejects invalid inbox queries %s', async (query) => {
    expect((await inbox(agent, query)).status).toBe(400);
  });
  test('paginates queue with a maximum of 20 and stable ordering', async () => {
    await Chat.insertMany(
      Array.from({ length: 25 }, (_, i) => ({ guest: guest.user._id, subject: `Queue ${i}` })),
    );
    const first = (await inbox(agent, '?limit=20')).body,
      second = (await inbox(agent, '?limit=20&page=2')).body;
    expect(first.chats).toHaveLength(20);
    expect(first.pagination.pages).toBeGreaterThan(1);
    expect(first.chats.some((a) => second.chats.some((b) => b._id === a._id))).toBe(false);
  });
});
describe('Durable unread markers', () => {
  test('new guest messages become unread; read marker persists without changing list timestamps', async () => {
    const chat = await createChat(true),
      sent = await message(chat);
    const before = await Chat.findById(chat._id);
    let response = await read(chat, sent._id);
    expect(response.status).toBe(200);
    expect(response.body.unread).toBe(false);
    expect(response.body.updatedAt).toBe(before.updatedAt.toISOString());
    const data = (await inbox(agent, '?status=active')).body;
    expect(data.chats.find((c) => c._id === chat._id).unread).toBe(false);
    await message(chat, 'Another message');
    expect(
      (await inbox(agent, '?status=active')).body.chats.find((c) => c._id === chat._id).unread,
    ).toBe(true);
  });
  test('an old read cursor cannot clear a newer guest message or regress a read marker', async () => {
    const chat = await createChat(true),
      first = await message(chat, 'First'),
      second = await message(chat, 'Second');
    expect((await read(chat, first._id)).body.unread).toBe(true);
    expect((await read(chat, second._id)).body.unread).toBe(false);
    expect((await read(chat, first._id)).body.unread).toBe(false);
  });
  test('unassigned agents, other agents and guests cannot mark another chat read', async () => {
    const chat = await createChat(true),
      sent = await message(chat);
    expect((await read(chat, sent._id, other)).status).toBe(404);
    expect((await read(chat, sent._id, guest)).status).toBe(403);
  });
  test('read cursor must be a real message in this chat', async () => {
    const chat = await createChat(true),
      foreign = await createChat(true),
      sent = await message(foreign);
    expect((await read(chat, sent._id)).status).toBe(400);
    expect((await read(chat, 'invalid')).status).toBe(400);
  });
  test('closed assigned chats retain readable history and can be marked read', async () => {
    const chat = await createChat(true),
      sent = await message(chat);
    await request(runtime.app).patch(`/api/chats/${chat._id}/close`).set('Cookie', agent.cookie);
    expect((await read(chat, sent._id)).body.unread).toBe(false);
    expect(
      (
        await request(runtime.app)
          .get(`/api/chats/${chat._id}/messages`)
          .set('Cookie', agent.cookie)
      ).status,
    ).toBe(200);
  });
});
describe('Full history and live invalidation privacy', () => {
  test('older history uses a stable cursor despite newly arriving messages', async () => {
    const chat = await createChat(true);
    const records = await Message.insertMany(
      Array.from({ length: 45 }, (_, i) => ({
        chat: chat._id,
        sender: guest.user._id,
        senderRole: 'guest',
        body: `History ${i}`,
        clientMessageId: randomUUID(),
        createdAt: new Date(1700000000000 + i * 1000),
      })),
    );
    const first = (
      await request(runtime.app).get(`/api/chats/${chat._id}/messages`).set('Cookie', agent.cookie)
    ).body;
    await message(chat, 'New incoming message');
    let cursor = first.messages.at(-1)._id,
      more = true;
    const loaded = [...first.messages];
    while (more) {
      const response = await request(runtime.app)
        .get(`/api/chats/${chat._id}/messages/older?before=${cursor}`)
        .set('Cookie', agent.cookie);
      expect(response.status).toBe(200);
      loaded.push(...response.body.messages);
      more = response.body.hasMore;
      cursor = response.body.nextCursor;
    }
    expect(loaded).toHaveLength(45);
    expect(new Set(loaded.map((m) => m._id)).size).toBe(45);
    expect(loaded.at(-1)._id).toBe(String(records[0]._id));
  });
  test('older-history route enforces participant and cursor validation', async () => {
    const chat = await createChat(true),
      sent = await message(chat);
    const path = `/api/chats/${chat._id}/messages/older?before=${sent._id}`;
    expect((await request(runtime.app).get(path).set('Cookie', other.cookie)).status).toBe(404);
    expect(
      (
        await request(runtime.app)
          .get(path + '&limit=21')
          .set('Cookie', agent.cookie)
      ).status,
    ).toBe(400);
  });
  test('new chats notify agents with no message payload; guests receive no inbox event', async () => {
    const support = await socketFor(agent),
      visitor = await socketFor(guest);
    const guestEvents = [];
    visitor.on('inboxChanged', (data) => guestEvents.push(data));
    const event = eventOnce(support, 'inboxChanged');
    await createChat();
    expect(await event).toEqual({});
    expect(guestEvents).toHaveLength(0);
  });
  test('message and read changes refresh other agent tabs, but repeated reads do not loop', async () => {
    const support = await socketFor(agent),
      chat = await createChat(true);
    const arrived = eventOnce(support, 'inboxChanged');
    const sent = await message(chat);
    expect(await arrived).toEqual({});
    const readEvent = eventOnce(support, 'inboxChanged');
    expect((await read(chat, sent._id)).status).toBe(200);
    expect(await readEvent).toEqual({});
    const events = [];
    support.on('inboxChanged', (e) => events.push(e));
    await read(chat, sent._id);
    expect(events).toHaveLength(0);
  });
  test('role changes revoke inbox invalidations for already-connected sockets', async () => {
    const person = await identity('agent'),
      socket = await socketFor(person);
    const events = [];
    socket.on('inboxChanged', (e) => events.push(e));
    await User.updateOne({ _id: person.user._id }, { $set: { role: 'guest' } });
    await createChat();
    expect(events).toHaveLength(0);
    expect(runtime.io.sockets.sockets.get(socket.id).rooms.has('agent-inbox')).toBe(false);
  });
});
