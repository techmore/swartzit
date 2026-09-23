.PHONY: check test fmt web-build perf-smoke

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
