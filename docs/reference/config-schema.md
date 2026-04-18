# Config Schema

Full shape of `~/.config/shed-remote-agent/config.yaml`, validated by `apps/api/src/lib/appConfig.ts`. Every field is optional; the file itself is optional (if missing, defaults apply).

```yaml
defaults:
  local_dir:
    user: string         # SSH user on shed hosts (required if using local-dir picker)
    path: string         # absolute path on shed hosts (required if using local-dir picker)

github:
  owners: [string]       # owners passed to `gh repo list`; empty = repo picker hidden

hosts:
  <host-name>:
    local_dir:
      user: string       # override defaults.local_dir.user for this host
      path: string       # override defaults.local_dir.path for this host
```

## Resolution rules

- `local_dir` for host `H` is resolved by `resolveLocalDir`: `hosts.H.local_dir ?? defaults.local_dir ?? null`. When null, the workspaces endpoint returns `400 BAD_REQUEST` with a message telling you which key to set.
- `github.owners` resolves to `[]` when absent. `GET /api/repos` then returns `{"repos":[],"owners":[]}` so the UI can distinguish "unconfigured" from "no matches".
- The file is memoized in-process for 5 s; edits are picked up automatically.

## Examples

=== "Bare defaults"

    ```yaml
    defaults:
      local_dir:
        user: charliek
        path: /home/charliek/projects
    github:
      owners: [charliek]
    ```

=== "Two hosts, different project roots"

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
      linux-box:
        local_dir:
          user: charliek
          path: /home/charliek/projects
      macbook:
        local_dir:
          user: charliek
          path: /Users/charliek/projects
    ```

=== "No local-dir (repo-only)"

    ```yaml
    github:
      owners: [charliek]
    ```

    The local-dir picker will error with `BAD_REQUEST` if you try to use it, but the repo picker and all other flows still work.

## `~/.shed/config.yaml` — read-only

Defined by the shed CLI. shed-remote-agent extracts only the `servers:` map:

```yaml
servers:
  <host-name>:
    host: string        # hostname / IP
    http_port: number   # shed-server HTTP port
    ssh_port: number    # shed-server SSH port
```

Other fields (`default_server`, `sheds:`, `added_at:`) are ignored.

## Environment variables

See [Configuration → Environment variables](../getting-started/configuration.md#environment-variables) for the runtime knobs (`PORT`, `LOG_LEVEL`, `CORS_ORIGINS`, etc.).
