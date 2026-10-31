# Hilltop handover

## Ready locally

Guest registration/sign-in, support conversations, transactional REST/Socket.io messages, retry deduplication, reconnection recovery, private agent assignment/inbox, durable unread markers, closure and history search/date filtering/pagination are implemented. Guest/agent views support mobile layouts. No permanent demo credentials are shipped.

Latest run: **180 automated tests** (160 server, 20 React), **94.87% server line coverage**, **99.04% route-file line coverage**, build/formatting pass and zero dependency advisories. Coverage includes models, middleware, routes, services, HTTP setup and realtime code; the process startup entry is excluded. This does not mean every branch or real Atlas behavior was tested. See [security review](SECURITY.md) and [performance report](PERFORMANCE.md).

## Run and acceptance

1. Follow README first-time setup in the Hilltop folder with a dedicated hilltop_support replica-set database. Keep Mongo URI/JWT secret private and out of Git.
2. Run `npm run dev`. Guest UI: http://127.0.0.1:5175; readiness: http://127.0.0.1:5001/api/health.
3. Provision an agent privately using `npm run create-agent --workspace server` and README environment instructions. Guests cannot promote themselves.
4. Use separate browser profiles for guest and agent. Create a guest/chat, claim it, exchange messages both ways, disconnect/reconnect and check saved recovery without duplicates.
5. Confirm another guest/agent cannot access assigned history. Switch chats for draft/unread behavior. Search by keyword/date, paginate, receive a live message and explicitly refresh results.
6. Close the chat, confirm sends stop on both sides, sign out and verify existing sessions lose access. Check mobile widths and keyboard access.
7. Run `npm run test:coverage`, `npm run build`, `npm run test:performance`, `npm run format:check` and `npm audit --audit-level=low`. These tests use disposable databases, not the private Atlas URI.

## Production build preparation — no deployment performed

`npm ci` and `npm run build` prepare the app. `npm start` runs the backend. With private NODE_ENV=production, it serves client/dist on the same port as REST and Socket.io; a missing build fails explicitly. Configure CLIENT_URL as the exact HTTPS origin, PORT, a dedicated MONGODB_URI, random JWT_SECRET and a reviewed TRUST_PROXY hop count. Production cookies need HTTPS; ordinary local HTTP uses development mode. Splitting frontend and API across unrelated origins needs a cookie/CSRF review.

The tracked .github/workflows/checks.yml runs install, formatting, coverage, build, isolated performance checks and audit on push/PR/manual dispatch. It has read-only contents permission, does not persist credentials and needs no Atlas/password secrets. A separate private repository exists at https://github.com/jahanzaibarshad/hilltop-guest-support-chat; reviewers need access. Its remote Actions result must be verified after initial push. The submitted WanderWays repository is separate.

## External configuration and decisions still pending

- Real Atlas API/socket and full browser/mobile acceptance passed on 31 October 2026. Permanent staff provisioning/login is complete; the owner's private login reference stays in ignored server/.env. Temporary browser/smoke fixtures were cleaned. See atlas-browser-results.json for checked workflows.
- Dedicated private Hilltop GitHub repository created; remote CI still requires verification after push.
- Hosting/post-deployment acceptance; live/demo URL remains absent until verified.
- Hotel-approved reception/emergency contacts, privacy notice, retention/erasure procedure and support availability. Do not promise dispatch or unapproved response times.
- Named owners for accounts/offboarding, backups/restores, monitoring and incident response; tune proxy/connection limits before public traffic.

TASKS.md leaves these open. Local engineering checks do not establish business approval or public production readiness.

## Submission note

Hilltop Guest Support implements authenticated REST/Socket.io chat, a responsive agent inbox, private assignment, history search/filter/pagination and automated regression/performance/security checks. Local checks pass using an isolated MongoDB replica set; real Atlas API/socket/browser acceptance and permanent staff provisioning passed on 31 October 2026. Temporary fixtures were cleaned. The dedicated private repository is https://github.com/jahanzaibarshad/hilltop-guest-support-chat. Remote CI verification, business approval and live deployment/demo link remain pending. Reviewers need repository access; add a live URL only after deployment verification.
