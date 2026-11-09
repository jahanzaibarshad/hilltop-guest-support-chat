# Hilltop Guest Support — review handover

## Submission scope

Repository: [jahanzaibarshad/hilltop-guest-support-chat](https://github.com/jahanzaibarshad/hilltop-guest-support-chat).

The owner requested a **GitHub-only demo submission on 9 November 2026**. Source, setup instructions, API/socket documentation, tests and performance/security reports are ready for review. The repository is private; the owner must grant the reviewer access before assessment.

No live deployment or live/demo URL is supplied. The original brief requests these; they are excluded by the owner's submission choice, not by a confirmed mentor waiver. Hotel contacts, support availability and retention/privacy policy remain **hotel approval pending**, as agreed for this demo. Public production readiness is not claimed.

## Implemented features

- Guest registration/sign-in and JWT cookie sessions with database-checked roles.
- MongoDB User, Chat and Message models, indexes and transactional persistence.
- Authenticated REST/Socket.io messages, private rooms, retry deduplication and missed-message recovery.
- Responsive agent inbox with waiting/own-active/own-closed views, atomic claim, unread markers, drafts and closure.
- Keyword/date history filters, stable pagination with at most 20 messages/page and clear/refresh/empty/error states.
- API/socket/UI tests, coverage gates, isolated performance checks and GitHub Actions quality checks.

## Recorded verification

Last full automated verification: **31 October 2026**. All **181 tests** passed (160 server, 21 React). Server line coverage was **94.87%**, route-file line coverage **99.04%**. Coverage includes models, middleware, routes, services, HTTP setup and realtime code; process startup is excluded.

[Successful GitHub CI](https://github.com/jahanzaibarshad/hilltop-guest-support-chat/actions/runs/41206257436) verified source commit `b42a7cc350882b882097d0062b3ffe80d4ac0581` on Ubuntu 22.04 / Node 22: installation, formatting, coverage, build, performance and the scoped security gate. [ci-results.json](ci-results.json) records individual steps. Submission-documentation updates do not imply a new test run.

Real Atlas API/socket/browser acceptance passed on 31 October 2026: permanent staff login, private claim, second-agent isolation, live replies, 47-message history loading, UTC search/date filters, stable pages during incoming messages, draft/unread protection, mobile navigation, closure and session restoration. Widths 320/390/768/1440 were checked. Temporary fixtures were cleaned; [browser evidence](atlas-browser-results.json) records the workflows. The owner subsequently confirmed the guided manual checks passed.

The security verification recorded zero production dependency advisories. One unpatched low-severity Jest/deepmerge development-only finding has a narrow documented exception. Raw `npm audit` reports it; `npm run security:check` requires zero production findings and rejects every unreviewed development finding. This is not a clean full-tree audit claim. See [SECURITY.md](SECURITY.md); rerun the check for current advisories.

The isolated load check passed over 10,000 synthetic saved messages. Its method, latency budgets and machine-specific results are in [PERFORMANCE.md](PERFORMANCE.md); they are not hosted-service capacity claims.

## Reviewer setup and walkthrough

1. Obtain repository access, clone it and follow the root [README](../README.md). Use Node 20.19+ or 22.12+ and run `npm ci`.
2. Copy `server/.env.example` to `server/.env` only if the private file does not exist. Configure a dedicated replica-set MongoDB URI, random JWT secret and local client URL. Runtime uses `hilltop_support`. Standalone MongoDB is insufficient because messages use transactions.
3. For uninterrupted testing, use two terminals from the project root: `npm run start --workspace server`, then `npm run dev --workspace client`. Wait for the API to be ready. UI: http://127.0.0.1:5175; readiness: http://127.0.0.1:5001/api/health. Use 127.0.0.1 consistently.
4. Privately provision a reviewer-owned agent with `AGENT_NAME`, `AGENT_EMAIL`, `AGENT_PASSWORD` and `npm run create-agent --workspace server`, following README. Remove the provisioning password afterward. No default credentials are shipped; existing accounts are not promoted or overwritten.
5. Use separate browser profiles for guest and agent. Register a guest, start a conversation, claim it in the waiting queue and exchange messages both ways without refreshing.
6. Reload to verify saved history, disconnect/reconnect to verify recovery and check that a second guest/agent cannot read another assignment. Switch chats to check drafts/unread state.
7. Search by keyword/date and page through results. Receive a message while searching: results should stay stable until explicit refresh. Check clear/empty states and mobile navigation.
8. Close a conversation: history stays readable and sending stops on both sides. Sign out and confirm private sessions lose access.

Actual database credentials, JWT secrets and staff passwords are absent from Git. Reviewers configure their own database and agent; the owner's private staff account is not a prerequisite.

## Repeatable checks

```sh
npm run test:coverage
npm run format:check
npm run build
npm run test:performance
npm run security:check
```

These checks use disposable local databases and do not load private Atlas configuration. The first run may download a MongoDB test binary. Performance requires the frontend build. Raw `npm audit` exposes the known development finding and can be reviewed separately.

`npm run test:atlas` is an optional **real-database write check**, separate from CI: it loads private `server/.env`, creates uniquely labelled temporary guest/agent/chat fixtures and removes only its own fixtures. A forced termination can leave fixtures for inspection. It never drops collections or the database.

## Items excluded from this submission

- Free-host deployment, hosted-browser acceptance and live/demo URL: not delivered, per the owner's GitHub-only instruction.
- Hotel-approved contacts, support timing and retention/privacy policy: approval pending for this demo.
- Business-launch operations such as offboarding ownership, monitoring, backup/restore drills and proxy/scale configuration: documented considerations for a later public launch.

The implemented demo and recorded tests are ready for GitHub review. [TASKS.md](../TASKS.md) keeps the original brief's undelivered items visible.

## Suggested submission message

Sir, please review my Hilltop Guest Support Chat project: https://github.com/jahanzaibarshad/hilltop-guest-support-chat

It includes the MERN source, authenticated REST API, Socket.io messaging, responsive agent inbox, history search/filter/pagination, tests and performance/security reports. README contains local setup and reviewer testing instructions. Recorded CI passed all 181 tests and the documented quality checks. I am submitting the GitHub demo for review; it is not live-deployed. The repository is private, so reviewer access is required.
