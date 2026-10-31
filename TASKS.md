# Hilltop delivery checklist

Source: the supplied six-page Hilltop Guest House project brief. Implement in order; verify each task before describing it as complete.

## Task 1 — Data model and REST endpoints

- [x] Independent MERN workspace, environment example and ports.
- [x] User, Chat and Message schemas in `server/src/models`.
- [x] Required POST /users, POST /chats, POST /chats/:id/messages and GET /chats/:id/messages endpoints (also mounted under /api).
- [x] Required message body, case-insensitive unique email, validation and appropriate status codes.
- [x] Guest registration/login, private agent provisioning and participant-only access.
- [x] Transactional persistence, atomic assignment and retry-safe message IDs.
- [x] Responsive guest-side React foundation using REST.
- [x] README API/run documentation and isolated integration tests.
- [x] Real Hilltop Atlas connection, collections/indexes and authenticated smoke checks verified on 31 October 2026 using private configuration.
- [x] Real-database guest signup, assignment, chat/history/date/pagination/retry/close/logout acceptance; own temporary fixtures cleaned.

## Task 2 — Socket.io messaging

- [x] Socket.io on the same HTTP server/port as Express.
- [x] Authenticated socket connections and participant-checked room joins.
- [x] `sendMessage` and `newMessage`, persisted before broadcast.
- [x] Reuse the message service for REST and sockets; acknowledgements and retry deduplication.
- [x] React connection/reconnection states and paged missed-message recovery.
- [x] Agent-socket/guest two-tab browser delivery and 25-message reconnect recovery on an isolated test database.
- [x] Room privacy, session revocation/expiry, cross-transport retry and socket rate-limit tests.
- [x] Real Atlas guest/agent socket authentication, private-room delivery, persisted retry and missed-message recovery smoke checks passed on 31 October 2026.

## Task 3 — Agent inbox

- [x] Dedicated responsive React inbox with waiting and own active/closed chats.
- [x] Claim/assign action with conflict handling; full selected-chat history via stable older-message cursors.
- [x] Live incoming message/list updates; clear loading, empty and failure states.
- [x] Durable unread indicators with stale-read protection and scoped summaries.
- [x] Mobile navigation, keyboard access and separate in-memory conversation drafts.
- [x] Document agent provisioning and inbox usage; component/API/socket/browser checks.
- [x] Real Atlas API/socket assignment, agent scoped inbox and read-marker smoke checks passed on 31 October 2026.
- [x] Real Atlas browser inbox acceptance on 31 October 2026: permanent staff/guest login, claim, second-agent privacy, bidirectional live replies, full saved history, mobile navigation, drafts, closure and session restoration.

## Task 4 — Search, filtering and pagination

- [x] History API accepts `search`, `start`, `end`, `page`, `limit` plus a validated snapshot upper bound.
- [x] Bounded literal keyword search, real UTC date validation, chat/date/order index and query timeout protection.
- [x] Maximum 20 messages/page; assigned-agent history view with next/previous, clear and refresh controls.
- [x] Empty-result, date-boundary, invalid-input, permission and query-combination tests.
- [x] Stable pages during incoming messages, explicit refresh notices and read/draft protection while searching.
- [x] Component stale-response/reconnect-notice tests and isolated guest/agent browser/mobile checks.
- [x] README documents all filters, UTC semantics, upper-bound limitations and ordering behavior.
- [x] Real Atlas keyword/date/pagination/snapshot API smoke checks passed on 31 October 2026.
- [x] Real Atlas browser filtered-history acceptance on 31 October 2026: UTC keyword/date filters, 20-row pages, frozen results during incoming messages, explicit refresh, empty/clear controls, unread/draft protection and 320/390/768/1440 widths.

## Task 5 — Tests, performance, hosting and handover

- [x] API/socket/UI regression: 181 tests (160 server + 21 React), including delayed-focus keyboard regression; backend coverage baseline is 94.87% lines and 99.04% route-file lines.
- [x] Repeatable isolated HTTP/socket load check with 10,000 saved messages; recorded results and limits in docs/PERFORMANCE.md.
- [x] HTTP/socket security review, rate-limit/static-boundary checks; production audit has zero advisories. Patched glob/minimatch overrides resolve test-tooling findings; one unpatched low-severity Jest/deepmerge development advisory has an exact documented exception enforced by security:check.
- [x] Local GitHub CI workflow for formatting, coverage, build, performance and audit; no application secrets needed.
- [x] Dedicated private Hilltop repository pushed; remote CI passes on 31 October 2026: https://github.com/jahanzaibarshad/hilltop-guest-support-chat/actions/runs/41206257436. WanderWays repository remains separate.
- [x] Permanent staff account provisioned privately; generated login reference stays only in ignored server/.env. No credentials are shipped.
- [x] Production frontend serving/build and environment instructions, including missing-build fail-fast and same-origin REST/socket setup.
- [ ] Free-host deployment after account access and provider limits are verified.
- [ ] Real hosted guest/agent chat check; verified live/demo links in README.
- [ ] Approved hotel contacts/policies, privacy/retention and emergency guidance — explicitly deferred by the owner for this demo; keep hotel approval pending.
- [x] Local handover with run/test/production-preparation instructions, limitations and honest submission note in docs/HANDOVER.md.

Deployment is intentionally deferred. Real Atlas API/socket and browser acceptance checks pass; hotel contact/policy approval remains pending.
