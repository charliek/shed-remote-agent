# Build documentation
docs:
	uv sync --group docs
	uv run mkdocs build

# Serve documentation locally on http://127.0.0.1:7070
docs-serve:
	uv sync --group docs
	uv run mkdocs serve

.PHONY: docs docs-serve
