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

machines:                # native (non-shed) RC targets; see "Machines" below
  - { …ssh entry… }
  - { …local entry… }
```

## Resolution rules

- `local_dir` for host `H` is resolved by `resolveLocalDir`: `hosts.H.local_dir ?? defaults.local_dir ?? null`. When null, the workspaces endpoint returns `400 BAD_REQUEST` with a message telling you which key to set.
- `github.owners` resolves to `[]` when absent. `GET /api/repos` then returns `{"repos":[],"owners":[]}` so the UI can distinguish "unconfigured" from "no matches".
- `machines` resolves to `[]` when absent. The UI hides the Machines section if empty.
- The file is memoized in-process for 5 s; edits are picked up automatically.

## Machines

Each entry under `machines:` is a discriminated union keyed by `type`. The discriminator defaults to `ssh` when absent, so configs that predate this field keep parsing unchanged.

### `type: ssh`

```yaml
machines:
  - name: pop-os                # required, unique
    type: ssh                   # optional, defaults to 'ssh'
    host: pop-os                # required — hostname or IP
    user: charliek              # required — SSH user
    ssh_port: 22                # optional, defaults to 22
    workdir: /home/charliek/projects   # optional, RC bootstrap falls back to '~'
```

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Unique key. Used in URLs (`/api/machines/<name>/…`) and the UI. |
| `type` | `"ssh"` | Default. Omitting `type` is equivalent. |
| `host` | string | Hostname or IP. Tailscale MagicDNS names work. |
| `user` | string | SSH login user. |
| `ssh_port` | number | Optional. Defaults to 22. |
| `workdir` | string | Optional. RC bootstrap uses it as `tmux -c <workdir>`; `/api/machines/<name>/workspaces` requires it (returns 400 otherwise). Empty/whitespace strings are rejected at parse time. |

### `type: local`

Runs commands directly on the host the orchestrator process is running on — no SSH. Useful when Tailscale SSH can't loop back to the local node.

```yaml
machines:
  - name: mac-mini
    type: local
    user: charliek                       # optional, display-only
    workdir: /Users/charliek/projects    # optional, same semantics as the ssh variant
```

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Same as the ssh variant. |
| `type` | `"local"` | Required to select the local variant. |
| `user` | string (optional) | Display only. Commands run as whatever user owns the API process. |
| `workdir` | string (optional) | Same semantics as the ssh variant. |

The local schema is **strict**: putting `host` or `ssh_port` on a local entry is a parse error rather than a silent drop, because in practice it always means "I copy-pasted from an ssh entry and forgot to remove these."

### Comparison

| Aspect | `type: ssh` | `type: local` |
|--------|-------------|---------------|
| Connection | `ssh user@host:ssh_port` per command | `Bun.spawn(['bash','-c', …])` in-process |
| Required prereqs on target | `tmux`, `claude` (for agent/repl), SSH key in `authorized_keys` | `tmux`, `claude` (for agent/repl). No SSH. |
| `interactiveShell` wrap | Yes — `bash -ic` wraps `claude` so PATH (nvm/asdf) is loaded | Yes — same wrapper, same reason |
| Browser attach | `ssh -tt … tmux attach` | Direct `tmux attach` under Bun's PTY |
| `user` field | Required (SSH login) | Optional (display only) |

Both variants share the rest of the RC pipeline (slug generation, classifier, lifecycle states, WS attach). The UI lists machines in a separate "Machines" section on the sheds page; tapping one routes to the same RC panel.

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
    host: string         # hostname / IP
    ssh_port: number     # shed-server SSH port
    http_port: number    # plain-HTTP API port — required only for a plain-HTTP
                         #   (no api_url) server; may be omitted for secure ones

    # Secure ("auth + TLS") servers — written by shed v0.7+. All-or-nothing:
    api_url: string                  # https://host:8443 — must be https
    control_token: string            # bearer control token (seed)
    control_token_expires_at: string # RFC3339 expiry of control_token
    tls_cert_fingerprint: string     # sha256:<64 lowercase hex> — pins the cert
```

A server is **secure** when it has an `api_url` (see
[Secure sheds](secure-sheds.md)). The loader is fail-closed: an `api_url` must be
`https://` and requires both a `control_token` and a `tls_cert_fingerprint`; a
token/pin without a https `api_url` is rejected; and a plain-HTTP server (no
`api_url`) must still set `http_port`. The token and fingerprint never cross to
the browser. Other fields (`default_server`, `sheds:`, `added_at:`) are ignored.

## Environment variables

See [Configuration → Environment variables](../getting-started/configuration.md#environment-variables) for the runtime knobs (`PORT`, `LOG_LEVEL`, `CORS_ORIGINS`, etc.).
