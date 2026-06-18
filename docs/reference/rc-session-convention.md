# RC Session Convention

A tool-neutral standard for **remote-control (RC) sessions** — the detached tmux
sessions that run `claude remote-control` (or a REPL / shell) on a shed or machine.

The goal is interoperability: `shed-remote-agent`, `shed-desktop`, the `shed` CLI,
and any future client (e.g. a mobile app) can all create, discover, classify,
attach to, and tear down the same sessions, see what each other did, and pick a
session up where another tool left off — **without** a central registry.

This page is **normative**. The keywords MUST, SHOULD, and MAY are used as in
[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). The implementation in this repo
([Remote Control](remote-control.md)) is the reference.

## Design principles

- **The tmux session is the source of truth.** All durable metadata lives in the
  session itself. There is no sidecar file, database, or registry to keep in sync.
- **State is derived, never stored.** Liveness (`starting`/`ready`/…) and the
  `claude.ai` URL are computed from the pane on demand, so they are always fresh
  and never a source of cross-tool write contention.
- **Visibility over locking.** The convention targets **one tool driving sessions
  at a time**. It records *who did what* (provenance) so tools don't surprise each
  other, but it does **not** provide locking. Concurrent control by multiple tools
  is out of scope; the known hazards are documented below.
- **Additive and versioned.** New keys can be added without a breaking change; a
  single integer version guards the rare incompatible change.

## Terminology

| Term | Meaning |
|------|---------|
| **RC session** | A tmux session whose name begins with the reserved `rc-` prefix. |
| **Managed** | An RC session carrying a valid `SHED_RC_V` (created under this convention). |
| **Legacy / unmanaged** | An `rc-*` session with no (or a malformed) `SHED_RC_V` — e.g. created by an older tool or by hand. Still listable and killable; rendered with defaults. |
| **Target** | Where the session runs and how a tool reaches it (a shed over SSH, an SSH machine, or a local machine). Resolved by the caller, **not** stored authoritatively in the session. |

## Session naming

- An RC session's tmux name MUST be `rc-<slug>`.
- The `rc-` prefix is **reserved**. A tool MUST treat any `rc-*` tmux session as an
  RC session in scope of this convention.
- **Generated** slugs MUST be 6 characters from the confusable-free alphabet
  `abcdefghjkmnpqrstuvwxyz23456789` (no `0/o`, `1/l/i`), so a slug survives being
  read back from a QR code or typed URL.
- **Caller-supplied** slugs MAY be longer but MUST match
  `^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$`.
- `rc-<slug>` is valid under shed's own session-name grammar, so RC sessions also
  appear in `shed sessions` / `GET /api/sessions`.

## Metadata store

Metadata MUST be stored as **tmux session environment variables**, set atomically
at creation with `tmux new-session -e KEY=value …` and read with
`tmux show-environment -t <session>`.

This requires **tmux ≥ 3.0** (the version that added `new-session -e`).

!!! note "Why session env, not user-options"
    Session env can be set atomically in the same `new-session` call, so a session
    never exists without its metadata, and it is trivially readable from any
    context. The trade-off is that these variables are exported into the session's
    child processes (e.g. `claude`). That is acceptable for non-secret descriptive
    metadata. It is **not** acceptable for identity/secrets — see
    [`SHED_RC_OWNER`](#reserved-shed_rc_owner).

### Value grammar

Every `SHED_RC_*` value MUST be a single line of UTF-8 with **no control
characters** (no newline, carriage return, or tab). The reference discovery
mechanism is line-oriented, so an embedded newline would corrupt parsing of every
following session. Writers MUST reject such values.

### Keys (v1)

| Key | Required | Meaning |
|-----|----------|---------|
| `SHED_RC_V` | managed | Schema version. A positive integer. `1` for this revision. |
| `SHED_RC_ID` | managed | Opaque, stable session id (a UUIDv4). Generated once at create; never reused. The durable identity for correlating logs/events across tools. |
| `SHED_RC_DISPLAY_NAME` | managed | Human-facing name; also passed as `--name` to `claude`. |
| `SHED_RC_KIND` | managed | `agent`, `repl`, or `shell`. |
| `SHED_RC_WORKDIR` | managed | Working directory the session started in. |
| `SHED_RC_CREATED_BY` | managed | Provenance as `<tool>/<version>` (e.g. `shed-remote-agent/0.1.0`). |
| `SHED_RC_CREATED_AT` | managed | Creation time, RFC 3339 UTC with a trailing `Z` (the shape `Date.toISOString()` produces). |
| `SHED_RC_TARGET` | optional | Advisory, **non-authoritative** target label for attribution (e.g. `shed:my-shed@host`, `machine:foo`). MUST NOT be trusted for routing — it can go stale. |
| `SHED_RC_OWNER` | reserved | Authenticated principal. Not used in v1. See below. |

The slug is **not** an identity: it can be caller-supplied, is reused across
kill/recreate, and is only unique within a target. Use `SHED_RC_ID` to correlate.

`SHED_RC_CREATED_BY` is parsed by splitting on the **final** `/`; the tool token
MUST NOT contain `/`.

### Reserved: `SHED_RC_OWNER`

Reserved for the authenticated principal once shed gains identity (an
auth/identity refactor is in progress on the `shed` side). When implemented:

- It MUST be an **advisory provenance hint, never an authorization decision** —
  tmux env is mutable by the target user and visible to child processes.
- It MUST contain only a stable, non-secret, issuer-qualified principal identifier
  (e.g. an email or `<issuer>#<sub>`). It MUST NOT contain bearer tokens,
  passwords, or API keys.
- Because it is identity material, it SHOULD be stored as a tmux **user-option**
  (`set-option -t <session> @shed_rc_owner …`, issued right after `new-session`)
  rather than via `-e`, so it is not exported into the `claude` child process. This
  is the one field that intentionally departs from the session-env rule above.

## Derived fields (never stored)

`state` and `url` MUST be computed from `tmux capture-pane`, not stored:

| `state` | Meaning |
|---------|---------|
| `starting` | No URL or status line yet. |
| `ready` | Terminal-good for the kind (URL present for `agent`/`repl`; any output for `shell`). |
| `reconnecting` | `claude remote-control` is reconnecting (`agent` only). |
| `needs-trust` | `claude` refused — workspace not trusted. |
| `needs-auth` | `claude` needs a `claude.ai` login. |
| `dead` | The tmux session is gone. |

See [Remote Control → States](remote-control.md#states) for the classifier regexes.
For legacy/unmanaged sessions, state is **best-effort** (kind is assumed `agent`).

## Workspace-trust auto-accept (repl/agent)

Claude Code shows a first-run workspace-trust prompt the first time it runs in a
directory. To start a session unattended, a creating tool SHOULD clear it with a
two-part, belt-and-suspenders convention (verified on claude 2.1.178):

1. **Pre-seed** (before launch): merge `projects["<workdir>"].hasTrustDialogAccepted
   = true` into Claude's config JSON — `${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json`
   (NOT `~/.claude/.claude.json`; `CLAUDE_CONFIG_DIR` moves the file). **Merge,
   don't clobber** — the file holds OAuth/MCP state. Use the exact absolute
   workdir path. This persists for project subdirectories; it does **not** persist
   for the home directory (Claude holds home-dir trust per-session only).
2. **Accept** (fallback, while probing): if the trust prompt is still detected
   (`needs-trust`), send `Enter` to the pane once — option "1. Yes, I trust this
   folder" is pre-selected — then keep probing toward `ready`.

A tool that does neither leaves the session in `needs-trust` (still valid — the
user accepts manually). `shell` sessions skip this (no Claude, no trust gate).

## Reading rules

1. List candidates with `tmux ls` and keep names beginning with `rc-`.
2. For each, read its metadata with a single `tmux show-environment -t <session>`
   and keep the `SHED_RC_*` lines (tmux prints `KEY=value`; a bare `-KEY` denotes
   a removed var and MUST be ignored).
3. A session is **managed** iff `SHED_RC_V` is a positive integer. A missing or
   malformed version means **legacy/unmanaged**.
4. Unknown `SHED_RC_*` keys MUST be ignored.
5. A reader that supports version *N* and encounters `SHED_RC_V > N` MUST still
   treat the session as managed: render the fields it understands, ignore the rest,
   and **never drop the session**.
6. Defaults for a legacy/unmanaged session:
    - `kind` → `agent` (pre-convention sessions were all agents). Note this differs
      from the create-time default (`repl`).
    - display name → a caller fallback such as `<target>/<slug>`.
    - workdir → the reader's own **target-specific** default (e.g. the shed's
      `SHED_WORKSPACE` landing dir for sheds — `/workspace` on older sheds; the
      machine's configured workdir for machines).

## Writing rules

- A creator MUST set all required v1 keys atomically in the `new-session` call.
- A managed session (`SHED_RC_V ≥ 1`) MUST carry **all** required v1 keys; absence
  of a required key on a managed session is non-conformant and a reader MAY treat
  it as legacy.
- Metadata is **write-once at create**. A tool MUST NOT rewrite another tool's
  session metadata.
- `SHED_RC_V` is bumped only for removals or semantic changes. Adding a key does
  **not** bump it.

## Coordination & concurrency

The convention assumes **one tool drives sessions at a time**. Under that
assumption it is safe by construction:

- **Kill is idempotent** — killing a missing session is success.
- **Generated slugs are collision-resistant** — ~887M combinations.
- **Metadata is immutable** after create, and **state is derived**, so there is
  nothing for two readers to race on.
- **`SHED_RC_ID`** lets tools correlate the same session across logs/events.

Known hazards under genuine concurrent use (documented, not prevented):

| Hazard | Behavior |
|--------|----------|
| Two clients attach at once | tmux shares one window; it is sized to the smallest/most-recent client. Expect a degraded terminal, not corruption. |
| Two creators pick the same caller-supplied slug | tmux refuses the duplicate name; the second create fails cleanly. The reference API surfaces this as `409 RC_SLUG_TAKEN` so the caller can retry with a fresh slug. |
| List-then-act, session killed in between | The follow-up `capture-pane`/`attach` fails benignly (the session reads as `dead`). |
| Hand-created `rc-*` sessions | Render as legacy/unmanaged. A UI SHOULD label them as such before offering destructive actions. |

## Transport independence

The session is the source of truth regardless of how a tool reaches tmux:

- **SSH + tmux** for sheds and SSH machines.
- **Local tmux** for `type: local` machines (no SSH hop).
- **HTTP** via shed's API. To let HTTP-only clients (e.g. mobile) participate
  without SSH, `shed` SHOULD surface the `SHED_RC_*` block (e.g. a `shed_rc`
  object) on `GET /api/sessions`. (Tracked as a `shed` follow-up.)

## Migration from `SRA_*`

Earlier builds of `shed-remote-agent` and `shed-desktop` used an app-named `SRA_*`
prefix (`SRA_DISPLAY_NAME` / `SRA_KIND` / `SRA_WORKDIR`). That prefix is **not part
of this standard** and is not read by conformant v1 tools.

There is no automatic migration. A pre-existing `SRA_*` session appears as
legacy/unmanaged (still listable and killable). Kill and recreate it once the tools
you use have adopted v1.

!!! warning "Mixed-fleet interop window"
    Until every tool you use adopts v1, tools at different versions will render each
    other's sessions as legacy/unmanaged (defaults only — the session is still
    attachable and killable). Adopt the convention across your tools, then recreate
    any sessions whose metadata you want fully restored.

## Conformance checklist

A conformant tool:

- [ ] Names sessions `rc-<slug>` with a valid slug.
- [ ] Writes all required v1 keys atomically at create, single-line values only.
- [ ] Generates a fresh `SHED_RC_ID` per session; sets `SHED_RC_CREATED_BY` and
      `SHED_RC_CREATED_AT`.
- [ ] Lists every `rc-*` session; reads `SHED_RC_*`; ignores unknown keys; never
      drops a higher-version session.
- [ ] Treats missing/malformed `SHED_RC_V` as legacy with the defaults above.
- [ ] Derives `state`/`url` from the pane; never stores them.
- [ ] Never rewrites another tool's metadata; never puts secrets in `SHED_RC_*`.
