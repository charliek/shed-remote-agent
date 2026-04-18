# Testing

## Unit tests

```bash
bun test --cwd apps/api
```

Currently 17 tests across 4 files, covering the load-bearing pure logic:

| File | What it covers |
|------|----------------|
| `apps/api/src/lib/__tests__/shedConfig.test.ts` | `~/.shed/config.yaml` parsing + `hostsFromConfig` camelCase mapping |
| `apps/api/src/lib/__tests__/appConfig.test.ts` | `~/.config/shed-remote-agent/config.yaml` parsing, `resolveLocalDir` precedence |
| `apps/api/src/lib/__tests__/rc.test.ts` | `classifyPane` on real pane captures (ready, reconnecting, needs-trust, needs-auth, starting) |
| `apps/api/src/lib/__tests__/shedClient.test.ts` | `parseSSEStream` — chunked input, comment lines, multi-line `data:`, trailing-event flush |

Tests use `bun:test` and live alongside the code under `__tests__/`.

## Lint / format

```bash
bun run lint         # biome check .
bun run lint:fix     # biome check --write .
bun run format       # biome format --write .
```

Exits 0 on warnings (e.g. cognitive-complexity info notes on a couple of TSX files); exits non-zero on real errors.

## Manual smoke

Hard-coded against your local shed-server — useful before committing:

```bash
bun run --cwd apps/api src/index.ts &
API=$!

curl -sS http://127.0.0.1:8787/health
curl -sS http://127.0.0.1:8787/api/hosts
curl -sS http://127.0.0.1:8787/api/sheds
curl -sS -N -X POST -H "Content-Type: application/json" \
  -d '{"name":"smoke","no_provision":true}' \
  http://127.0.0.1:8787/api/sheds/localhost-dev

kill $API
```

For the UI, start `bun run dev` and click through:

1. Load `/` — the sheds list should render with the host badge
2. Create a shed — progress stream should update live
3. Shed detail — start/stop/delete buttons, RC panel
4. Create a remote-control session — URL should appear within ~5s on a healthy shed
5. Kill the session — card disappears on next poll (within ~10s)

## CI

Today GitHub Actions runs only the docs workflow (`.github/workflows/docs.yml`). A TS test/lint workflow hasn't been added yet — it's tracked in the [Roadmap](../ROADMAP.md).
