# Local performance check

From the project root:

```sh
npm run build
npm run test:performance
```

`npm run test:performance -- --report` replaces the committed [machine-readable measurement](performance-results.json) with a fresh result. Optional MONGOMS_DOWNLOAD_DIR/TEST_DB_ROOT select writable cache/scratch folders. Initial Mongo binary download and fixture setup are outside measured workloads. Development dependencies are required.

The runner never reads .env, accepts no external target and binds its HTTP server to loopback on a random free port. It generates private fixture credentials in memory, then closes its sockets/server/database and removes its unique scratch directory on normal completion or caught failure.

## Method and budgets

Fixture: 10,000 saved messages in one conversation, 41 assigned chats, one guest and one agent. Indexes are initialized and history is warmed before measurement. Actual login cookies authenticate requests. HTTP/socket limits stay enabled. The production HTML/JavaScript bundle is fetched from Express before measurement.

History mixes first-page, literal keyword, combined UTC-date/keyword and deeper-page requests; each response must contain its expected 20 rows. Inbox responses must have 20 rows and an active total of 41. REST sends contend on one chat and use real transactions. Socket timing waits for **both** send acknowledgement and the agent's matching newMessage event; saved IDs must agree. The database must contain exactly 50 committed new messages at the end.

Predefined local smoke budgets: p95 <=1,000 ms for reads, <=2,000 ms for writes/socket delivery, and **zero failed operations**. These are regression thresholds, not client SLAs or measured maximum capacity. Requests time out after 10 seconds; socket operations after 8 seconds. Workloads use fixed request counts, run sequentially, and use the concurrency below. This is a short smoke load, not a sustained soak/saturation or hostile-traffic test.

## Recorded run — 27 October 2026

Environment: Windows, Node 20.19.4, Intel i5-11400H, 12 logical CPUs, 16 GiB RAM, temporary single-node Mongo replica set. Exact timings/environment are in performance-results.json. p95 means 95% of this run's operations finished within that duration.

| Workload                                    | Operations | Workers |      p50 |       p95 | Failures |
| ------------------------------------------- | ---------: | ------: | -------: | --------: | -------: |
| History/search over 10,000 messages         |        120 |       5 | 40.39 ms |  62.61 ms |        0 |
| Agent inbox over 41 chats                   |         60 |       3 | 21.49 ms |  28.86 ms |        0 |
| Transactional REST sends                    |         30 |       3 | 61.20 ms | 100.86 ms |        0 |
| Socket acknowledgement + recipient delivery |         20 |       1 | 26.01 ms |  30.61 ms |        0 |

All four passed their budgets. Setup, hashing and cold start are not included. Node RSS was 136 MiB at the end: it excludes the Mongo process and is not peak memory. Event-loop p95 was 26.41 ms using a 20 ms monitor resolution. App and load generator share a machine/process; this does not isolate server CPU capacity.

## Interpretation

This is a repeatable local baseline. It does not predict free-host cold starts, Atlas/network latency, proxy/TLS overhead, high fan-out, many distinct accounts, long-running memory behavior or multi-instance delivery. Real Atlas/host acceptance and an appropriately authorized environment-specific load check remain necessary.

Search is an escaped case-insensitive substring scan within a conversation, not indexed full-text search. Deep offsets and exact counts may become expensive as history grows; processing timeouts bound search work. Monitor real usage before changing engines/pagination. Scaling requirements are in [SECURITY.md](SECURITY.md).
