# Hilltop Guest House - Task 2 review guide

This is the Hilltop chat implementation. The current review covers Task 2 of 5: Socket.io on the Express server, emit/broadcast, MongoDB persistence, participant-only delivery and documented run steps.

Public repository: https://github.com/jahanzaibarshad/hilltop-guest-support-chat

Start with [Message.js](../server/src/models/Message.js), [api.js](../server/src/routes/api.js) and the [README API reference](../README.md#api-reference). Then inspect [http.js](../server/src/http.js), [realtime.js](../server/src/realtime.js) and [messages.js](../server/src/services/messages.js) for the shared server, private delivery and commit-before-broadcast flow.

Follow [README local setup](../README.md#local-setup), provision an agent privately and use separate guest/agent browser profiles. Check live messages without Refresh, saved messages after reload, reconnect recovery and denial of access to unrelated accounts.

Run the isolated Task 2 socket suite:

```sh
npm run test --workspace server -- --runTestsByPath test/realtime.test.js
```

Real credentials are excluded from Git. Reviewers configure their own MongoDB replica-set connection and JWT secret. Existing dated CI/browser records remain under docs; they do not imply fresh testing on each documentation edit. Broader inbox/history code and project planning records are additional context, not the acceptance checklist for this Task 2 review.
