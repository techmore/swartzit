# Performance baseline

This is the first checked-in baseline for release comparisons. Numbers are from the dependency-free `scripts/perf-smoke.mjs` harness against the local API and should only be compared with the same fixture and endpoint shape.

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
