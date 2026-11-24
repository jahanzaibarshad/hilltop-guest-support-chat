import { Server } from 'socket.io';
import cookieParser from 'cookie-parser';
import Chat from './models/Chat.js';
import { participantFilter, sendMessage } from './services/messages.js';
import { parse, roomInput, socketMessageInput } from './lib/validation.js';
import { HttpError } from './lib/errors.js';

const room = (id) => `chat:${id}`;
export function attachRealtime(
  server,
  { auth, origin, eventLimit = 60, windowMs = 60000, maxConnectionsPerIp = 10 } = {},
) {
  const io = new Server(server, {
    cors: { origin, credentials: true },
    allowRequest: (req, callback) => callback(null, req.headers.origin === origin),
    maxHttpBufferSize: 10 * 1024,
    serveClient: false,
  });
  io.engine.use(cookieParser());
  const buckets = new Map();
  const sweep = setInterval(() => {
    for (const [key, bucket] of buckets) if (Date.now() >= bucket.reset) buckets.delete(key);
  }, windowMs).unref();
  server.once('close', () => clearInterval(sweep));
  io.use(async (socket, next) => {
    try {
      const token = socket.request.cookies?.hilltop_session;
      const context = await auth.resolveToken(token);
      socket.data.userId = String(context.user._id);
      socket.data.userRole = context.user.role;
      socket.data.token = token;
      socket.data.expiresAt = context.expiresAt;
      next();
    } catch (error) {
      const failure = new Error(
        error.status === 401
          ? 'Sign in to use live chat.'
          : 'Live chat is temporarily unavailable.',
      );
      failure.data = { status: error.status === 401 ? 401 : 503 };
      next(failure);
    }
  });
  const canReceive = (chat, user) =>
    user.role === 'agent'
      ? String(chat.assignedAgent) === String(user._id)
      : String(chat.guest) === String(user._id);
  async function publish(chatId, event, payload) {
    try {
      const chat = await Chat.findById(chatId).lean();
      if (!chat) return;
      const recipients = [...(io.sockets.adapter.rooms.get(room(chatId)) || [])];
      await Promise.all(
        recipients.map(async (id) => {
          const socket = io.sockets.sockets.get(id);
          if (!socket) return;
          try {
            const { user } = await auth.resolveToken(socket.data.token);
            if (canReceive(chat, user)) socket.emit(event, payload);
            else await socket.leave(room(chatId));
          } catch (error) {
            socket.emit('sessionError', {
              status: error.status === 401 ? 401 : 503,
              message:
                error.status === 401
                  ? 'Your session ended. Sign in again.'
                  : 'Live chat temporarily unavailable.',
            });
            socket.disconnect(true);
          }
        }),
      );
    } catch (error) {
      console.error('Live delivery deferred to history recovery:', error.name);
    }
  }
  const realtime = {
    io,
    async notifyInbox() {
      const recipients = [...(io.sockets.adapter.rooms.get('agent-inbox') || [])];
      await Promise.all(
        recipients.map(async (id) => {
          const socket = io.sockets.sockets.get(id);
          if (!socket) return;
          try {
            const { user } = await auth.resolveToken(socket.data.token);
            if (user.role === 'agent') socket.emit('inboxChanged', {});
            else await socket.leave('agent-inbox');
          } catch (error) {
            socket.emit('sessionError', {
              status: error.status === 401 ? 401 : 503,
              message:
                error.status === 401
                  ? 'Your session ended. Sign in again.'
                  : 'Live inbox temporarily unavailable.',
            });
            socket.disconnect(true);
          }
        }),
      );
    },
    async publishMessage(message) {
      await publish(String(message.chat), 'newMessage', message.toObject?.() || message);
      await realtime.notifyInbox();
    },
    async publishChat(chat) {
      await publish(String(chat._id), 'chatUpdated', chat.toObject?.() || chat);
      await realtime.notifyInbox();
    },
    disconnectUser(userId) {
      io.in(`user:${userId}`).emit('sessionError', {
        status: 401,
        message: 'You have been signed out. Sign in again.',
      });
      io.in(`user:${userId}`).disconnectSockets(true);
    },
  };
  io.on('connection', (socket) => {
    const address = socket.handshake.address;
    const sameIp = [...io.sockets.sockets.values()].filter((s) => s.handshake.address === address);
    if (sameIp.length > maxConnectionsPerIp) {
      socket.emit('sessionError', {
        status: 429,
        message: 'Too many live connections from this network.',
      });
      socket.disconnect(true);
      return;
    }
    socket.join(`user:${socket.data.userId}`);
    // This channel carries invalidation only, never chat content or guest details.
    if (socket.data.userRole === 'agent') socket.join('agent-inbox');
    const expiry = setTimeout(
      () => {
        socket.emit('sessionError', {
          status: 401,
          message: 'Your session expired. Sign in again.',
        });
        socket.disconnect(true);
      },
      Math.max(0, socket.data.expiresAt - Date.now()),
    ).unref();
    socket.once('disconnect', () => clearTimeout(expiry));
    let roomQueue = Promise.resolve();
    function handle(event, operation, serial = false) {
      socket.on(event, (input, acknowledge) => {
        if (typeof acknowledge !== 'function') return;
        const key = socket.data.userId;
        let bucket = buckets.get(key);
        if (!bucket || Date.now() >= bucket.reset) {
          bucket = { count: 0, reset: Date.now() + windowMs };
          buckets.set(key, bucket);
        }
        if (++bucket.count > eventLimit) {
          acknowledge({
            ok: false,
            status: 429,
            message: 'Too many live chat actions. Please wait before retrying.',
          });
          return;
        }
        const run = async () => {
          try {
            if (!socket.connected) return;
            const { user } = await auth.resolveToken(socket.data.token);
            const result = await operation(input, user);
            acknowledge({ ok: true, ...result });
          } catch (error) {
            acknowledge({
              ok: false,
              status: error instanceof HttpError ? error.status : 500,
              message:
                error instanceof HttpError
                  ? error.message
                  : 'Live chat action failed. Check history before retrying.',
            });
            if (error.status === 401) socket.disconnect(true);
          }
        };
        if (serial) roomQueue = roomQueue.then(run);
        else void run();
      });
    }
    handle(
      'joinChat',
      async (input, user) => {
        const { chatId } = parse(roomInput, input);
        const chat = await Chat.findOne({ _id: chatId, ...participantFilter(user) }).lean();
        if (!chat) throw new HttpError(404, 'Chat not found.');
        if (!socket.connected) return {};
        for (const existing of socket.rooms)
          if (existing.startsWith('chat:')) await socket.leave(existing);
        await socket.join(room(chatId));
        return { chat };
      },
      true,
    );
    handle(
      'leaveChat',
      async (input) => {
        const { chatId } = parse(roomInput, input);
        await socket.leave(room(chatId));
        return {};
      },
      true,
    );
    socket.on('sendMessage', async (input, acknowledge) => {
      if (typeof acknowledge !== 'function') return;
      const key = socket.data.userId;
      let bucket = buckets.get(key);
      if (!bucket || Date.now() >= bucket.reset) {
        bucket = { count: 0, reset: Date.now() + windowMs };
        buckets.set(key, bucket);
      }
      if (++bucket.count > eventLimit) {
        acknowledge({
          ok: false,
          status: 429,
          message: 'Too many live chat actions. Please wait before retrying.',
        });
        return;
      }
      let result;
      try {
        if (!socket.connected) return;
        const { user } = await auth.resolveToken(socket.data.token);
        const { chatId, ...message } = parse(socketMessageInput, input);
        const saved = await sendMessage(chatId, user, message);
        result = { ok: true, message: saved.message, created: saved.created };
      } catch (error) {
        acknowledge({
          ok: false,
          status: error instanceof HttpError ? error.status : 500,
          message:
            error instanceof HttpError
              ? error.message
              : 'Live chat action failed. Check history before retrying.',
        });
        if (error.status === 401) socket.disconnect(true);
        return;
      }

      // The acknowledgement describes persistence, independently of live delivery.
      acknowledge(result);
      if (result.created) {
        try {
          await realtime.publishMessage(result.message);
        } catch (error) {
          console.error('Live delivery deferred to history recovery:', error.name);
        }
      }
    });
  });
  return realtime;
}
