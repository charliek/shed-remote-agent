# Testing

## Unit tests

```bash
bun test --cwd apps/api
```

Currently 47 tests across 7 files, covering the load-bearing pure logic and the exec primitive:

| File | What it covers |
|------|----------------|
| `apps/api/src/lib/__tests__/shedConfig.test.ts` | `~/.shed/config.yaml` parsing + `hostsFromConfig` camelCase mapping |
| `apps/api/src/lib/__tests__/appConfig.test.ts` | `~/.config/shed-remote-agent/config.yaml` parsing, `resolveLocalDir` precedence, the `machines[]` discriminated union (ssh / local / type defaulting / strict rejection) |
| `apps/api/src/lib/__tests__/rc.test.ts` | `classifyPane` on real pane captures across all three kinds (ready, reconnecting, needs-trust, needs-auth, starting) |
| `apps/api/src/lib/__tests__/rcInnerCommand.test.ts` | `buildInnerCommand` for `claude-broker` / `claude-rc` / `shell` with and without the `interactiveShell` wrap |
| `apps/api/src/lib/__tests__/rcAttach.test.ts` | `parseControlMessage` — accepts well-formed resize frames; rejects malformed JSON, wrong types, out-of-range dimensions |
| `apps/api/src/lib/__tests__/exec.test.ts` | `run({ kind: 'local' }, …)` — stdout capture, quoting parity with the SSH wire format, exit codes, stdin piping, timeout sentinel (124) |
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

1. Load `/` — sheds list renders with host badges; a **Machines** section appears if `machines:` is configured
2. Create a shed — progress stream updates live
3. Shed detail — start/stop/delete buttons, RC panel
4. Create a remote-control session — pick a kind (`claude-broker`/`claude-rc`/`shell`); URL appears within ~5 s for `claude-broker`/`claude-rc` on a healthy target
5. Attach in the browser — xterm.js should connect over WS and stream the pane
6. Open a configured machine (SSH or local) — same RC panel; verify the `local` badge appears on local entries
7. Kill the session — card disappears on next poll (within ~10 s)

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every PR:

| Job | Steps |
|-----|-------|
| `lint` | `bunx biome ci .`, then `bunx tsc --noEmit` in `apps/api`, `apps/web`, and `packages/shared` |
| `test` | `bun test` across the workspace (today only `apps/api` has tests) |

`.github/workflows/docs.yml` builds and deploys the mkdocs site to GitHub Pages whenever `docs/**`, `mkdocs.yml`, `pyproject.toml`, or the docs workflow itself changes.
