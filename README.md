# Hilltop Guest House - Task 3: Agent Inbox UI

This is the Hilltop Guest House chat repository. The current submission is **Task 3 of 5: Agent Inbox UI**. It builds on the accepted Task 2 Socket.io messaging implementation; that implementation is documented separately in [Task 2 notes](docs/TASK2.md).

**Public repository:** https://github.com/jahanzaibarshad/hilltop-guest-support-chat

## Task 3 acceptance checklist

| Requirement                        | Implementation                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent page lists chats with status | Waiting queue, My active and My closed show status-labelled chats; active/closed views are scoped to the signed-in agent.                         |
| Agent can assign themselves        | Assign to me atomically claims an available chat; a competing claim shows a conflict and refreshes the queue.                                     |
| Assigned agent sees full history   | Latest messages load first; Load earlier messages retrieves older cursor pages until all saved messages are available.                            |
| UI updates when messages arrive    | newMessage merges selected-chat messages by ID; inboxChanged triggers a coalesced scoped queue refresh. Reconnect recovers saved missed messages. |
| README includes usage              | Local setup, private agent provisioning and the reviewer walkthrough are below.                                                                   |

## Files to review

- [Agent inbox](client/src/AgentInbox.jsx): status lists, assignment, message history and live updates.
- [Inbox styles](client/src/agent-inbox.css): responsive conversation list/detail panes.
- [React socket hook](client/src/realtime.js): one socket per mounted authenticated hook, callback refs and cleanup.
- [Agent API](server/src/routes/agent.js): agent-scoped inbox and read markers.
- [Chat/message API](server/src/routes/api.js): atomic assignment and saved/older/recovery history.
- [Inbox API tests](server/test/inbox.test.js) and [React inbox tests](client/src/test/AgentInbox.test.jsx).

## Requirements

- Node.js 20.19+ or 22.12+ and npm.
- MongoDB Atlas or a local MongoDB **replica set**, because message persistence uses transactions. Standalone MongoDB is insufficient.
- A database user with read/write access to `hilltop_support`. Runtime explicitly selects this database.

## Agent inbox usage and Task 3 verification

1. Configure the database and start both services using Local setup below. Privately provision an agent using Guest and agent accounts. Sign in through the same website; the agent role automatically opens Agent inbox.
2. In a separate browser profile/incognito session, register a guest, create a conversation and send a message. Separate profiles prevent guest and agent cookies from overwriting each other.
3. In the agent page, Waiting queue lists unassigned chats with their status, subject, category and guest name. Message history stays private until assignment. Select the conversation and click **Assign to me**.
4. The conversation becomes active and appears in **My active**. The assigned agent can read the latest saved messages and click **Load earlier messages** repeatedly to access the complete history. Other agents cannot read that assignment.
5. Exchange guest/agent messages without refreshing. Selected messages update live; queue/list invalidations refetch scoped data. Reload to confirm persistence and reconnect to confirm missed-message recovery.
6. Switch conversations to verify separate in-memory drafts and unread indicators. On mobile, use **Back to inbox** to navigate between the list and selected conversation.
7. Close the conversation with confirmation. It appears in **My closed**, retains readable saved history and rejects new replies. Closed chats cannot be reopened through the current UI.

### Socket listener lifecycle

AgentInbox calls useRealtime once. Its connection effect depends on userId, while callbacks are updated through a ref. Switching selected chats reuses that connection. Cleanup removes listeners, clears the reconnect timer and disconnects the socket on unmount/user change. Message IDs deduplicate acknowledgements, live events and recovery results.

### Scope and limitations

This review covers the five Task 3 criteria above. History search is present as additional functionality. Typing indicators are not implemented and are not required for this submission. Drafts are held in memory and are not retained after reload/sign-out. No live deployment or shared account password is required to follow the local reviewer setup.

### Task 3 tests

```sh
npm run test --workspace client -- src/test/AgentInbox.test.jsx
npm run test --workspace server -- --runTestsByPath test/inbox.test.js test/realtime.test.js
```

React tests cover status views, claim/conflict, full-history controls, live updates, listener integration, keyboard focus, drafts and closure. API/socket tests cover scoped lists, authorization, unread state, cursor history and live notifications. Tests use disposable replica sets and do not load the application's private Atlas URI.

Targeted verification for this submission: **11 React inbox tests and 53 inbox/socket integration tests passed** (64 targeted checks). The socket total includes the ack-before-publication rejection regression.

### Submission note

I implemented the Hilltop agent inbox with status-based chat lists, atomic self-assignment, complete saved history through older-message paging, and real-time conversation/list updates. The challenging parts were preventing duplicate events during reconnects, preserving drafts while switching chats, and protecting private history before assignment. The README includes setup and agent usage steps. Typing indicators and deployment are outside this Task 3 submission.

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

## Additional messaging documentation

For the accepted Task 2 manual checks, socket integration command and persistence/delivery details, see [Task 2 notes](docs/TASK2.md). Existing dated CI/browser reports are in docs; new targeted verification is reported with this Task 3 submission.
