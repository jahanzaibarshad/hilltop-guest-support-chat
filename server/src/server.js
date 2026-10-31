import 'dotenv/config';
import mongoose from 'mongoose';
import { createHttpServer } from './http.js';
import { connectDatabase } from './config/database.js';
let server;
let io;
try {
  const runtime = createHttpServer({ frontend: process.env.NODE_ENV === 'production' });
  server = runtime.server;
  io = runtime.io;
  await connectDatabase();
  const port = Number(process.env.PORT || 5001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  server.listen(port, '0.0.0.0', () =>
    console.log(`Hilltop API listening on http://127.0.0.1:${port}`),
  );
  server.on('error', async () => {
    console.error('Server could not listen. Check PORT availability.');
    await new Promise((resolve) => io.close(resolve));
    await mongoose.disconnect();
    process.exitCode = 1;
  });
} catch (error) {
  console.error(
    'Hilltop startup failed:',
    ['MongooseServerSelectionError', 'MongoServerError'].includes(error.name)
      ? 'Atlas connection failed. Check network access and private credentials.'
      : error.message.replace(/mongodb(?:\+srv)?:\/\/\S+/g, '[redacted URI]'),
  );
  if (io) await new Promise((resolve) => io.close(resolve));
  await mongoose.disconnect();
  process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    const timer = setTimeout(() => process.exit(1), 10000).unref();
    if (!server) return process.exit(0);
    io.close(async () => {
      await mongoose.disconnect();
      clearTimeout(timer);
      process.exit(0);
    });
  });
