# Hilltop Guest House - Task 2: Real-Time Messaging

This repository contains the Hilltop Guest House chat implementation. This review is for **Task 2 of 5: Socket.io real-time messaging**, built on the existing Express API and MongoDB models. The repository also contains agent-inbox and history features; those are outside this Task 2 review.

**Public repository:** https://github.com/jahanzaibarshad/hilltop-guest-support-chat

## Task 2 requirements and implementation

| Requirement                        | Implementation                                                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Socket.io on the Express server    | `server/src/http.js` creates one Node HTTP server for Express and attaches Socket.io to it.                                                                           |
| Emit and broadcast messages        | Authenticated clients emit `sendMessage`; the server acknowledges the sender and emits `newMessage` to authorized participants in the selected private room.          |
| Persist messages to MongoDB        | `server/src/services/messages.js` commits the message and chat activity pointers in one MongoDB transaction before broadcasting.                                      |
| Only participants receive messages | Room joins, sends and broadcast recipients are checked against the guest owner or assigned agent. Unassigned agents and unrelated guests cannot receive chat content. |
| README with run steps              | Setup, account provisioning, socket events, REST endpoints and manual verification are documented below.                                                              |

## Files to review

1. [Message model](../server/src/models/Message.js): chat/sender references, body, role, timestamp and a unique retry identifier.
2. [REST routes](../server/src/routes/api.js): authenticated chat/message endpoints and recovery of saved messages.
3. [Shared HTTP server](../server/src/http.js): Express and Socket.io on the same server and port.
4. [Socket layer](../server/src/realtime.js): authentication, private rooms, send/broadcast events and recipient checks.
5. [Message service](../server/src/services/messages.js): participant authorization, transactional persistence and duplicate prevention.
6. [Session authentication](../server/src/middleware/auth.js): JWT cookie validation, current account/role checks and logout revocation.
7. [React socket client](../client/src/realtime.js): events, connection state, acknowledgement handling and reconnect recovery.
8. [Socket integration tests](../server/test/realtime.test.js): live delivery, persistence, privacy, retries and recovery.

## Requirements

- Node.js 20.19+ or 22.12+ and npm.
- MongoDB Atlas or a local MongoDB **replica set**, because message persistence uses transactions. Standalone MongoDB is insufficient.
- A database user with read/write access to `hilltop_support`. Runtime explicitly selects this database.

## Local setup

```sh
git clone https://github.com/jahanzaibarshad/hilltop-guest-support-chat.git
cd hilltop-guest-support-chat
npm ci
```

Create the private environment file once. In PowerShell:

```powershell
if (-not (Test-Path server/.env)) { Copy-Item server/.env.example server/.env }
```

On macOS/Linux:

```sh
test -f server/.env || cp server/.env.example server/.env
```

Configure `server/.env` privately:

```dotenv
NODE_ENV=development
PORT=5001
CLIENT_URL=http://127.0.0.1:5175
MONGODB_URI=mongodb+srv://<username>:<url_encoded_password>@<cluster>/hilltop_support?retryWrites=true&w=majority
JWT_SECRET=<at_least_32_random_characters>
TRUST_PROXY=0
```

Generate a random JWT secret locally:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Allow your machine's current IP in Atlas Network Access. Keep the real connection string and passwords out of Git. There are no built-in credentials or automatic demo-database fallbacks.

For uninterrupted manual testing, start two terminals from the project root:

```sh
# Terminal 1: Express + Socket.io
npm run start --workspace server
```

```sh
# Terminal 2: React
npm run dev --workspace client
```

- Website: http://127.0.0.1:5175/
- API readiness: http://127.0.0.1:5001/api/health - should report `database: connected`.
- Socket.io: `/socket.io` on the Express server, port 5001. Vite proxies it from the website, including WebSocket upgrades.
- Use `127.0.0.1` consistently; do not mix it with `localhost`.

Alternatively, `npm run dev` starts both services with automatic backend restarts on file edits. Wait for database readiness before sending requests.

## Guest and agent accounts

Register guests through the website. Public registration always creates a guest.

For agent testing, temporarily add these values to the ignored `server/.env`, replacing the placeholders privately:

```dotenv
AGENT_NAME=Review Agent
AGENT_EMAIL=agent@example.com
AGENT_PASSWORD=<your_private_password>
```

Use at least 10 characters and at most 72 UTF-8 bytes for the password. Run:

```sh
npm run create-agent --workspace server
```

Remove `AGENT_PASSWORD` after provisioning. Existing accounts are not overwritten or promoted. Sign in through the same website; the saved agent role opens the inbox. Use separate browser profiles/incognito sessions for guest and agent, since cookies are shared between tabs in one profile. A reviewer should provision their own agent against their configured database; no owner's password is required.

## Socket events

Connections use the `hilltop_session` HttpOnly JWT cookie with credentials included. The handshake Origin must match `CLIENT_URL`. Each client event below requires an acknowledgement callback.

| Direction             | Event          | Payload / result                                                                                                         |
| --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Client to server      | `joinChat`     | `{ chatId }`; verifies participant access and joins one selected private room. Acknowledges `{ ok: true, chat }`.        |
| Client to server      | `leaveChat`    | `{ chatId }`; leaves the room and acknowledges `{ ok: true }`.                                                           |
| Client to server      | `sendMessage`  | `{ chatId, body, clientMessageId }`; commits to MongoDB, then broadcasts. Acknowledges `{ ok: true, message, created }`. |
| Server to participant | `newMessage`   | The newly committed message, including its saved ID and creation timestamp.                                              |
| Server to participant | `chatUpdated`  | Assignment or closure changes for an authorized selected conversation.                                                   |
| Server to client      | `sessionError` | Session expiry/revocation or a live connection error; invalid sessions are disconnected.                                 |

Example with an authenticated `socket.io-client` connection from the configured browser origin:

```js
import { io } from 'socket.io-client';

const socket = io({ withCredentials: true });
socket.on('newMessage', (message) => console.log(message.body));

socket.emit('joinChat', { chatId }, (joined) => {
  if (!joined.ok) return;
  socket.emit(
    'sendMessage',
    { chatId, body: 'Hello support', clientMessageId: crypto.randomUUID() },
    (result) => console.log(result.ok ? result.message._id : result.message),
  );
});
```

Messages must have a non-empty body of at most 2,000 characters. Socket sends require a UUID `clientMessageId`. Reuse that UUID with the same text when retrying uncertain delivery: the unique `(chat, sender, clientMessageId)` index prevents duplicate saves/broadcasts. Reusing it with different text returns 409. An acknowledgement timeout is uncertain delivery; inspect history or retry with the same ID.

## Persistence and participant-only delivery

1. Authenticate the socket with its signed session cookie; do not accept a supplied sender identity or role.
2. Authorize the guest owner or assigned agent before joining a room or sending.
3. Save the message and chat pointers in a MongoDB transaction.
4. After commit, broadcast `newMessage` only to the private room's currently authorized participants, including the sender if joined. Return the saved message in the sender's acknowledgement.
5. Recheck each recipient's current session/account and assignment before delivery. Invalid or unauthorized sockets lose access. Arbitrary client `newMessage` events do not broadcast anything.

An unassigned agent can see waiting-chat metadata but must claim the chat before accessing messages. Logout revokes sessions and disconnects sockets; JWT expiry also disconnects idle clients. Closed chats retain history but reject fresh messages. HTTP and socket sends share the same message service and retry index.

## API reference

All paths below use the browser's `/api` prefix; equivalent unprefixed routes are also supported. JSON bodies and credentialed requests/cookie jars are required. Authentication uses an eight-hour JWT cookie, not a token in localStorage.

| Method | Endpoint                       | Purpose / access                                                                                                          |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/health`                  | 200 when MongoDB is connected; 503 otherwise.                                                                             |
| POST   | `/api/users`                   | Register a guest: `{ name, email, password }`; 201 and session cookie.                                                    |
| POST   | `/api/auth/login`              | Sign in: `{ email, password }`; 200 and session cookie.                                                                   |
| POST   | `/api/auth/logout`             | Revoke sessions, clear cookie and disconnect sockets; 204.                                                                |
| GET    | `/api/auth/me`                 | Restore authenticated public profile.                                                                                     |
| POST   | `/api/chats`                   | Guest creates a chat: `{ subject, category }`; 201.                                                                       |
| GET    | `/api/chats`                   | Permission-scoped chat list; `page`, `limit`.                                                                             |
| GET    | `/api/chats/:id`               | Guest owner or assigned agent retrieves a chat.                                                                           |
| PATCH  | `/api/chats/:id/assign`        | Agent atomically claims an available chat.                                                                                |
| PATCH  | `/api/chats/:id/close`         | Participant closes a chat.                                                                                                |
| POST   | `/api/chats/:id/messages`      | Participant sends `{ body, clientMessageId }`; 201 new, 200 retry. New messages also broadcast to connected participants. |
| GET    | `/api/chats/:id/messages`      | Participant retrieves saved history; newest first, maximum 20/page.                                                       |
| GET    | `/api/chats/:id/messages/sync` | Participant recovers missed messages with optional `after=<messageId>` and `limit=20`; oldest first after the cursor.     |

`subject` is 3-120 characters; `category` is `booking`, `amenities`, `general` or `urgent`. REST `clientMessageId` is optional, but should be retained for safe retries. History responses contain `{ messages, pagination }`. Recovery returns `{ messages, hasMore, nextCursor }`; the cursor must belong to the authorized chat. Follow `nextCursor` while `hasMore` is true, merging saved IDs with live events to avoid duplicates.

Errors use `{ message }`: 400 invalid data, 401 invalid session, 403 forbidden role/origin, 404 missing/inaccessible chat, 409 conflict/closed chat, 413 oversized body, 429 rate limit, 503 bounded search timeout and sanitized 500 errors. Socket failures acknowledge `{ ok: false, status, message }`.

## Manual Task 2 verification

1. Start both services and confirm database readiness. Register a guest and start a conversation.
2. Open a separate browser profile, sign in as the provisioned agent and select the conversation from Waiting queue. Before assignment, message history must stay private. Click **Assign to me**.
3. Send messages in both directions. Each should appear without Refresh, and both sessions should show a live connection.
4. Reload the pages. Saved messages should return from MongoDB. Open the guest conversation in another tab to check participant room broadcasts.
5. Disconnect one client, send from the other, then reconnect. Missed persisted messages should recover without duplicate entries.
6. Sign in as a different guest or unassigned second agent. Knowing the chat ID must not grant room, history or send access.
7. Sign out or close the conversation. Revoked sessions lose socket access; closed conversations reject fresh sends.

## Automated Task 2 tests

```sh
npm run test --workspace server -- --runTestsByPath test/realtime.test.js
```

The socket integration suite covers shared HTTP/polling setup, authenticated private rooms, committed delivery, outsider exclusion, REST-to-socket broadcast, retry deduplication, room leave/switching, session revocation/expiry, rate limits and recovery of more than 20 missed messages. Tests start a disposable MongoDB replica set; they do not read `.env` or use the application's Atlas URI. The first run may download a MongoDB binary.

The documented Task 2 command was rerun during this README correction: **31 socket integration tests passed**.

For the wider regression suite, run `npm run test:coverage`. Recorded CI and real Atlas checks from 31 October 2026 are available in [ci-results.json](ci-results.json) and [atlas-browser-results.json](atlas-browser-results.json); those records are dated evidence, not a fresh execution claim.

## Review notes

This README documents the Task 2 implementation and how to run it. The repository contains additional inbox/history functionality, which is not required to assess the real-time messaging work. Socket limits are process-local (60 acknowledged actions/minute/user, 10 concurrent connections per observed IP, 10 KB packets); scaling needs a shared adapter/limiter and reviewed proxy handling. Existing security details, including the recorded development-only dependency exception, are in [SECURITY.md](SECURITY.md).
