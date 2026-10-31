import { beforeAll, afterAll, describe, expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import User from '../src/models/User.js';
import Chat from '../src/models/Chat.js';
import Message from '../src/models/Message.js';
import { errorHandler } from '../src/lib/errors.js';
const app = createApp({
  secret: 'isolated-history-test-secret-not-for-production-123',
  rateLimits: false,
});
let database, directory, guest, stranger, agent, chat;
const literal = 'Literal .*(a)+?[x]$^ {2}\\path |';
const rows = [
  { body: 'Breakfast before boundary', createdAt: '2026-10-26T23:59:59.999Z' },
  { body: 'Breakfast at start', createdAt: '2026-10-27T00:00:00.000Z' },
  { body: 'Check-in at midday', createdAt: '2026-10-27T12:00:00.000Z' },
  { body: 'BREAKFAST at end', createdAt: '2026-10-27T23:59:59.999Z' },
  { body: 'Breakfast next day', createdAt: '2026-10-28T00:00:00.000Z' },
  { body: literal, createdAt: '2026-10-27T12:00:00.000Z' },
  { body: 'Noise only', createdAt: '2026-10-27T12:00:00.000Z' },
  { body: 'سلام guest café', createdAt: '2026-10-27T12:00:00.000Z' },
];
async function identity(role) {
  const user = await User.create({
    name: 'History Tester',
    email: `${randomUUID()}@example.com`,
    role,
    passwordHash: await bcrypt.hash('Private-Test-Password42', 4),
  });
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: user.email, password: 'Private-Test-Password42' });
  return { user, cookie: login.headers['set-cookie'][0].split(';')[0] };
}
async function fixture(messages = rows) {
  const item = await Chat.create({ guest: guest.user._id, subject: 'History filtering' });
  if (messages.length)
    await Message.insertMany(
      messages.map((row) => ({
        ...row,
        chat: item._id,
        sender: guest.user._id,
        senderRole: 'guest',
        clientMessageId: randomUUID(),
      })),
    );
  return item;
}
const get = (query = '', person = guest, item = chat) =>
  request(app).get(`/api/chats/${item._id}/messages${query}`).set('Cookie', person.cookie);
beforeAll(async () => {
  directory = await mkdtemp(join(process.env.TEST_DB_ROOT || tmpdir(), 'hilltop-history-test-'));
  database = await MongoMemoryReplSet.create({
    instanceOpts: [{ dbPath: directory }],
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(database.getUri('hilltop_history_test'));
  await Promise.all([User.init(), Chat.init(), Message.init()]);
  guest = await identity('guest');
  stranger = await identity('guest');
  agent = await identity('agent');
  chat = await fixture();
});
afterAll(async () => {
  await mongoose.disconnect();
  if (database) await database.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});
describe('Keyword and date history filtering', () => {
  test('case-insensitive literal substring search returns matching messages only', async () => {
    const response = await get('?search=AKFAS');
    expect(response.status).toBe(200);
    expect(response.body.pagination.total).toBe(4);
    expect(response.body.messages.every((m) => m.body.toLowerCase().includes('breakfast'))).toBe(
      true,
    );
  });
  test('regex metacharacters are escaped, not executed', async () => {
    const response = await get('?search=' + encodeURIComponent(literal));
    expect(response.status).toBe(200);
    expect(response.body.messages.map((m) => m.body)).toEqual([literal]);
  });
  test.each(['.*', '[x]', '\\path', '{2}', '(a)+?'])(
    'literal query %s cannot expand the regex match',
    async (search) => {
      const response = await get('?search=' + encodeURIComponent(search));
      expect(response.body.messages.map((m) => m.body)).toEqual([literal]);
    },
  );
  test('Unicode search is supported', async () => {
    expect((await get('?search=' + encodeURIComponent('سلام'))).body.pagination.total).toBe(1);
  });
  test('empty or whitespace keyword resets to all messages', async () => {
    expect((await get('?search=%20%20')).body.pagination.total).toBe(rows.length);
  });
  test('date-only filters include both boundaries of the selected UTC day', async () => {
    const response = await get('?start=2026-10-27&end=2026-10-27');
    expect(response.status).toBe(200);
    expect(response.body.pagination.total).toBe(6);
    expect(response.body.messages.some((m) => m.body === 'Breakfast at start')).toBe(true);
    expect(response.body.messages.some((m) => m.body === 'BREAKFAST at end')).toBe(true);
    expect(response.body.messages.every((m) => m.createdAt.startsWith('2026-10-27'))).toBe(true);
  });
  test('keyword and date filters intersect rather than overwrite each other', async () => {
    const response = await get('?search=breakfast&start=2026-10-27&end=2026-10-27');
    expect(response.body.messages.map((m) => m.body)).toEqual([
      'BREAKFAST at end',
      'Breakfast at start',
    ]);
  });
  test.each([
    ['?start=2026-10-28', 1],
    ['?end=2026-10-26', 1],
    ['?start=2024-02-29&end=2024-02-29', 0],
    ['?search=no-such-message', 0],
  ])('one-sided and empty filter %s', async (query, total) => {
    const response = await get(query);
    expect(response.status).toBe(200);
    expect(response.body.pagination.total).toBe(total);
    expect(response.body.pagination.pages).toBe(1);
  });
  test.each([
    '?start=2026-02-30',
    '?end=2025-02-29',
    '?start=2026-1-01',
    '?start=not-a-date',
    '?start=2026-10-28&end=2026-10-27',
    '?start=2026-10-27T00:00:00Z',
    '?search=' + 'x'.repeat(81),
    '?search=%00',
    '?search=a&search=b',
    '?search[$ne]=x',
    '?snapshot=bad',
    '?limit=21',
    '?page=0',
    '?page=1.5',
    '?unexpected=yes',
  ])('rejects malformed/injection-style query %s', async (query) => {
    expect((await get(query)).status).toBe(400);
  });
});
describe('Frozen history pagination and permission boundaries', () => {
  test('pages are at most 20, stable at timestamp ties, and exclude newly appended messages', async () => {
    const item = await fixture(
      Array.from({ length: 45 }, (_, i) => ({
        body: `Saved ${i}`,
        createdAt: '2026-01-01T00:00:00.000Z',
      })),
    );
    const first = (await get('', guest, item)).body;
    expect(first.messages).toHaveLength(20);
    expect(first.pagination).toMatchObject({ page: 1, limit: 20, total: 45, pages: 3 });
    const appended = await request(app)
      .post(`/api/chats/${item._id}/messages`)
      .set('Cookie', guest.cookie)
      .send({ body: 'Just arrived' });
    expect(appended.status).toBe(201);
    const snapshot = first.pagination.snapshot;
    const second = (await get(`?page=2&snapshot=${snapshot}`, guest, item)).body,
      third = (await get(`?page=3&snapshot=${snapshot}`, guest, item)).body;
    expect(second.messages).toHaveLength(20);
    expect(third.messages).toHaveLength(5);
    expect(second.pagination.total).toBe(45);
    expect(
      new Set([...first.messages, ...second.messages, ...third.messages].map((m) => m._id)).size,
    ).toBe(45);
    const refreshed = (await get('', guest, item)).body;
    expect(refreshed.pagination.total).toBe(46);
    expect(refreshed.messages[0].body).toBe('Just arrived');
    expect(
      (await get(`?snapshot=${snapshot}`, guest, item)).body.messages.map((m) => m._id),
    ).toEqual(first.messages.map((m) => m._id));
  });
  test('snapshot bound is intersected correctly with date and text constraints', async () => {
    const first = (await get('?search=breakfast&start=2026-10-27&end=2026-10-27&limit=1')).body;
    const second = (
      await get(
        `?search=breakfast&start=2026-10-27&end=2026-10-27&limit=1&page=2&snapshot=${first.pagination.snapshot}`,
      )
    ).body;
    expect(first.messages[0].body).toBe('BREAKFAST at end');
    expect(second.messages[0].body).toBe('Breakfast at start');
    expect(second.pagination.total).toBe(2);
  });
  test('an empty snapshot stays empty until an explicit refresh', async () => {
    const item = await fixture([]);
    const first = (await get('', guest, item)).body;
    expect(first.pagination.snapshot).toBe('empty');
    await request(app)
      .post(`/api/chats/${item._id}/messages`)
      .set('Cookie', guest.cookie)
      .send({ body: 'First message' });
    expect((await get('?snapshot=empty', guest, item)).body.pagination.total).toBe(0);
    expect((await get('', guest, item)).body.pagination.total).toBe(1);
  });
  test('page beyond available results is empty and reports the correct total', async () => {
    const response = await get('?page=9999&limit=20');
    expect(response.status).toBe(200);
    expect(response.body.messages).toHaveLength(0);
    expect(response.body.pagination.total).toBe(rows.length);
  });
  test('outsiders and unassigned agents cannot search or reuse a snapshot', async () => {
    const snapshot = (await get()).body.pagination.snapshot;
    expect((await get('?search=breakfast', stranger)).status).toBe(404);
    expect((await get('?snapshot=' + snapshot, agent)).status).toBe(404);
  });
  test('assigned agent can search closed history', async () => {
    const item = await fixture();
    await request(app).patch(`/api/chats/${item._id}/assign`).set('Cookie', agent.cookie);
    await request(app).patch(`/api/chats/${item._id}/close`).set('Cookie', agent.cookie);
    expect((await get('?search=breakfast', agent, item)).body.pagination.total).toBe(4);
  });
  test('foreign or missing snapshot is rejected without disclosing messages', async () => {
    const foreign = await fixture();
    const snapshot = (await get('', guest, foreign)).body.pagination.snapshot;
    expect((await get('?snapshot=' + snapshot)).status).toBe(400);
    expect((await get('?snapshot=' + new mongoose.Types.ObjectId())).status).toBe(400);
  });
  test('history index scopes ordering and date filters by chat', () => {
    expect(
      Message.schema
        .indexes()
        .some(([index]) => index.chat === 1 && index.createdAt === -1 && index._id === -1),
    ).toBe(true);
  });
  test('database search timeout becomes a readable 503 without internal details', () => {
    let status, body;
    const res = {
      headersSent: false,
      status: (value) => {
        status = value;
        return res;
      },
      json: (value) => {
        body = value;
        return res;
      },
    };
    errorHandler(
      Object.assign(new Error('internal database text'), { code: 50 }),
      {},
      res,
      () => {},
    );
    expect(status).toBe(503);
    expect(body.message).toContain('Narrow your filters');
    expect(JSON.stringify(body)).not.toContain('internal database');
  });
});
