import { createServer } from 'node:http';
import { createApp } from './app.js';
import { attachRealtime } from './realtime.js';
export function createHttpServer({ socketOptions, ...appOptions } = {}) {
  const app = createApp(appOptions);
  const server = createServer(app);
  const realtime = attachRealtime(server, {
    auth: app.locals.auth,
    origin: app.locals.clientOrigin,
    ...socketOptions,
  });
  app.locals.realtime = realtime;
  return { app, server, io: realtime.io };
}
