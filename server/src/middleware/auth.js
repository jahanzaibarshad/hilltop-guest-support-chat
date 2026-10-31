import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import User from '../models/User.js';
import { HttpError } from '../lib/errors.js';
export const publicUser = (u) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  role: u.role,
});
export function createAuth(secret, production) {
  if (typeof secret !== 'string' || secret.length < 32)
    throw new Error('JWT_SECRET must contain at least 32 characters.');
  const options = { httpOnly: true, secure: production, sameSite: 'strict', path: '/' };
  async function resolveToken(token) {
    let payload;
    try {
      payload = jwt.verify(token || '', secret, {
        algorithms: ['HS256'],
        issuer: 'hilltop-support',
        audience: 'hilltop-web',
      });
      if (
        typeof payload.sub !== 'string' ||
        !/^[a-f\d]{24}$/i.test(payload.sub) ||
        !Number.isInteger(payload.v) ||
        !Number.isFinite(payload.exp)
      )
        throw new Error('Invalid session');
    } catch {
      throw new HttpError(401, 'Sign in to continue.');
    }
    const user = await User.findById(payload.sub).select('+sessionVersion');
    if (!user || user.sessionVersion !== payload.v)
      throw new HttpError(401, 'Sign in to continue.');
    return { user, expiresAt: payload.exp * 1000 };
  }
  return {
    resolveToken,
    async revoke(token) {
      let context;
      try {
        context = await resolveToken(token);
      } catch (error) {
        if (error.status === 401) return null;
        throw error;
      }
      await User.updateOne(
        {
          _id: context.user._id,
          ...(context.user.sessionVersion === 0
            ? { $or: [{ sessionVersion: 0 }, { sessionVersion: { $exists: false } }] }
            : { sessionVersion: context.user.sessionVersion }),
        },
        { $inc: { sessionVersion: 1 } },
      );
      return String(context.user._id);
    },
    issue(res, user) {
      const token = jwt.sign({ v: user.sessionVersion ?? 0 }, secret, {
        jwtid: randomUUID(),
        subject: String(user._id),
        algorithm: 'HS256',
        expiresIn: '8h',
        issuer: 'hilltop-support',
        audience: 'hilltop-web',
      });
      res.cookie('hilltop_session', token, { ...options, maxAge: 8 * 60 * 60 * 1000 });
    },
    clear(res) {
      res.clearCookie('hilltop_session', options);
    },
    async required(req, res, next) {
      const { user } = await resolveToken(req.cookies?.hilltop_session);
      req.user = user;
      next();
    },
  };
}
