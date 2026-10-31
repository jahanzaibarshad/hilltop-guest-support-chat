# Hilltop handover

## Ready locally

Owner-confirmed scope: demo project. Hotel contacts, support availability and retention/privacy wording stay **hotel approval pending**. This does not block the agreed demo handover; a real business launch still requires those decisions.

Guest registration/sign-in, support conversations, transactional REST/Socket.io messages, retry deduplication, reconnection recovery, private agent assignment/inbox, durable unread markers, closure and history search/date filtering/pagination are implemented. Guest/agent views support mobile layouts. No permanent demo credentials are shipped.

The suite contains **181 automated tests** (160 server, 21 React), with a backend baseline of **94.87% line coverage** and **99.04% route-file line coverage**. Production dependency audit reports zero advisories; the development-only unpatched Jest/deepmerge advisory is documented and narrowly excepted by `npm run security:check`. Coverage includes models, middleware, routes, services, HTTP setup and realtime code; process startup is excluded. See [security review](SECURITY.md) and [performance report](PERFORMANCE.md).

## Run and acceptance

1. Follow README first-time setup in the Hilltop folder with a dedicated hilltop_support replica-set database. Keep Mongo URI/JWT secret private and out of Git.
2. Run `npm run dev`. Guest UI: http://127.0.0.1:5175; readiness: http://127.0.0.1:5001/api/health.
3. Provision an agent privately using `npm run create-agent --workspace server` and README environment instructions. Guests cannot promote themselves.
4. Use separate browser profiles for guest and agent. Create a guest/chat, claim it, exchange messages both ways, disconnect/reconnect and check saved recovery without duplicates.
5. Confirm another guest/agent cannot access assigned history. Switch chats for draft/unread behavior. Search by keyword/date, paginate, receive a live message and explicitly refresh results.
6. Close the chat, confirm sends stop on both sides, sign out and verify existing sessions lose access. Check mobile widths and keyboard access.
7. Run `npm run test:coverage`, `npm run build`, `npm run test:performance`, `npm run format:check` and `npm run security:check`. These tests use disposable databases, not the private Atlas URI. Raw `npm audit` remains available and reports the documented development-only exception.

## Production build preparation — no deployment performed

`npm ci` and `npm run build` prepare the app. `npm start` runs the backend. With private NODE_ENV=production, it serves client/dist on the same port as REST and Socket.io; a missing build fails explicitly. Configure CLIENT_URL as the exact HTTPS origin, PORT, a dedicated MONGODB_URI, random JWT_SECRET and a reviewed TRUST_PROXY hop count. Production cookies need HTTPS; ordinary local HTTP uses development mode. Splitting frontend and API across unrelated origins needs a cookie/CSRF review.

The tracked .github/workflows/checks.yml runs install, formatting, coverage, build, isolated performance checks and a scoped security gate on push/PR/manual dispatch. It has read-only contents permission, does not persist credentials and needs no Atlas/password secrets. Private repository: https://github.com/jahanzaibarshad/hilltop-guest-support-chat; reviewers need access. [Remote CI passed on 31 October 2026](https://github.com/jahanzaibarshad/hilltop-guest-support-chat/actions/runs/41206257436), verifying source commit b42a7cc350882b882097d0062b3ffe80d4ac0581. The submitted WanderWays repository is separate.

## Verified delivery and remaining release steps

- Real Atlas API/socket and full browser/mobile acceptance passed on 31 October 2026. Permanent staff provisioning/login is complete; the owner's private login reference stays in ignored server/.env. Temporary browser/smoke fixtures were cleaned. See atlas-browser-results.json for checked workflows.
- Dedicated private Hilltop repository pushed and remote CI verified successful; ci-results.json records the check results.
- Hosting/post-deployment acceptance; live/demo URL remains absent until verified.
- Hotel-approved reception/emergency contacts, privacy notice, retention/erasure procedure and support availability. Do not promise dispatch or unapproved response times.
- Named owners for accounts/offboarding, backups/restores, monitoring and incident response; tune proxy/connection limits before public traffic.

TASKS.md leaves these open. Local engineering checks do not establish business approval or public production readiness.

## Submission note

Hilltop Guest Support implements authenticated REST/Socket.io chat, a responsive agent inbox, private assignment, history search/filter/pagination and automated regression/performance/security checks. All 181 tests pass; real Atlas API/socket/browser acceptance and permanent staff provisioning passed on 31 October 2026. Temporary fixtures were cleaned. Dedicated private repository: https://github.com/jahanzaibarshad/hilltop-guest-support-chat. Remote CI is green, including production audit with zero reported advisories and an explicitly reviewed unpatched development-only advisory. Business details remain hotel approval pending for this demo; deployment/live link are deferred. Reviewers need repository access; add a live URL only after deployment verification.
