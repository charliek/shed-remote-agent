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
- **Source** — pick `repo` and select one of your repos (from `github.owners`), or pick `local-dir` and select a directory on the shed host (from `defaults.local_dir.path`). `none` also works — the shed's workspace will just be empty.
- **Start remote-control on create** — leave checked.

Hit **Create shed**. You'll see a progress stream — upstream `shed-server` SSE events are passed straight through: `image`, `rootfs`, `vm-start`, `agent-ready`, etc. When the stream emits `complete`, the shed is up.

## 3. Bootstrap on an existing shed

If you skipped "Start remote-control on create", open the new shed from the list. The detail page shows status + origin + the empty RC sessions panel. Tap **+ New session** to reveal the creation form.

Pick a session **kind** — the default is `repl`:

| Kind | Inner command | When to use |
|------|---------------|-------------|
| `agent` | `claude remote-control --name <display> --spawn same-dir` | Cloud-driven broker. The Claude app picks sessions from this pool and spawns child sessions in the current dir. |
| `repl` | `claude --name <display> /rc` | Interactive Claude REPL with `/rc` enabled. The live conversation is what attachers see. |
| `shell` | `bash -l` | Plain login shell. No Claude — useful for ad-hoc terminal access. |

The backend SSHes in (or spawns directly for `type: local` machines) and launches the inner command inside a detached tmux session named `rc-<slug>`. It then polls the pane until one of the terminal states appears. Usually within 2–5 seconds you'll see **ready** + a URL like `https://claude.ai/code?environment=env_01RP...` (for `agent`/`repl`; `shell` goes straight to `ready` with no URL).

## 4. Join from your phone

Tap **Open** on the session card to launch the Claude app (or `claude.ai/code` in a browser) pointed at that environment. Any command you type in the app runs inside the shed, in its workspace (`SHED_WORKSPACE`), in the pre-provisioned Claude Code you just launched.

If you'd rather paste the URL somewhere else, tap **Copy URL**.

## 5. Attach in the browser

Tap **Terminal** on the session card to open the in-browser terminal. xterm.js streams bytes bidirectionally over a WebSocket; resize, copy/paste, and keep-alive are all handled. This is the same view you'd get from `tmux attach -t rc-<slug>` on the target, with the same persistence — close the tab and the session keeps running.

## 6. Kill when done

Tap **Kill** on the session card. The tmux session is destroyed, the session goes `dead`, and `claude.ai/code` will show the environment as disconnected.

!!! note "Sessions survive logouts"
    `claude remote-control` is a persistent tmux-backed process, not tied to your browser. You can close the web UI, reopen it tomorrow, and the session is still alive — as long as the shed stays running.

## Running RC on a native machine instead of a shed

Native machines (anything that isn't a shed) live in `~/.config/shed-remote-agent/config.yaml` under `machines:`. Two flavors:

```yaml
machines:
  - name: pop-os                # SSH variant (default)
    host: pop-os
    user: charliek
    workdir: /home/charliek/projects

  - name: mac-mini              # Local variant — runs on the orchestrator host itself
    type: local
    workdir: /Users/charliek/projects
```

After editing, machines show up on the sheds page under a **Machines** section. Tap one to open the same RC panel you get on sheds — **+ New session**, kind picker, attach, kill all work the same way. The only difference is the target: SSH machines tunnel through `ssh user@host:port`; local machines spawn tmux directly on the orchestrator. See [Config Schema → Machines](../reference/config-schema.md#machines) for the full shape.

## Troubleshooting

- **`needs-trust`** — the shed's `/workspace` hasn't been accepted by `claude`. `shed attach <shed>; cd /workspace; claude` once, accept the prompt, exit. Then re-create the RC session.
- **`needs-auth`** — `claude auth login` hasn't been run in the shed. `shed attach <shed>; claude auth login`. Then retry.
- **RC list shows `dead`** — the tmux session was killed or `claude` crashed. Kill the entry from the UI and create a new one.
- **Can't reach a host** — check the host badge on the sheds list; if it's greyed out with an error, the shed-server isn't reachable at `host:http_port` from the backend machine.
