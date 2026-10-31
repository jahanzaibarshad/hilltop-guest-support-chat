import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { connectDatabase } from '../src/config/database.js';
import User from '../src/models/User.js';
import Chat from '../src/models/Chat.js';
import Message from '../src/models/Message.js';
const secret = 'isolated-test-secret-not-used-by-the-app-123456';
const app = createApp({ secret, rateLimits: false });
const password = 'Private-test-password42';
let database, directory, guest, stranger, agent, otherAgent, guestId, agentId;
const startChat = async (client = guest, subject = 'Question about check-in') => {
  const response = await client.post('/api/chats').send({ subject, category: 'booking' });
  expect(response.status).toBe(201);
  return response.body;
};
beforeAll(async () => {
  directory = await mkdtemp(join(process.env.TEST_DB_ROOT || tmpdir(), 'hilltop-test-'));
  database = await MongoMemoryReplSet.create({
    instanceOpts: [{ dbPath: directory }],
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(database.getUri('hilltop_test'));
  await Promise.all([User.init(), Chat.init(), Message.init()]);
  guest = request.agent(app);
  const registration = await guest
    .post('/api/users')
    .send({ name: 'Guest One', email: 'guest@example.com', password });
  guestId = registration.body.user.id;
  for (const [email, role] of [
    ['stranger@example.com', 'guest'],
    ['agent@example.com', 'agent'],
    ['agent-two@example.com', 'agent'],
  ])
    await User.create({
      name: 'Test Person',
      email,
      role,
      passwordHash: await bcrypt.hash(password, 4),
    });
  [stranger, agent, otherAgent] = [request.agent(app), request.agent(app), request.agent(app)];
  for (const [client, email] of [
    [stranger, 'stranger@example.com'],
    [agent, 'agent@example.com'],
    [otherAgent, 'agent-two@example.com'],
  ]) {
    const response = await client.post('/api/auth/login').send({ email, password });
    expect(response.status).toBe(200);
    if (client === agent) agentId = response.body.user.id;
  }
});
afterAll(async () => {
  await mongoose.disconnect();
  if (database) await database.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('Users and authentication', () => {
  test('registration stores a hash and never returns it', async () => {
    const response = await request(app)
      .post('/api/users')
      .send({ name: 'Another Guest', email: 'Another@Example.com', password });
    expect(response.status).toBe(201);
    expect(response.body.user.role).toBe('guest');
    expect(response.body.user.email).toBe('another@example.com');
    expect(JSON.stringify(response.body)).not.toContain('password');
    const stored = await User.findById(response.body.user.id).select('+passwordHash');
    expect(stored.passwordHash).not.toBe(password);
    expect(await bcrypt.compare(password, stored.passwordHash)).toBe(true);
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Strict');
  });
  test('case-insensitive duplicate email returns 409', async () => {
    const response = await request(app)
      .post('/api/users')
      .send({ name: 'Duplicate', email: 'GUEST@example.com', password });
    expect(response.status).toBe(409);
  });
  test.each([
    { name: 'x', email: 'valid@example.com', password },
    { name: 'Guest', email: 'invalid', password },
    { name: 'Guest', email: 'valid@example.com', password: 'short' },
    { name: 'Guest', email: 'valid@example.com', password: 'é'.repeat(40) },
    { name: 'Guest', email: 'valid@example.com', password, role: 'agent' },
    { name: 'Guest', email: { $ne: null }, password },
  ])('rejects invalid or privilege-escalating registration %#', async (body) => {
    expect((await request(app).post('/api/users').send(body)).status).toBe(400);
  });
  test('wrong password returns 401 without revealing the user', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'guest@example.com', password: 'wrong' });
    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Email or password is incorrect.');
  });
  test('unknown email returns the same login error', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'missing@example.com', password });
    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Email or password is incorrect.');
  });
  test('invalid login data returns 400', async () => {
    expect((await request(app).post('/api/auth/login').send({ email: 'invalid' })).status).toBe(
      400,
    );
  });
  test('overlong login passwords are rejected rather than silently truncated', async () => {
    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .send({ email: 'guest@example.com', password: 'x'.repeat(73) })
      ).status,
    ).toBe(400);
  });
  test('session restores current database user', async () => {
    expect((await guest.get('/api/auth/me')).body.user.id).toBe(guestId);
  });
  test('tampered session returns 401', async () => {
    expect(
      (await request(app).get('/api/auth/me').set('Cookie', 'hilltop_session=invalid')).status,
    ).toBe(401);
  });
  test('logout clears the session', async () => {
    const client = request.agent(app);
    await client.post('/api/auth/login').send({ email: 'guest@example.com', password });
    const response = await client.post('/api/auth/logout');
    expect(response.status).toBe(204);
    expect((await client.get('/api/auth/me')).status).toBe(401);
    await guest.post('/api/auth/login').send({ email: 'guest@example.com', password });
  });
  test('deleted accounts lose access even with an unexpired cookie', async () => {
    const client = request.agent(app);
    const response = await client
      .post('/api/users')
      .send({ name: 'Temporary Guest', email: 'removed@example.com', password });
    await User.deleteOne({ _id: response.body.user.id });
    expect((await client.get('/api/auth/me')).status).toBe(401);
  });
});

describe('Chats and authorization', () => {
  test.each(['get', 'post'])('unauthenticated %s /chats is denied', async (method) => {
    expect((await request(app)[method]('/api/chats').send({ subject: 'A question' })).status).toBe(
      401,
    );
  });
  test('creates a guest-owned waiting chat', async () => {
    const chat = await startChat();
    expect(chat.guest).toBe(guestId);
    expect(chat.assignedAgent).toBeNull();
    expect(chat.status).toBe('waiting');
  });
  test('bare brief endpoint aliases work without an /api prefix', async () => {
    expect((await guest.post('/chats').send({ subject: 'Bare path chat' })).status).toBe(201);
    expect((await guest.get('/chats')).status).toBe(200);
  });
  test.each([
    { subject: ' ' },
    { subject: 'Valid subject', guest: 'fake' },
    { subject: 'Valid subject', category: 'invalid' },
    {},
  ])('validates chat input %#', async (body) => {
    expect((await guest.post('/api/chats').send(body)).status).toBe(400);
  });
  test('agents cannot create guest chats', async () => {
    expect((await agent.post('/api/chats').send({ subject: 'A chat' })).status).toBe(403);
  });
  test('guests see only their own chat list', async () => {
    const foreign = await startChat(stranger);
    const response = await guest.get('/api/chats');
    expect(response.body.chats.every((chat) => chat.guest === guestId)).toBe(true);
    expect(response.body.chats.map((chat) => chat._id)).not.toContain(foreign._id);
  });
  test('a participant can retrieve their chat; outsiders receive 404', async () => {
    const chat = await startChat();
    expect((await guest.get(`/api/chats/${chat._id}`)).status).toBe(200);
    expect((await stranger.get(`/api/chats/${chat._id}`)).status).toBe(404);
    expect((await agent.get(`/api/chats/${chat._id}`)).status).toBe(404);
  });
  test.each(['/api/chats/not-an-id', '/api/chats/not-an-id/messages'])(
    'invalid ID returns 400: %s',
    async (path) => {
      expect((await guest.get(path)).status).toBe(400);
    },
  );
  test('valid but missing ID returns 404', async () => {
    expect((await guest.get(`/api/chats/${new mongoose.Types.ObjectId()}`)).status).toBe(404);
  });
  test('guests cannot claim a chat', async () => {
    const chat = await startChat();
    expect((await guest.patch(`/api/chats/${chat._id}/assign`)).status).toBe(403);
  });
  test('concurrent assignment has exactly one winner', async () => {
    const chat = await startChat();
    const results = await Promise.all([
      agent.patch(`/api/chats/${chat._id}/assign`),
      otherAgent.patch(`/api/chats/${chat._id}/assign`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await Chat.findById(chat._id)).status).toBe('active');
  });
  test('only the assigned agent receives history access', async () => {
    const chat = await startChat();
    const response = await agent.patch(`/api/chats/${chat._id}/assign`);
    expect(response.body.assignedAgent).toBe(agentId);
    expect((await agent.get(`/api/chats/${chat._id}/messages`)).status).toBe(200);
    expect((await otherAgent.get(`/api/chats/${chat._id}/messages`)).status).toBe(404);
  });
  test('participants can close chats, unrelated guests cannot', async () => {
    const chat = await startChat();
    expect((await stranger.patch(`/api/chats/${chat._id}/close`)).status).toBe(404);
    expect((await guest.patch(`/api/chats/${chat._id}/close`)).body.status).toBe('closed');
    expect((await agent.patch(`/api/chats/${chat._id}/assign`)).status).toBe(409);
  });
  test.each(['?page=0', '?limit=21', '?page=1.5', '?page[$gt]=1', '?unexpected=true'])(
    'rejects invalid list queries %s',
    async (query) => {
      expect((await guest.get('/api/chats' + query)).status).toBe(400);
    },
  );
});

describe('Message persistence, privacy and retry safety', () => {
  test('persists required body, authenticated sender and chat timestamp', async () => {
    const chat = await startChat();
    const response = await guest
      .post(`/api/chats/${chat._id}/messages`)
      .send({ body: '  Is early check-in possible?  ' });
    expect(response.status).toBe(201);
    expect(response.body.body).toBe('Is early check-in possible?');
    expect(response.body.sender).toBe(guestId);
    expect(response.body.senderRole).toBe('guest');
    expect(await Message.countDocuments({ chat: chat._id })).toBe(1);
    expect((await Chat.findById(chat._id)).lastMessageAt.toISOString()).toBe(
      response.body.createdAt,
    );
  });
  test.each([
    {},
    { body: ' ' },
    { body: 'x'.repeat(2001) },
    { body: 'text', sender: 'fake' },
    { body: { $ne: null } },
    { body: 'text', clientMessageId: 'invalid' },
  ])('rejects invalid or spoofed messages %#', async (body) => {
    const chat = await startChat();
    expect((await guest.post(`/api/chats/${chat._id}/messages`).send(body)).status).toBe(400);
  });
  test('outsiders cannot read or send messages', async () => {
    const chat = await startChat();
    expect(
      (await stranger.post(`/api/chats/${chat._id}/messages`).send({ body: 'intrusion' })).status,
    ).toBe(404);
    expect((await stranger.get(`/api/chats/${chat._id}/messages`)).status).toBe(404);
    expect(
      (await agent.post(`/api/chats/${chat._id}/messages`).send({ body: 'before assignment' }))
        .status,
    ).toBe(404);
  });
  test('assigned agent can reply without leaking credentials', async () => {
    const chat = await startChat();
    await agent.patch(`/api/chats/${chat._id}/assign`);
    const response = await agent
      .post(`/api/chats/${chat._id}/messages`)
      .send({ body: 'Happy to help.' });
    expect(response.status).toBe(201);
    expect(response.body.senderRole).toBe('agent');
    expect(JSON.stringify(response.body)).not.toContain('password');
    expect((await guest.get(`/api/chats/${chat._id}/messages`)).body.messages[0]._id).toBe(
      response.body._id,
    );
  });
  test('retrying a client message ID does not create duplicates', async () => {
    const chat = await startChat();
    const body = { body: 'Only send this once.', clientMessageId: randomUUID() };
    const first = await guest.post(`/api/chats/${chat._id}/messages`).send(body);
    const second = await guest.post(`/api/chats/${chat._id}/messages`).send(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body._id).toBe(first.body._id);
    expect(await Message.countDocuments({ chat: chat._id })).toBe(1);
    expect(
      (
        await guest
          .post(`/api/chats/${chat._id}/messages`)
          .send({ ...body, body: 'Different text' })
      ).status,
    ).toBe(409);
  });
  test('concurrent retries persist exactly one message', async () => {
    const chat = await startChat();
    const body = { body: 'Concurrent retry', clientMessageId: randomUUID() };
    const results = await Promise.all([
      guest.post(`/api/chats/${chat._id}/messages`).send(body),
      guest.post(`/api/chats/${chat._id}/messages`).send(body),
    ]);
    expect(results.every((r) => [200, 201].includes(r.status))).toBe(true);
    expect(await Message.countDocuments({ chat: chat._id })).toBe(1);
  });
  test('closed chats reject new messages but retain readable history', async () => {
    const chat = await startChat();
    await guest.post(`/api/chats/${chat._id}/messages`).send({ body: 'Before closing' });
    await guest.patch(`/api/chats/${chat._id}/close`);
    expect(
      (await guest.post(`/api/chats/${chat._id}/messages`).send({ body: 'After closing' })).status,
    ).toBe(409);
    expect((await guest.get(`/api/chats/${chat._id}/messages`)).body.messages).toHaveLength(1);
  });
  test('history defaults to 20 messages, newest first, with stable pagination', async () => {
    const chat = await startChat();
    const records = Array.from({ length: 23 }, (_, i) => ({
      chat: chat._id,
      sender: guestId,
      senderRole: 'guest',
      body: `Message ${i}`,
      clientMessageId: randomUUID(),
      createdAt: new Date(Date.now() + i * 1000),
    }));
    await Message.insertMany(records);
    const first = await guest.get(`/api/chats/${chat._id}/messages`);
    const second = await guest.get(`/api/chats/${chat._id}/messages?page=2`);
    expect(first.body.messages).toHaveLength(20);
    expect(first.body.messages[0].body).toBe('Message 22');
    expect(second.body.messages).toHaveLength(3);
    expect(first.body.pagination).toMatchObject({
      page: 1,
      limit: 20,
      total: 23,
      pages: 2,
      snapshot: expect.any(String),
    });
    expect(first.body.messages.some((a) => second.body.messages.some((b) => b._id === a._id))).toBe(
      false,
    );
    expect((await guest.get(`/api/chats/${chat._id}/messages?limit=21`)).status).toBe(400);
  });
});

describe('HTTP security and configuration', () => {
  test('health reports an authenticated database connection', async () => {
    expect((await request(app).get('/api/health')).body.database).toBe('connected');
    expect((await request(app).get('/health')).status).toBe(200);
  });
  test('rejects untrusted browser origins on write requests', async () => {
    expect(
      (
        await guest
          .post('/api/chats')
          .set('Origin', 'https://evil.example')
          .send({ subject: 'Forbidden origin' })
      ).status,
    ).toBe(403);
  });
  test('allows configured browser origin with credentialed CORS', async () => {
    const response = await guest.get('/api/auth/me').set('Origin', 'http://127.0.0.1:5175');
    expect(response.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5175');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });
  test('sets security headers and removes framework disclosure', async () => {
    const response = await request(app).get('/api/health');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
  test('malformed JSON returns 400', async () => {
    expect(
      (await request(app).post('/api/users').set('Content-Type', 'application/json').send('{'))
        .status,
    ).toBe(400);
  });
  test('large request bodies return 413', async () => {
    expect((await guest.post('/api/chats').send({ subject: 'x'.repeat(12000) })).status).toBe(413);
  });
  test('compressed requests are rejected', async () => {
    expect(
      (
        await request(app)
          .post('/api/users')
          .set('Content-Type', 'application/json')
          .set('Content-Encoding', 'gzip')
          .send('compressed')
      ).status,
    ).toBe(415);
  });
  test('API rate limit returns 429', async () => {
    const limited = createApp({ secret, maxRequests: 2 });
    expect((await request(limited).get('/api/health')).status).toBe(200);
    expect((await request(limited).get('/api/health')).status).toBe(200);
    expect((await request(limited).get('/api/health')).status).toBe(429);
  });
  test('production cookies require secure transport', async () => {
    const production = createApp({
      secret,
      production: true,
      origin: 'https://hilltop.example',
      rateLimits: false,
    });
    const response = await request(production)
      .post('/api/auth/login')
      .set('Origin', 'https://hilltop.example')
      .send({ email: 'guest@example.com', password });
    expect(response.headers['set-cookie'][0]).toContain('Secure');
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
  });
  test('rejects unsafe runtime configuration', () => {
    expect(() => createApp({ secret: 'short' })).toThrow('JWT_SECRET');
    expect(() =>
      createApp({ secret, production: true, origin: 'http://insecure.example' }),
    ).toThrow('HTTPS');
    expect(() => createApp({ secret, origin: 'https://hilltop.example/path' })).toThrow('origin');
    expect(() => createApp({ secret, trustProxy: 'true' })).toThrow('TRUST_PROXY');
  });
  test('a missing URI does not silently create a temporary database', async () => {
    await expect(connectDatabase('')).rejects.toThrow('MONGODB_URI');
  });
  test('unknown endpoints return a JSON 404', async () => {
    const response = await request(app).get('/api/not-an-endpoint');
    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Endpoint not found.');
  });
});
