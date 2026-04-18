# Quick Start

This walkthrough goes from a blank state to a joinable Claude session on your phone in under five minutes. Assumes you've finished [Installation](installation.md) and [Configuration](configuration.md) and have at least one shed-server reachable.

## 1. Open the UI

```bash
bun run dev
```

Open [http://localhost:5173](http://localhost:5173) (or your Tailscale hostname). You should see the **sheds** page — the flat list of every shed across every host in `~/.shed/config.yaml`.

## 2. Create a shed

Tap **+ New shed**. Fill in:

- **Name** — lowercase letters, digits, hyphens. E.g. `demo-rc`.
- **Image** — leave as `(server default)` unless you have a preference.
- **Source** — pick `repo` and select one of your repos (from `github.owners`), or pick `local-dir` and select a directory on the shed host (from `defaults.local_dir.path`). `none` also works — the shed's `/workspace` will just be empty.
- **Start remote-control on create** — leave checked.

Hit **Create shed**. You'll see a progress stream — upstream `shed-server` SSE events are passed straight through: `image`, `rootfs`, `vm-start`, `agent-ready`, etc. When the stream emits `complete`, the shed is up.

## 3. Bootstrap on an existing shed

If you skipped "Start remote-control on create", open the new shed from the list. The detail page shows status + origin + the empty RC sessions panel. Tap **+ New** under *Remote-control sessions*.

The backend SSHes in and launches:

```bash
tmux new-session -d -s rc-<slug> -c /workspace \
  'claude remote-control --name "<shed>/<slug>" --spawn same-dir'
```

Then it polls the pane until one of the terminal states appears. Usually within 2–5 seconds you'll see **ready** + a URL like `https://claude.ai/code?environment=env_01RP...`.

## 4. Join from your phone

Tap **Open** on the session card to launch the Claude app (or `claude.ai/code` in a browser) pointed at that environment. Any command you type in the app runs inside the shed, in `/workspace`, in the pre-provisioned Claude Code you just launched.

If you'd rather paste the URL somewhere else, tap **Copy URL**.

## 5. Kill when done

Tap **Kill** on the session card. The tmux session is destroyed, the session goes `dead`, and `claude.ai/code` will show the environment as disconnected.

!!! note "Sessions survive logouts"
    `claude remote-control` is a persistent tmux-backed process, not tied to your browser. You can close the web UI, reopen it tomorrow, and the session is still alive — as long as the shed stays running.

## Troubleshooting

- **`needs-trust`** — the shed's `/workspace` hasn't been accepted by `claude`. `shed attach <shed>; cd /workspace; claude` once, accept the prompt, exit. Then re-create the RC session.
- **`needs-auth`** — `claude auth login` hasn't been run in the shed. `shed attach <shed>; claude auth login`. Then retry.
- **RC list shows `dead`** — the tmux session was killed or `claude` crashed. Kill the entry from the UI and create a new one.
- **Can't reach a host** — check the host badge on the sheds list; if it's greyed out with an error, the shed-server isn't reachable at `host:http_port` from the backend machine.
