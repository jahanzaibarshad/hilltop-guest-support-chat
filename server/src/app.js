import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { createAuth } from './middleware/auth.js';
import { createRouter } from './routes/api.js';
import { HttpError, errorHandler } from './lib/errors.js';
import { serveFrontend } from './frontend.js';
export function createApp({
  secret = process.env.JWT_SECRET,
  production = process.env.NODE_ENV === 'production',
  origin = process.env.CLIENT_URL || 'http://127.0.0.1:5175',
  rateLimits = true,
  maxRequests = 300,
  trustProxy = process.env.TRUST_PROXY || '0',
  frontend = false,
} = {}) {
  const url = new URL(origin);
  if (url.origin !== origin || (production && url.protocol !== 'https:'))
    throw new Error('CLIENT_URL must be an exact origin; production requires HTTPS.');
  if (!/^([0-9]|10)$/.test(String(trustProxy)))
    throw new Error('TRUST_PROXY must be a hop count from 0 to 10.');
  const app = express();
  const auth = createAuth(secret, production);
  app.locals.auth = auth;
  app.locals.clientOrigin = origin;
  app.disable('x-powered-by');
  app.set('trust proxy', Number(trustProxy));
  app.use(helmet());
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(cors({ origin, credentials: true }));
  app.use((req, res, next) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.get('origin') &&
      req.get('origin') !== origin
    )
      throw new HttpError(403, 'Request origin is not allowed.');
    next();
  });
  app.use(express.json({ limit: '10kb', inflate: false }));
  app.use(cookieParser());
  const noLimit = (req, res, next) => next();
  app.use(
    rateLimits
      ? rateLimit({
          windowMs: 15 * 60 * 1000,
          limit: maxRequests,
          standardHeaders: 'draft-8',
          legacyHeaders: false,
          message: { message: 'Too many requests. Please try again later.' },
        })
      : noLimit,
  );
  const authLimit = rateLimits
    ? rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 15,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { message: 'Too many account attempts. Please try again later.' },
      })
    : noLimit;
  const health = (req, res) => {
    const connected = mongoose.connection.readyState === 1;
    res
      .status(connected ? 200 : 503)
      .json({ service: 'hilltop-support', database: connected ? 'connected' : 'disconnected' });
  };
  app.get('/api/health', health);
  app.get('/health', health);
  const api = createRouter(auth, authLimit);
  app.use('/api', api);
  app.use('/', api);
  if (frontend) serveFrontend(app, typeof frontend === 'string' ? frontend : undefined);
  app.use((req, res) => res.status(404).json({ message: 'Endpoint not found.' }));
  app.use(errorHandler);
  return app;
}
