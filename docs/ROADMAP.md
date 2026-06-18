# Roadmap

Deferred work — noted here so it doesn't evaporate from the design discussion, but explicitly not part of the MVP. Each item has a one-line rationale.

## Claude integration

- **In-browser Claude chat** — proxy to a web UI running inside the shed via the shed Connect API. Significantly more work than the current "open in Claude app" flow and the app experience is already excellent on mobile.
- **Worktree spawn mode** — use `claude remote-control --spawn worktree` so each on-demand session gets its own git worktree. Requires the shed's workspace (`SHED_WORKSPACE`) to be a git repo and `WorktreeCreate`/`WorktreeRemove` hooks.
- **Web-driven `claude auth login`** — drive the OAuth flow from the UI instead of asking the user to `shed attach` and run it manually. Needs a small callback-server inside the shed.
- **Pre-seed workspace trust on shed create** — reverse-engineer Claude Code's trust file format and write it during shed bootstrap so first-run `claude remote-control` never hits the trust prompt.
- **Live rc status via SSE / WebSocket** — currently the UI polls `/api/sheds/:host/:name/rc` every 10 s. A push channel from the backend would drop the polling and feel instant.

## Shed orchestration

- **Branch selection for repo clones** — shed-server's create API doesn't accept a branch today, only a repo URL. Supporting this needs an upstream change to `config.CreateShedRequest`.
- **Host add/edit flow in the UI** — today you edit `~/.shed/config.yaml` with the shed CLI. A small form in the UI would be convenient but duplicates shed's domain.
- **Resource preview on create** — show how many CPUs/RAM the chosen image needs; warn if the host is near capacity.

## Reliability

- **TypeScript test/lint CI** — GitHub Actions currently only runs the docs workflow. Add a matrix for `bun test` + `bun run lint` + `bun run --cwd apps/web build` on push.
- **Structural logging tests** — integration tests that drive a real shed-server and assert on the error surface for each state (`needs-trust`, `needs-auth`, etc.).
- **E2E Playwright smoke** — covers the create-shed + bootstrap-RC flow end-to-end.

## Polish

- **QR rendering for session URLs** — nice-to-have for the mobile hand-off. Currently you can `space` inside the tmux pane to see one; the web UI only shows the URL + Copy/Open buttons.
- **Desktop shortcut / PWA install** — a manifest + service worker so the UI lives on your phone's home screen.
- **Configurable polling cadence** — the default 10 s is fine but agents on flaky networks might want slower polling.

## Explicitly not going to happen

- **Multi-tenant auth layer** — this is a single-user tool designed for Tailscale. Don't put it on the public internet. If you need multi-tenancy, shed-remote-agent is the wrong starting point.
