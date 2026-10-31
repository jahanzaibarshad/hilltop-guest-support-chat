# Security review

Reviewed 27 October 2026. Scope: local Hilltop source, dependencies and automated HTTP/socket regression tests. This is an engineering review, not an independent penetration test or certification of a future hosting environment.

## Verified controls

| Area            | Implementation and evidence                                                                                                                                                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts        | Registration always creates guests. Strict schemas reject injected roles, Mongo operators and unknown fields; unique emails are case-insensitive. API tests exercise these cases.                                                                                                   |
| Passwords       | Runtime bcrypt cost 12; minimum 10 characters, maximum 72 UTF-8 bytes. Some isolated test fixtures use cost 4 for speed. No password recovery or MFA is provided.                                                                                                                   |
| Sessions        | HS256 JWT with issuer, audience, expiry and database-checked session version; HttpOnly, SameSite=Strict, Secure in production. Logout revokes all sessions and disconnects sockets. Tampering, expiry, account deletion, legacy versions and role changes have regression coverage. |
| Authorization   | Guest owner/assigned agent checks for private history/read/send; atomic claim; waiting queue excludes guest email/message bodies. Tests include strangers, competing agents and foreign cursors/snapshots.                                                                          |
| Origins/CSRF    | SameSite=Strict cookie plus exact Origin checks on HTTP writes; exact Origin on socket handshakes. Origin-less CLI calls remain supported. CORS is not authentication. A cross-site embedded widget would require a deliberate session/CSRF redesign.                               |
| Integrity       | Transaction commits message and chat pointers together; unique chat/sender/client-message ID index deduplicates REST/socket retries. Closed chats reject fresh sends. Concurrent and retry tests verify persisted results.                                                          |
| Live privacy    | Server-controlled rooms, fresh account/assignment checks on actions and recipients; agent invalidations contain no chat data. Revoked/expired clients disconnect. Tests check cross-room joins and broadcasts.                                                                      |
| Input bounds    | Strict Zod schemas, 10 KB uncompressed JSON/socket packets, 2,000-character messages, 20-row pages and bounded recovery. Literal search escapes regex metacharacters and has a 3-second Mongo processing budget. Injection/oversized/malformed inputs are tested.                   |
| Throttling      | HTTP 300 requests/15 minutes/IP; signup/login share 15 attempts/15 minutes/IP across aliases. Socket 60 acknowledged actions/minute/user, 10 concurrent sockets per observed IP. Tests cover errors, reconnect sharing and direct-server forwarded-header spoofing.                 |
| Browser content | React renders plain text. No raw HTML rendering, eval or browser token storage was found in app source. Helmet adds CSP, anti-sniffing, frame and HSTS headers. Responses use no-store. Tests check headers and production cookie flags.                                            |
| Static files    | Production exposes compiled client/dist only. Private sibling files, dotfiles and source stay inaccessible; unknown APIs remain JSON 404. A missing build fails explicitly.                                                                                                         |
| Secrets/errors  | Only a blank .env.example is supplied. Environment files/logs/builds/coverage are ignored. Error responses hide stacks; startup masks Mongo URI errors. No actual credentials were found in app source.                                                                             |

The 27 October lockfile audit reported **0 advisories** at that time. Rechecking on 31 October found new advisories in Jest's development dependencies. `glob` and `minimatch` are now overridden to patched 14.0.3+ and 11.0.3+ releases; coverage tests validate compatibility. Production dependencies report **zero advisories**. Raw `npm audit` still reports the specific unpatched development finding below and its transitive impact; a completely clean full-tree audit is not claimed.

### Reviewed development-only exception

[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) affects `deepmerge` 4.2.0–4.3.1 and has no published patched version as of 31 October 2026. Here it is reachable through Jest configuration tooling, not the production server/frontend dependency tree. Prototype poisoning is a risk when merging attacker-controlled configuration; this project uses checked-in trusted Jest configuration and does not accept external test configuration from guests. CI has no Atlas/staff secrets and read-only repository contents permission.

`npm run security:check` first requires a zero-advisory production tree, then permits only this exact low-severity `deepmerge` advisory in the development audit. Every other advisory or unresolved audit error fails the check. This is a documented scoped exception, not a claim that the package is patched or a general low-severity suppression. Review upstream releases at the next dependency update and remove the exception once a compatible fix exists. No forced downgrade to obsolete Jest was used. Other tooling fixes: [glob advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249).

## Limits and launch decisions

- Real Hilltop Atlas access and authenticated API/socket/browser acceptance passed on 31 October 2026, including actual transactions, indexes, recovery, permanent staff login, private inbox, live replies and mobile history/search. The private app user accesses hilltop_support. This does not establish a complete Atlas organization/network permission audit or backup/restore drill.
- HTTPS, reverse-proxy routing, WebSocket upgrades and browser Secure cookies need hosted verification. Set CLIENT_URL to the exact HTTPS app origin. TRUST_PROXY=0 fits direct local access; use an exact hop count only after reviewing the actual proxy chain.
- Socket IP caps use the directly observed TCP peer. Proxy/NAT traffic may group guests together; tune or replace this cap before public use. Limits and the Socket.io adapter are process-local. Multiple instances need shared limits/adapter and session affinity when polling is enabled.
- Limits include normal refreshes/readiness probes. Review their frequency and traffic budget; an edge proxy/WAF should bound unauthenticated connection floods. The local load check is not a DDoS test.
- No automated retention deletion, data export/erasure endpoint, password reset, MFA or moderation is implemented. Agree on retention, restricted administrator procedures, staff offboarding and incident reporting. Do not silently delete records or invent a legal policy.
- No verified reception/emergency contact or promised response time was provided. Existing urgency guidance does not promise dispatch. Hotel approval is needed before business launch. Guests should not send card details or passwords.
- Assign owners for monitoring, backups/restore drills, secret rotation and dependency updates. Local source/tests do not establish operational controls.

## Repeat verification

Run `npm run test:coverage`, `npm run build`, `npm run test:performance`, `npm run format:check`, `npm audit` and `npm run security:check`. Raw audit exposes the reviewed finding; the security check enforces its exact scope. Tests/load checks use disposable local databases and never import .env. Performance requires a built frontend. Provision agents privately; never put real credentials in tests or commit history.

Reference behavior: [Express static middleware](https://expressjs.com/en/resources/middleware/serve-static/), [Socket.io reverse proxies](https://socket.io/docs/v4/reverse-proxy/) and [Socket.io adapters](https://socket.io/docs/v4/adapter/).
