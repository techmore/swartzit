# Performance baseline

This is the first checked-in baseline for release comparisons. Numbers are from the dependency-free `scripts/perf-smoke.mjs` harness against the local API and should only be compared with the same fixture and endpoint shape.

The read path now has a dedicated `/ready` probe, partial indexes for approved
feeds, a `post_stats` projection for comment/vote/view aggregates, batched
bookmark and subscription lookups, bounded public aggregate caching, and
periodic cleanup for expired sessions and view visits. Read requests no longer
write a success event to `system_logs` synchronously.

## Environment

- Date: 2026-09-23
- Host: MacBookPro18,3
- CPU: Apple M1 Pro, 10 cores
- Memory: 32 GB
- macOS: 27.0
- Database: PostgreSQL 16 container, 4 CPUs, 1 GB memory
- API: `127.0.0.1:18080`, debug build
- Concurrency: 4

## Results

| Endpoint | Requests | p50 | p95 | Max | Errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/health` | 200 | 2.78 ms | 8.33 ms | 180.10 ms | 0 |
| `/api/posts?limit=20` | 100 | 9.35 ms | 19.25 ms | 76.46 ms | 0 |

This baseline is a measurement receipt, not a performance target. Future release candidates should rerun the same commands and record hardware, database fixture, build profile, request count, and concurrency alongside the result.

## Diagnostic and fixture checks

Enable request-level database telemetry for a diagnostic run with
`SWARTZIT_DB_TELEMETRY=1`. The admin runtime snapshot then exposes request
latency, measured query count/duration, pool-wait count/duration, and the
bounded public-cache entry count. SQLx also emits pool-acquire timing at the
diagnostic log level. Leave the flag off for normal operation because the pool
probe is intentionally diagnostic-only.

PostgreSQL statement statistics are opt-in because `pg_stat_statements` needs a
database restart:

```bash
bash scripts/pg-diagnostics.sh --check
bash scripts/pg-diagnostics.sh --enable
bash scripts/pg-diagnostics.sh --report
```

The disposable fixture benchmark creates a temporary database, applies all
migrations, inserts 10,000 posts in one community and 100,000 posts total,
runs `EXPLAIN (ANALYZE, BUFFERS)`, and then exercises both HTTP feed shapes:

```bash
make db-performance-benchmark
```

It never inserts benchmark rows into the live `swartzit` database and removes
the temporary database on exit.

### Latest isolated fixture receipt

Run on 2026-09-23 with the same Apple M1 Pro host and a debug server:

| Fixture/query | SQL execution | HTTP p50 | HTTP p95 | Errors |
| --- | ---: | ---: | ---: | ---: |
| 10k-post community feed | 0.081 ms | 20.63 ms | 107.64 ms | 0/20 |
| 100k-post public feed | 0.051 ms | 3.23 ms | 14.25 ms | 0/20 |

The HTTP sample used concurrency 4. The first community request includes the
normal cold-start/cache-fill cost; repeat release comparisons should use the
same request count and warm-up policy.
