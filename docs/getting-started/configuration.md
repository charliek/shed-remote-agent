# Configuration

shed-remote-agent reads two YAML files.

## `~/.shed/config.yaml` — shed hosts

This file is **owned by the `shed` CLI**. shed-remote-agent reads it and never writes to it. Every entry under `servers:` becomes a host in the UI.

```yaml
servers:
    localhost-dev:
        host: localhost
        http_port: 8080
        ssh_port: 2222
default_server: localhost-dev
```

Run `shed server add <name> ...` or edit this file with the shed CLI. See the [shed docs](https://charliek.github.io/shed/reference/configuration/).

## `~/.config/shed-remote-agent/config.yaml` — agent-specific

This file configures the bits that are unique to this project: the GitHub owners used for the repo picker, the SSH user + path used to list local directories on a shed host, and the optional list of native machines that can host RC sessions alongside sheds.

Start from [`config.example.yaml`](https://github.com/charliek/shed-remote-agent/blob/main/config.example.yaml) in the repo.

=== "Minimal"

    ```yaml
    defaults:
      local_dir:
        user: charliek
        path: /home/charliek/projects
    github:
      owners:
        - charliek
    ```

=== "With per-host override"

    ```yaml
    defaults:
      local_dir:
        user: charliek
        path: /home/charliek/projects
    github:
      owners:
        - charliek
        - your-org
    hosts:
      macbook:
        local_dir:
          user: charliek
          path: /Users/charliek/projects
    ```

=== "With native machines"

    ```yaml
    defaults:
      local_dir:
        user: charliek
        path: /home/charliek/projects
    github:
      owners:
        - charliek

    machines:
      # SSH machine (e.g. a tailnet box reachable via Tailscale SSH).
      - name: pop-os
        host: pop-os
        user: charliek
        workdir: /home/charliek/projects
      # Local machine: runs tmux directly on the orchestrator host with
      # no SSH hop. Useful when Tailscale SSH can't loop back to this node.
      - name: mac-mini
        type: local
        workdir: /Users/charliek/projects
    ```

### Fields

| Field | Type | Purpose |
|-------|------|---------|
| `defaults.local_dir.user` | string | SSH username the backend uses when listing local directories on a shed host |
| `defaults.local_dir.path` | string | Absolute path on shed hosts where projects live (the local-dir picker lists this dir) |
| `github.owners` | string[] | GitHub user/org names passed to `gh repo list` for the repo picker |
| `hosts.<name>.local_dir` | object | Per-host override for `defaults.local_dir` (keyed by the shed-host name from `~/.shed/config.yaml`) |
| `machines[]` | object[] | Native RC targets that are not sheds. See [Config Schema → Machines](../reference/config-schema.md#machines) for the discriminated-union shape (SSH vs local). |

See [Config Schema](../reference/config-schema.md) for the full shape.

## Environment variables

The backend reads a small set of env vars (all optional):

| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `8787` | HTTP port the API listens on |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | Switches log formatting (pretty vs JSON) |
| `LOG_LEVEL` | `info` | `trace` / `debug` / `info` / `warn` / `error` / `fatal` |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated origin allowlist. Gates both the HTTP CORS middleware **and** the in-browser terminal WebSocket (CSWSH defense), so if you serve the UI from anywhere other than `http://localhost:5173` you must add it here. |
| `SHED_CONFIG_PATH` | `~/.shed/config.yaml` | Override the shed CLI config path |
| `APP_CONFIG_PATH` | `~/.config/shed-remote-agent/config.yaml` | Override the agent config path |

For the frontend, only `VITE_API_URL` is read (defaults to `/api` via the Vite dev proxy).

## Auth inside sheds

The web app cannot drive `claude auth login` yet. Before bootstrapping a remote-control session in a shed, SSH in and run `claude auth login` once:

```bash
shed attach <shed-name>
claude auth login
```

The same applies to workspace trust — `claude` will refuse to start remote-control in a directory it hasn't been trusted in yet. The UI detects both conditions and surfaces a `needs-auth` or `needs-trust` state with instructions.
