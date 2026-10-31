# Hilltop Guest Support

A MERN guest-support application for Hilltop Guest House. This is a separate project from WanderWays; it has its own dependencies, ports and database.

## Delivery status

Task 1 is implemented: MongoDB models, authenticated REST endpoints, access control, API documentation, isolated integration tests and a responsive guest-side React foundation.

Task 2 is implemented: authenticated Socket.io messaging on the Express HTTP server, private selected-chat rooms, persisted-before-broadcast delivery, retry deduplication, reconnect recovery, live chat status and socket security tests. Guest pages update without Refresh; REST remains available when the live connection is unavailable. Real-browser checks verified two-tab delivery and recovery of 25 missed messages using an isolated temporary database.

Task 3 is implemented: a dedicated responsive agent inbox with waiting/own-active/own-closed views, conflict-safe assignment, full saved-history access, live replies/queue invalidations, durable unread markers, close confirmation, separate in-memory drafts and mobile inbox/detail navigation. Component/API/socket tests and isolated real-browser guest/two-agent acceptance checks cover the workflow.

Task 4 is implemented: participant-scoped keyword/date history filters, validated UTC calendar ranges, maximum 20 results per page, stable upper-bound pagination and a responsive read-only search view in the agent inbox. Live/recovered messages flag an explicit refresh without silently changing filtered pages or clearing unread state. API, component and isolated real-browser checks cover the behavior.

Task 5 checks include regression/coverage gates, repeatable isolated load checks, security review, production frontend serving, GitHub CI and handover documentation. The suite contains 181 tests (160 server + 21 React), including a keyboard-focus regression. Server line coverage baseline is 94.87%; route-file line coverage is 99.04%. Production dependencies have zero reported advisories; one unpatched low-severity advisory in Jest-only development tooling is explicitly documented and narrowly reviewed by `security:check`. See [performance results](docs/PERFORMANCE.md), [security review](docs/SECURITY.md) and [handover](docs/HANDOVER.md).

Real Hilltop Atlas API/socket **and browser acceptance** passed on 31 October 2026 against the separate `hilltop_support` database. A permanent staff account is privately provisioned. Actual guest/staff React sessions verified claim/privacy, live replies, full history, search/date/pagination, draft/unread protection, mobile navigation, closure and session restoration; temporary fixtures were cleaned. Browser evidence is in [atlas-browser-results.json](docs/atlas-browser-results.json).

Dedicated repository: [jahanzaibarshad/hilltop-guest-support-chat](https://github.com/jahanzaibarshad/hilltop-guest-support-chat) (private; reviewers need repository access). Remote CI verification, hotel-approved contacts/policies and hosting remain pending. No live deployment URL exists yet. Deployment is deferred at the user's request. See [TASKS.md](TASKS.md).

This is a **demo project**, as confirmed by the owner. Hotel contact numbers, support availability and retention/privacy policy remain explicitly **hotel approval pending**; no invented business details or automatic deletion policy is supplied.

## Requirements

- Node.js 20.19+ or 22.12+ and npm.
- MongoDB Atlas or a local MongoDB **replica set**. Message persistence uses a transaction to update the message and chat together. Standalone MongoDB is not sufficient.
- A separate `hilltop_support` database; runtime fixes the database name to prevent accidentally writing into the WanderWays database.

## Local setup

Run these commands **from the Hilltop project folder**:

```powershell
cd E:\Intership-project-2
npm ci
Copy-Item server/.env.example server/.env
```

Copy the example only on first setup. Never overwrite an existing `.env` file.

Edit `server/.env` privately:

```dotenv
NODE_ENV=development
PORT=5001
CLIENT_URL=http://127.0.0.1:5175
MONGODB_URI=mongodb+srv://<hilltop_user>:<url_encoded_password>@<cluster>/hilltop_support?retryWrites=true&w=majority
JWT_SECRET=<at_least_32_random_characters>
TRUST_PROXY=0
```

Generate a secret locally and keep the output private:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Allow the development machine's current public IP in Atlas Network Access. Use a dedicated database user with access to `hilltop_support`, and URL-encode special characters in its password. Do not commit credentials. The app does not connect to Atlas until configuration is supplied, create demo users or silently fall back to a temporary database.

```sh
npm run dev
```

- Guest website: http://127.0.0.1:5175
- API readiness: http://127.0.0.1:5001/api/health
- Use `127.0.0.1` consistently rather than mixing it with `localhost`.
- Vite proxies `/api` and `/socket.io` (WebSocket and polling) to port 5001. The old project's ports are not used.

For guest testing: create an account, start a conversation and open that conversation in a second tab. Both tabs should say **Live chat connected**; sending from one should update the other without Refresh. Disconnect/reconnect one tab to check saved-message recovery, and sign out to verify both tabs lose private access. Another guest must not see the first guest's chat. To test an agent alongside a guest, use a separate browser profile/incognito window: a single browser profile shares its login cookie across tabs.

## Agent provisioning

Public registration always creates a `guest`. There are no built-in accounts, public passwords or public role-upgrade endpoints.

Provide `AGENT_NAME`, `AGENT_EMAIL` and a strong `AGENT_PASSWORD` privately in the provisioning process environment, then run:

```sh
npm run create-agent --workspace server
```

Existing accounts are not overwritten or promoted. Remove `AGENT_PASSWORD` from the provisioning environment after success. Agents use the normal **Sign in** form; their database role automatically opens the agent inbox instead of the guest chat screen.

The owner-requested permanent staff account was provisioned and its browser login verified on 31 October 2026. Its local login reference is kept privately under `STAFF_LOGIN_EMAIL` / `STAFF_LOGIN_PASSWORD` in the owner's ignored `server/.env`; these fields are not loaded into frontend code or needed by runtime authentication. No actual email/password is included in the handover source or remote repository.

## Agent inbox usage

1. Sign in with a privately provisioned agent account. **Waiting queue** shows unassigned, open conversations; **My active** and **My closed** show only your assignments. Summary counts follow those scopes, and each list is paginated with at most 20 chats per page.
2. Select a waiting chat to see its subject, topic and guest name, not its messages. Click **Assign to me** to atomically claim it. A competing assignment/closure returns a readable conflict and refreshes the list; no other agent's message history becomes visible.
3. Assigned chats open their latest saved messages. Use **Load earlier messages** until the full history is available. Older-history cursors do not shift when new messages arrive. Replies update the guest and selected agent conversation in real time; the REST fallback remains available.
4. Guest messages make an assigned conversation unread until the agent views its latest loaded messages with the visible conversation following the bottom of the log. Read markers are persisted per assignment, not per browser tab. Reading an old cursor cannot clear a newer guest message. Unread state is a conversation indicator, not a per-message delivery/read receipt or a count of unread individual messages.
5. Unsent drafts stay separate when switching chats or mobile panes and survive reconnects within the mounted inbox. They are not saved to disk or preserved after reload/sign-out. While reading older messages, use **Jump to latest messages** to resume following the live conversation.
6. **Close conversation** requires confirmation, keeps saved history and disables further replies on both agent and guest. A draft that was not sent is identified as unsent, not silently delivered. Closed chats cannot be reopened through the current API.
7. On small screens, use **Back to inbox** to return to the list. Loading, empty and retry states are available; Refresh inbox/chat can recover transient errors. Generic socket invalidations refresh the scoped queue after creation, assignment, closure, new messages and read changes. They contain no message text, guest details or chat IDs.

Earlier isolated browser acceptance used separate guest/two-agent sessions, 45 saved messages, live replies, draft switching, persisted unread state after reload, mobile navigation and closure propagation. Real Atlas browser acceptance subsequently passed on 31 October 2026: permanent staff, temporary guest/second-agent sessions, all 47 saved messages loaded, live guest/staff exchange, filtered pagination and mobile controls at 320/390/768/1440 widths. Test fixtures were removed; the permanent staff account was preserved. Deployment remains pending.

### Search and browse saved history

Open an assigned active or closed conversation and click **Search history**. Enter a keyword and/or **From date** / **Through date**, then **Apply filters**. The results are newest-first with **Previous messages** / **Next messages**, at most 20 per page. Applying or clearing filters starts at page 1. Applied filters are shown separately from any unsaved edits in the form. Empty-result guidance and retry actions are available.

Dates are UTC calendar days, not the browser's local day: Through date includes the entire specified UTC day. The view is read-only and does not mark unseen live messages read. Replies and the in-memory draft remain in the live conversation. **Return to live chat** restores that draft and the current live log.

New live messages or messages recovered after reconnect show a **Conversation updated** notice. Existing search rows, totals and page boundaries stay on their current upper bound until **Refresh results** is clicked. That refresh retains applied filters, returns to page 1 and includes any new matches. Non-matching incoming messages also trigger the notice; refreshing can legitimately leave the matching total unchanged. These controls do not change the inbox's separate waiting/active/closed filters.

## API reference

JSON request/response bodies. `/api` is the browser API prefix; the brief's unprefixed routes are also supported (for example, `/users` and `/chats/:id/messages`). Never put credentials in URLs.

Authentication is an eight-hour JWT in the `hilltop_session` HttpOnly, SameSite=Strict cookie. Use a cookie jar in Postman, or `credentials: 'include'` in browser requests. Production cookies require HTTPS. Roles and user existence are rechecked in MongoDB on every protected request.

Logout increments the user's persisted session version, revokes all of that user's existing sessions (including other devices), and disconnects their live sockets. Existing Task 1 cookies must sign in again after this update. Session versions/password hashes are never returned to clients.

| Method | Path                      | Access / result                                                          |
| ------ | ------------------------- | ------------------------------------------------------------------------ |
| GET    | `/api/health`             | 200 connected; 503 disconnected                                          |
| POST   | `/api/users`              | Create guest; 201 and session cookie                                     |
| POST   | `/api/auth/login`         | Sign in; 200 and session cookie                                          |
| POST   | `/api/auth/logout`        | Clear session; 204                                                       |
| GET    | `/api/auth/me`            | Signed-in user's public profile                                          |
| POST   | `/api/chats`              | Guest starts their own chat; 201                                         |
| GET    | `/api/chats`              | Guest's own chats; agents see unassigned chats and their own assignments |
| GET    | `/api/chats/:id`          | Guest owner or assigned agent only                                       |
| PATCH  | `/api/chats/:id/assign`   | Agent claims an unassigned, non-closed chat atomically                   |
| PATCH  | `/api/chats/:id/close`    | Guest owner or assigned agent closes the chat                            |
| POST   | `/api/chats/:id/messages` | Participant sends message; 201 new, 200 idempotent retry                 |
| GET    | `/api/chats/:id/messages` | Participant retrieves paginated history                                  |

Registration:

```json
{ "name": "Guest Name", "email": "guest@example.com", "password": "your-private-password" }
```

Name: 2–80 characters. Email is unique and case-insensitive. Password: at least 10 characters and at most 72 UTF-8 bytes. Unknown fields (including `role`) are rejected. Responses never include password hashes.

Login:

```json
{ "email": "guest@example.com", "password": "your-private-password" }
```

Start chat:

```json
{ "subject": "Can I check in early?", "category": "booking" }
```

Subject: 3–120 characters. Categories: `booking`, `amenities`, `general`, `urgent`. An urgent category does not promise immediate handling or emergency dispatch. Ownership is always inferred from the authenticated user.

Send message:

```json
{ "body": "Our train arrives at 10 am.", "clientMessageId": "b3f76943-b4ad-4c85-a40f-1cba8657b96c" }
```

Body: 1–2000 characters after trimming. Sender identity/role comes from the session, never the request. `clientMessageId` is an optional UUID: clients should retain it when retrying the same message after uncertain delivery. Reusing the same ID with different text returns 409. Concurrent retries save one message. Closed chats retain readable history but reject new messages.

### Lists and history

```text
GET /api/chats?page=1&limit=20
GET /api/chats/:id/messages?page=1&limit=20
GET /api/chats/:id/messages?search=breakfast&start=2026-10-01&end=2026-10-27&page=1&limit=20
```

Page is a positive integer, capped at 10,000. Limit defaults to 20 and must be 1–20. Unknown, repeated, object-shaped or malformed query parameters are rejected. Chat-list endpoints accept their documented pagination/status fields; keyword/date filters apply to message history only.

| History parameter | Rules                                                                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search`          | Optional, trimmed, case-insensitive **literal substring**, max 80 characters; empty means no keyword filter. Regex metacharacters are escaped; control characters are rejected.                                        |
| `start`           | Optional real calendar date, exactly `YYYY-MM-DD`; inclusive UTC midnight.                                                                                                                                             |
| `end`             | Optional real calendar date, exactly `YYYY-MM-DD`; includes the entire UTC day (exclusive next midnight). Must not precede `start`.                                                                                    |
| `page`            | Integer 1–10,000, default 1. A valid page beyond available results returns an empty page with correct totals.                                                                                                          |
| `limit`           | Integer 1–20, default 20.                                                                                                                                                                                              |
| `snapshot`        | Optional upper-bound message ObjectId returned in `pagination.snapshot`, or the literal `empty`; reuse for subsequent pages of the same search. It must belong to this authorized chat. Omit it to take a fresh bound. |

All supplied filters intersect and cannot bypass guest ownership/agent assignment. The `{ chat: 1, createdAt: -1, _id: -1 }` index scopes ordering/date work to the conversation. Literal, case-insensitive substring matching can still scan that conversation's candidate messages: no claim of an indexed full-text engine is made. History queries/counts use a 3-second server processing budget and return a readable 503 on timeout; this is not a network timeout. Local load scope/results are in [PERFORMANCE.md](docs/PERFORMANCE.md).

```json
{
  "messages": [],
  "pagination": { "page": 1, "limit": 20, "total": 0, "pages": 1, "snapshot": "empty" }
}
```

Chat lists use `chats` instead of `messages` and have no history snapshot field. Messages are newest-first, ordered by creation time then ID; conversational logs reverse the latest page for reading. Chat lists remain live and are ordered by last update then ID.

For message history, the server chooses the latest existing message in the authorized chat as an upper bound, then intersects its `(createdAt, _id)` boundary with the filters. Reusing its ID keeps subsequent numbered pages stable during normal append-only app writes. An initially empty result set from an empty chat returns `snapshot=empty`, which stays empty until refresh. A foreign/missing snapshot returns 400 after participant authorization. This upper bound is **not** a MongoDB transaction snapshot: administrative deletion/backdated inserts can change old rows, and there are no public message edit/delete endpoints. Refreshing, applying new filters or clearing filters takes a new bound. Reconnect recovery remains separate from filtered page retrieval.

### Errors and access

Errors use `{ "message": "Readable explanation" }`: 400 validation/invalid ID, 401 missing/expired session, 403 forbidden role/origin, 404 missing or inaccessible chat, 409 duplicate email/assignment conflict/closed chat/message ID conflict, 413 oversized request, 415 compressed JSON, 429 rate limit, 503 bounded database-search timeout, 500 sanitized unexpected failure.

An unassigned agent can see queue metadata, but cannot read or write a chat's messages until claiming it. Competing claims cannot overwrite the winning assignment. No destructive user/chat/message delete endpoints are exposed: retention and erasure rules need hotel approval before business launch.

## Real-time messaging

### Inbox and history endpoints

| Method | Path                                                                       | Result                                                                                                         |
| ------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/agent/chats?status=waiting&page=1&limit=20`                          | Agent-only scoped list, `{ chats, summary: { waiting, active, closed, unread }, pagination }`                  |
| POST   | `/api/chats/:id/read`                                                      | Assigned agent only; body `{ "messageId": "<latest-visible-message-id>" }`, returns chat with `unread` boolean |
| GET    | `/api/chats/:id/messages/older?before=<oldest-loaded-message-id>&limit=20` | Participant-only older history, newest-first; `{ messages, hasMore, nextCursor }`                              |

Inbox `status` is `waiting`, `active` or `closed`; page is a positive integer, limit is 1–20. Waiting rows may expose guest name and chat metadata, never email/passwords or message bodies. Assigned lists are restricted to the current agent; other agents cannot list/read their conversations. Read/history cursors must be messages in that same authorized chat. Read updates do not change the chat's activity timestamp, and a conditional write prevents an old acknowledgement from marking a newer message read. New guest messages transactionally update `lastGuestMessage`; `agentReadMessage` stores the acknowledged guest-message high-water mark. Existing pre-upgrade history has no retrospective unread marker until a new guest message is sent.

### Real-time protocol

Socket.io uses `/socket.io` on the same HTTP server as Express (port 5001 locally), with the existing HttpOnly session cookie. It does not accept identities or roles supplied in a socket payload. Browser handshake origins must exactly match `CLIENT_URL`; both WebSocket and polling are supported. No special socket secret or extra Atlas credentials are needed.

Client events require an acknowledgement callback:

| Event         | Payload                                                                         | Success acknowledgement                          |
| ------------- | ------------------------------------------------------------------------------- | ------------------------------------------------ |
| `joinChat`    | `{ "chatId": "<chat ObjectId>" }`                                               | `{ "ok": true, "chat": {} }`                     |
| `leaveChat`   | `{ "chatId": "<chat ObjectId>" }`                                               | `{ "ok": true }`                                 |
| `sendMessage` | `{ "chatId": "<chat ObjectId>", "body": "Hello", "clientMessageId": "<UUID>" }` | `{ "ok": true, "message": {}, "created": true }` |

Errors acknowledge `{ "ok": false, "status": 400, "message": "..." }`; authorization errors are 401/404, closed chat conflicts 409 and throttling 429. Socket message IDs are required UUIDs. The server broadcasts `newMessage` only for a new committed message, and `chatUpdated` for assignment/closure. `sessionError` signals revoked/expired sessions or connection-limit problems. Raw arbitrary client `newMessage` events have no broadcast handler.

A socket listens to one selected chat at a time. Room joins are serialized, verify current database ownership/assignment and leave the previous chat. Every action rechecks the authenticated account; every broadcast rechecks each recipient. JWT expiry disconnects idle sockets too. An unassigned agent cannot join a room or receive its message history.

Agents additionally join a server-managed inbox channel for `inboxChanged` invalidations with an empty payload. The server rechecks role/session before sending them; guests cannot subscribe. The client coalesces these refreshes and refetches the permission-scoped API. A role change removes access even on an existing connection. The channel is not an alternative way to subscribe to private message content.

REST and sockets use the same transaction service and message ID index. A timed-out socket acknowledgement is **uncertain delivery**, not proof that sending failed: retry the same UUID/text, or inspect saved history. Successful retries return the original message without another broadcast. The React client deduplicates events/acknowledgements by message ID, orders them by timestamp/ID and does not buffer automatic sends while offline. REST is the fallback for a new/retried send when live status is not ready. Unsaved composer text is kept during reconnects, but not after a page reload or sign-out.

### Missed-message recovery

```text
GET /api/chats/:id/messages/sync?after=<last-known-message-ObjectId>&limit=20
```

Participant-only recovery returns `{ "messages": [], "hasMore": false, "nextCursor": "<last-message-id-or-null>" }`, oldest-first after the cursor using `(createdAt, _id)` ordering. The cursor must belong to the same chat. Omit `after` to start at its oldest message. Limit is 1–20. Clients rejoin before recovery and follow `nextCursor` while `hasMore` is true, merging concurrently arriving events. Reconnect recovery is capped at 200 pages (4,000 messages) per attempt with an explicit warning and Refresh option rather than silently dropping a large backlog. Agent initial history and reconnect synchronization are coordinated so old history is loaded on demand, not accidentally fetched in full by an early socket join. Recovery never inserts messages directly into a filtered history page; it flags that view for an explicit refresh.

Socket protections are process-local: 60 acknowledged actions/minute/user across their connections/reconnects, 10 concurrent sockets per observed IP address, a 10 KB packet limit and strict payload validation. The shared-user event budget is checked before adding room operations to a queue. The backend factory exposes `socketOptions` to tune these limits. Before deploying behind a proxy or scaling out, tune the observed-IP cap for hotel/NAT/proxy traffic and add a shared adapter and distributed limiter. No multi-instance delivery guarantee is claimed.

## Testing and checks

```sh
npm test
npm run test:coverage
npm run format:check
npm run build
npm run test:performance
npm audit
npm run security:check
```

Tests start an isolated temporary MongoDB replica set; they do not load the app's `.env` or use its Atlas URI. The first run may download the MongoDB test binary. On a low-space Windows machine, set `MONGOMS_DOWNLOAD_DIR` and `TEST_DB_ROOT` to writable cache folders with sufficient space. Coverage includes server models, middleware, routes, services, HTTP setup and sockets; the process startup entry is excluded. Coverage gates require 80% statements/lines/functions and 75% branches. Current suite: 160 backend + 21 React tests.

`npm audit` still reports the unpatched Jest/deepmerge development advisory and its transitive impact. `npm run security:check` independently requires zero production advisories, rejects every unreviewed development advisory and permits only the named low-severity development exception in [SECURITY.md](docs/SECURITY.md). It does not suppress unrelated future findings. Patched `glob`/`minimatch` overrides keep the test tooling's other reported issues resolved.

The performance runner requires `npm run build` first. It uses 10,000 synthetic messages, actual loopback HTTP/socket traffic and a disposable replica set with no external target option. `npm run test:performance -- --report` saves a sanitized local measurement. See [PERFORMANCE.md](docs/PERFORMANCE.md) for predefined budgets, results and limitations.

### Explicit real Atlas smoke check

`npm run test:atlas` loads private `server/.env` and connects to the configured **real** `hilltop_support` database. It checks indexes, signup/login, private assignment, transactional REST/socket delivery, cross-transport retry, history/date/pagination filters, recovery, read markers, closure and logout. It creates uniquely labelled temporary guest/agent accounts and one chat, then removes only its own fixtures. It never drops collections/databases or alters existing accounts. A forced process termination may leave labelled fixtures for inspection. This command is deliberately separate from CI and isolated tests; it needs real credentials/network access and performs real writes. Last successful run: 31 October 2026, including cleanup.

## Production preparation and CI

After `npm ci` and `npm run build`, `npm start` serves the API and, when `NODE_ENV=production`, the compiled React app from the same port. Only `client/dist` is public; missing builds fail explicitly and unknown APIs stay JSON 404. Set private production configuration with an exact HTTPS `CLIENT_URL`, dedicated Mongo URI, random JWT secret and reviewed proxy hop count. Production Secure cookies require HTTPS; use development mode for ordinary local HTTP.

The `.github/workflows/checks.yml` runs install, formatting, coverage, build, isolated load checks and audit after a push/PR/manual dispatch in the dedicated Hilltop repository. No Atlas secrets are required. The repository has been created; its remote Actions result must be verified after the initial push. No deployment was performed. Operational checks and remaining acceptance steps are in [HANDOVER.md](docs/HANDOVER.md).

## Security and operations

- Bcrypt password hashes; authenticated, database-checked roles; private message history.
- Explicit browser origin, security headers, no-store API responses, 10 KB uncompressed JSON limit, validation and strict request schemas.
- HTTP limit: 300 requests/15 minutes/IP. Signup/login share an additional 15 attempts/15 minutes/IP limit.
- HTTP/socket limits and room delivery are process-local; a multi-instance production deployment needs shared limiting and a Socket.io adapter.
- No permanent credentials or agent accounts are shipped. Keep environment files and runtime data out of Git.
- Startup fails for missing/invalid credentials; health never claims a disconnected database is ready.
- Configure verified hotel contacts, privacy/retention policies and emergency guidance before business use. Do not collect card details or passwords in chat.
- Production serving, local security/performance checks, private staff provisioning and real Atlas API/socket/browser acceptance are implemented. Hosting/live URL, business approval, monitoring and backup/restore readiness remain pending. See the [security review](docs/SECURITY.md) for concrete controls and launch limitations.

## Structure

```text
client/                 React guest-side REST foundation, responsive CSS and Vite
client/src/AgentInbox.jsx Dedicated agent workspace, drafts, read markers and history
client/src/HistorySearch.jsx Read-only filtered history with stable numbered pages
client/src/test/         Inbox component interaction tests
server/src/models/      User, Chat, Message schemas and indexes
server/src/routes/      REST endpoints
server/src/services/    Transactional message persistence and scoped, bounded history search
server/src/middleware/  Session authentication and public user serialization
server/src/realtime.js  Authenticated rooms, socket actions, limits and safe broadcasts
server/src/http.js      Shared Express + Socket.io HTTP server factory
server/src/config/      Isolated Hilltop database configuration
server/scripts/         Private agent provisioning and isolated performance runner
server/test/            Isolated API, inbox, socket, authorization and concurrency tests
docs/                   Security/performance reports, measurement and handover
.github/workflows/      CI checks ready for a dedicated Hilltop repository
TASKS.md                Delivery checklist for the five brief tasks
```
