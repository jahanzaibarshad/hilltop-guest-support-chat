// Fixed loopback-only fixture: deliberately does not import dotenv or accept a target URI/URL.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir, cpus, totalmem, platform, release } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { io as connect } from 'socket.io-client';
import { createHttpServer } from '../src/http.js';
import User from '../src/models/User.js';
import Chat from '../src/models/Chat.js';
import Message from '../src/models/Message.js';

if (process.argv.slice(2).some((argument) => argument !== '--report'))
  throw new Error('Only --report is supported; external targets are deliberately not accepted.');

let database, directory, runtime;
const sockets = [];
const results = [];
const delay = monitorEventLoopDelay({ resolution: 20 });
const percentile = (values, fraction) =>
  values[Math.max(0, Math.ceil(values.length * fraction) - 1)];
async function measure(name, count, concurrency, p95BudgetMs, operation) {
  const timings = [];
  let next = 0,
    failures = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < count) {
        const index = next++;
        const start = performance.now();
        try {
          await operation(index);
        } catch {
          failures++;
        }
        timings.push(performance.now() - start);
      }
    }),
  );
  const elapsedMs = performance.now() - started;
  timings.sort((a, b) => a - b);
  const rounded = (value) => Math.round(value * 100) / 100;
  const p95Ms = rounded(percentile(timings, 0.95));
  const result = {
    name,
    count,
    concurrency,
    failures,
    p50Ms: rounded(percentile(timings, 0.5)),
    p95Ms,
    maxMs: rounded(timings.at(-1)),
    elapsedMs: rounded(elapsedMs),
    operationsPerSecond: rounded((count * 1000) / elapsedMs),
    p95BudgetMs,
    passed: failures === 0 && p95Ms <= p95BudgetMs,
  };
  results.push(result);
  console.log(JSON.stringify(result));
}
const acknowledge = (socket, event, payload) => socket.timeout(8000).emitWithAck(event, payload);
try {
  directory = await mkdtemp(join(process.env.TEST_DB_ROOT || tmpdir(), 'hilltop-performance-'));
  database = await MongoMemoryReplSet.create({
    instanceOpts: [{ dbPath: directory }],
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(database.getUri('hilltop_performance'));
  await Promise.all([User.init(), Chat.init(), Message.init()]);
  const password = randomBytes(24).toString('hex');
  const passwordHash = await bcrypt.hash(password, 12);
  const [guest, agent] = await User.create([
    { name: 'Performance Guest', email: 'guest@example.test', passwordHash, role: 'guest' },
    { name: 'Performance Agent', email: 'agent@example.test', passwordHash, role: 'agent' },
  ]);
  const chats = await Chat.create(
    Array.from({ length: 41 }, (_, index) => ({
      guest: guest._id,
      subject: `Performance question ${index}`,
      assignedAgent: agent._id,
      status: 'active',
    })),
  );
  const chat = chats[0];
  const startDate = Date.UTC(2026, 9, 1);
  await Message.insertMany(
    Array.from({ length: 10000 }, (_, index) => ({
      chat: chat._id,
      sender: guest._id,
      senderRole: 'guest',
      body: index % 4 === 0 ? `Breakfast question ${index}` : `General question ${index}`,
      clientMessageId: randomUUID(),
      createdAt: new Date(startDate + index * 60000),
    })),
  );
  runtime = createHttpServer({
    secret: randomBytes(48).toString('hex'),
    production: false,
    origin: 'http://127.0.0.1:5175',
    trustProxy: 0,
    frontend: true,
  });
  await new Promise((resolve, reject) => {
    runtime.server.once('error', reject);
    runtime.server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${runtime.server.address().port}`;
  const page = await fetch(url, { signal: AbortSignal.timeout(10000) });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('Hilltop Guest House'));
  const script = html.match(/src="([^"]+\.js)"/)[1];
  assert.ok(script.startsWith('/assets/'));
  assert.equal((await fetch(`${url}${script}`)).status, 200);
  async function http(path, cookie, method = 'GET', body) {
    const response = await fetch(`${url}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    assert.ok(response.ok, `Unexpected HTTP status ${response.status}`);
    return { response, data };
  }
  async function login(user) {
    const { response } = await http('/auth/login', null, 'POST', { email: user.email, password });
    return response.headers.get('set-cookie').split(';')[0];
  }
  const guestCookie = await login(guest),
    agentCookie = await login(agent);
  // Warm index/page and connection pools before measured work.
  await http(`/chats/${chat._id}/messages?limit=20`, guestCookie);
  delay.enable();
  await measure('history mixed filters / 10,000 saved messages', 120, 5, 1000, async (index) => {
    const query = [
      'page=1',
      'search=breakfast&page=2',
      'search=breakfast&start=2026-10-02&end=2026-10-04&page=3',
      'page=100',
    ][index % 4];
    const { data } = await http(`/chats/${chat._id}/messages?limit=20&${query}`, guestCookie);
    assert.equal(data.messages.length, 20);
    assert.ok(data.pagination.total >= 20);
  });
  await measure('agent inbox / 41 assigned chats', 60, 3, 1000, async () => {
    const { data } = await http('/agent/chats?status=active&limit=20', agentCookie);
    assert.equal(data.chats.length, 20);
    assert.equal(data.summary.active, 41);
  });
  await measure('REST transactional sends / one contended chat', 30, 3, 2000, async (index) => {
    const { data } = await http(`/chats/${chat._id}/messages`, guestCookie, 'POST', {
      body: `REST performance message ${index}`,
      clientMessageId: randomUUID(),
    });
    assert.equal(data.body, `REST performance message ${index}`);
  });
  async function socketFor(cookie) {
    const socket = connect(url, {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
      timeout: 8000,
      extraHeaders: { Origin: 'http://127.0.0.1:5175', Cookie: cookie },
    });
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
      socket.connect();
    });
    assert.equal((await acknowledge(socket, 'joinChat', { chatId: String(chat._id) })).ok, true);
    return socket;
  }
  const guestSocket = await socketFor(guestCookie),
    agentSocket = await socketFor(agentCookie);
  await measure(
    'socket send acknowledgement AND recipient delivery',
    20,
    1,
    2000,
    async (index) => {
      const clientMessageId = randomUUID();
      let listener, timer;
      const delivered = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Recipient delivery timed out')), 8000);
        listener = (message) => {
          if (message.clientMessageId === clientMessageId) resolve(message);
        };
        agentSocket.on('newMessage', listener);
      });
      try {
        const [ack, received] = await Promise.all([
          acknowledge(guestSocket, 'sendMessage', {
            chatId: String(chat._id),
            body: `Socket performance message ${index}`,
            clientMessageId,
          }),
          delivered,
        ]);
        assert.equal(ack.ok, true);
        assert.equal(ack.created, true);
        assert.equal(ack.message._id, received._id);
      } finally {
        clearTimeout(timer);
        agentSocket.off('newMessage', listener);
      }
    },
  );
  assert.equal(await Message.countDocuments({ chat: chat._id }), 10050);
  const report = {
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: platform(),
      release: release(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      memoryGiB: Math.round(totalmem() / 2 ** 30),
    },
    fixture: {
      messages: 10000,
      chats: 41,
      mongo: 'temporary single-node replica set',
      httpRateLimitEnabled: true,
      socketRateLimitEnabled: true,
      externalDatabaseUsed: false,
    },
    results,
    nodeProcess: {
      rssMiB: Math.round(process.memoryUsage().rss / 2 ** 20),
      eventLoopP95Ms: Math.round(delay.percentile(95) / 1e4) / 100,
    },
    passed: results.every((result) => result.passed),
  };
  if (process.argv.includes('--report')) {
    const docs = fileURLToPath(new URL('../../docs/', import.meta.url));
    await mkdir(docs, { recursive: true });
    await writeFile(join(docs, 'performance-results.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(
    `Performance check ${report.passed ? 'passed' : 'FAILED'}; fixture contains exactly 50 committed new messages.`,
  );
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  console.error('Isolated performance check failed:', error.name);
  process.exitCode = 1;
} finally {
  delay.disable();
  for (const socket of sockets) socket.disconnect();
  if (runtime) {
    runtime.server.closeAllConnections();
    await new Promise((resolve) => runtime.io.close(resolve));
  }
  await mongoose.disconnect();
  if (database) await database.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
}
