.PHONY: check test fmt web-build

check:
	cargo check --workspace

test:
	cargo test --workspace

fmt:
	cargo fmt --all -- --check

web-build:
	cd apps/web && npm run build
