# Build documentation
docs:
	uv sync --group docs
	uv run --locked zensical build --strict

# Serve documentation locally on http://127.0.0.1:7070
docs-serve:
	uv sync --group docs
	uv run --locked zensical serve

.PHONY: docs docs-serve
