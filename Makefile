.PHONY: check test fmt web-build perf-smoke db-performance-benchmark pg-diagnostics release-preflight

check:
	cargo check --workspace

test:
	cargo test --workspace

fmt:
	cargo fmt --all -- --check

web-build:
	cd apps/web && npm run build

perf-smoke:
	node scripts/perf-smoke.mjs --url "$${API_URL:-http://127.0.0.1:18080}" --path "$${PERF_PATH:-/health}" --requests "$${PERF_REQUESTS:-100}" --concurrency "$${PERF_CONCURRENCY:-4}"

db-performance-benchmark:
	bash scripts/db-performance-benchmark.sh

pg-diagnostics:
	bash scripts/pg-diagnostics.sh "$${PG_DIAGNOSTICS_MODE:---check}"

release-preflight:
	bash scripts/release-preflight.sh
