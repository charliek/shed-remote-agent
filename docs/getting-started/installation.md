# Installation

## Prerequisites

| Prereq | Why |
|--------|-----|
| [Bun](https://bun.com) ≥ 1.0 | Runtime + workspace manager |
| A running [`shed-server`](https://github.com/charliek/shed) (optional) | Needed for the shed flow; not required if you only use native machines |
| `tmux` on every RC target | Backs every RC session, including `type: local` machines (so `tmux` must be on the orchestrator host) |
| `claude` on every RC target (for `agent` / `repl` kinds) | The `shell` kind only needs bash |
| Claude subscription | `claude remote-control` requires `claude auth login` with a claude.ai account |
| `gh` CLI (optional) | Powers the repo picker in the new-shed form |

## Install

```bash
git clone https://github.com/charliek/shed-remote-agent.git
cd shed-remote-agent
bun install
```

## Configure

Copy the example config and edit it:

```bash
mkdir -p ~/.config/shed-remote-agent
cp config.example.yaml ~/.config/shed-remote-agent/config.yaml
```

See [Configuration](configuration.md) for the fields.

If you want the GitHub repo picker:

```bash
gh auth login
```

## Run

```bash
bun run dev
```

Two services start:

- **API** on `:8787` (Hono on Bun)
- **Web** on `:5173` (Vite), proxying `/api` to `:8787`

Open [http://localhost:5173](http://localhost:5173). You should see your sheds listed under the `localhost-dev` (or whatever you named them) host.

!!! note "No auth layer"
    The web app has no login. Deploy it on a Tailscale-exposed host (or behind a reverse proxy that enforces auth). Never expose it to the public internet.

## Deploying on Tailscale

Run the API as a long-lived service (systemd, launchd, whatever). Point Tailscale MagicDNS or a reverse proxy (Caddy, Traefik) at `:5173` (and `:8787` if you split them). On your phone or laptop on the same tailnet, open the MagicDNS hostname — the UI is mobile-first.

Example Caddy block:

```caddy
shed-remote-agent.your-tailnet.ts.net {
  handle /api/* {
    reverse_proxy localhost:8787
  }
  handle {
    reverse_proxy localhost:5173
  }
}
```

## Verify

```bash
curl http://localhost:8787/health
# {"status":"healthy",...}

curl http://localhost:8787/api/hosts
# {"hosts":[{"name":"localhost-dev","host":"localhost","httpPort":8080,"sshPort":2222}]}

curl http://localhost:8787/api/machines
# {"machines":[]}
```

If `/api/hosts` comes back empty, check that `~/.shed/config.yaml` has at least one `servers:` entry. If you want to skip sheds entirely and only use native machines, leave `~/.shed/config.yaml` empty and populate `machines:` in `~/.config/shed-remote-agent/config.yaml` — see [Configuration → With native machines](configuration.md).
