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
  single integer version (`SHED_RC_V`) guards the rare incompatible change. The
  current version is **2** (the v1→v2 break renamed the kinds — see
  [Versioning](#versioning-v1--v2)).
- **A shared guest binary owns lifecycle.** Rather than each tool reimplementing the
  SSH+tmux choreography, the canonical implementation is a small guest-side binary,
  [`shed-ext-rc`](#the-shed-ext-rc-guest-binary), baked into the shed image. Tools
  invoke it over SSH and consume its JSON, so every tool creates byte-compatible
  sessions and classifies them identically.

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

### Keys (v2)

| Key | Required | Meaning |
|-----|----------|---------|
| `SHED_RC_V` | managed | Schema version. A positive integer. `2` for this revision. A reader treats `SHED_RC_V < 2` (or missing) as legacy/unmanaged. |
| `SHED_RC_ID` | managed | Opaque, stable session id (a UUIDv4). Generated once at create; never reused. The durable identity for correlating logs/events across tools. |
| `SHED_RC_DISPLAY_NAME` | managed | Human-facing name; also passed as `--name` to `claude`. |
| `SHED_RC_KIND` | managed | `claude-broker`, `claude-rc`, or `shell` (see [Kinds](#kinds)). |
| `SHED_RC_WORKDIR` | managed | Working directory the session started in. |
| `SHED_RC_CREATED_BY` | managed | Provenance as `<tool>/<version>` (e.g. `shed-remote-agent/0.1.0`, `shed-desktop/0.1.0`, `shed-ext-rc/0.5.0`). |
| `SHED_RC_CREATED_AT` | managed | Creation time, RFC 3339 UTC with a trailing `Z` (the shape `Date.toISOString()` produces). |
| `SHED_RC_TARGET` | optional | Advisory, **non-authoritative** target label for attribution (e.g. `shed:my-shed@host`, `machine:foo`). MUST NOT be trusted for routing — it can go stale. |
| `SHED_RC_OWNER` | reserved | Authenticated principal. Not used yet. See below. |

#### Kinds

`SHED_RC_KIND` is a flat `<tool>-<mode>` value so the model can grow to other agents
later (e.g. `opencode-rc`, `codex-rc`); brokers exist only where a tool has one.

| Kind | Inner command | Notes |
|------|---------------|-------|
| `claude-rc` | `claude --name <display> /rc` | Interactive `claude` REPL with `/rc`; the live conversation is what attachers see. The create-time default. |
| `claude-broker` | `claude remote-control --name <display> --spawn same-dir` | The broker/multiplexer; hosts up to 32 cloud-driven sessions. |
| `shell` | `bash -l` | Plain login shell; tool-agnostic. |

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
| `ready` | Terminal-good for the kind (URL present for `claude-broker`/`claude-rc`; any output for `shell`). |
| `reconnecting` | `claude remote-control` is reconnecting (`claude-broker` only). |
| `needs-trust` | `claude` refused — workspace not trusted. |
| `needs-auth` | `claude` needs a `claude.ai` login. |
| `dead` | The tmux session is gone. |

See [Remote Control → States](remote-control.md#states) for the classifier regexes.
For legacy/unmanaged sessions, state is **best-effort** (kind is assumed
`claude-broker`).

## Working directory (sheds)

A shed session SHOULD start in the shed's **landing directory**, exposed as the env
var **`SHED_WORKSPACE`** (`/home/<user>`, or the project subdirectory
`/home/<user>/<proj>` for a repo/local-dir shed). `shed-ext-rc` runs *inside* the
shed, so it reads `SHED_WORKSPACE` directly and uses it as the default `--workdir`,
passing it to `tmux new-session -c <workdir>` (and `SHED_RC_WORKDIR`). An explicit
caller-supplied `--workdir` wins. (A tool that does not use the binary can resolve
the same value with a one-shot `printenv SHED_WORKSPACE` SSH probe, treating **only**
exit code 1 as "unset" — any other non-zero exit is a transport failure and SHOULD
surface, not silently misplace the session.)

## Workspace-trust auto-accept (claude-rc/claude-broker)

Claude Code shows a first-run workspace-trust prompt the first time it runs in a
directory. As of claude 2.1.178 **no CLI flag, env var, or `settings.json` key
pre-trusts a directory for an interactive/remote-control session** —
`--dangerously-skip-permissions` and `--permission-mode` do not skip it, and `-p`
(print mode) skips trust but is one-shot (no persistent session URL), and
`git init` does **not** skip it. So to start a session unattended, a creating
tool SHOULD clear it with a two-part, belt-and-suspenders convention (verified on
claude 2.1.178; `shed-ext-rc create` does both):

1. **Pre-seed** (before launch): merge `projects["<workdir>"].hasTrustDialogAccepted
   = true` into Claude's config JSON — `${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json`
   (NOT `~/.claude/.claude.json`; `CLAUDE_CONFIG_DIR` moves the file; an empty value
   is treated as unset). **Merge, don't clobber** — the file holds OAuth/MCP state,
   so a conformant writer round-trips unknown keys (it MUST NOT deserialize into a
   typed struct that drops them), writes atomically (temp file in the *same*
   directory, then rename), holds a file lock across the read-modify-write so
   concurrent creates don't lose each other's inserts, and leaves a malformed
   existing file untouched. Use the exact absolute workdir path. This persists for
   project subdirectories; it does **not** persist for the home directory.
2. **Accept** (fallback, while probing): if the trust prompt is still detected
   (`needs-trust`), re-capture the pane to confirm the dialog is present, then send
   `Enter` once — option "1. Yes, I trust this folder" is pre-selected — and keep
   probing toward `ready`.

A tool that does neither leaves the session in `needs-trust` (still valid — the
user accepts manually). `shell` sessions skip this (no Claude, no trust gate).

## Initial prompt (claude-rc / shell)

A creating tool MAY accept an optional **initial line** to kick off a session. Once
the session is `ready`, type it and submit: `tmux send-keys -t <session> -l "<line>"`
then `tmux send-keys -t <session> Enter`. For `claude-rc` it is a **prompt** into the
live REPL; for `shell` it is a **command** to run. It MUST NOT be used for
`claude-broker` (its input is the remote URL, not the pane). Constraints: send it
**only** at `ready`; treat it as **best-effort** (the session is the deliverable, so
a failed send must not fail creation); it is a single line (submitted on Enter) with
no control characters. To avoid an argv injection where a line beginning with `-` is
mis-parsed as a flag, the line SHOULD be passed to the binary via **stdin**, not as a
command-line argument.

## Reading rules

1. List candidates with `tmux ls` and keep names beginning with `rc-`.
2. For each, read its metadata with a single `tmux show-environment -t <session>`
   and keep the `SHED_RC_*` lines (tmux prints `KEY=value`; a bare `-KEY` denotes
   a removed var and MUST be ignored).
3. A session is **managed** iff `SHED_RC_V` is a canonical positive integer **≥ 2**.
   A missing, malformed, or pre-v2 (`1`) version means **legacy/unmanaged**.
4. Unknown `SHED_RC_*` keys MUST be ignored. An unrecognized `SHED_RC_KIND` value is
   treated as legacy/unmanaged (no v1→v2 aliasing — see [Versioning](#versioning-v1--v2)).
5. A reader that supports version *N* (≥ 2) and encounters `SHED_RC_V > N` MUST still
   treat the session as managed: render the fields it understands, ignore the rest,
   and **never drop the session**.
6. Defaults for a legacy/unmanaged session:
    - `kind` → `claude-broker` (the renamed analog of the pre-convention default).
      Note this differs from the create-time default (`claude-rc`).
    - display name → a caller fallback such as `<target>/<slug>`.
    - workdir → the reader's own **target-specific** default (e.g. the shed's
      `SHED_WORKSPACE` landing dir for sheds; the machine's configured workdir for
      machines).

## Writing rules

- A creator MUST set all required v2 keys atomically in the `new-session` call, with
  `SHED_RC_V=2`.
- A managed session (`SHED_RC_V ≥ 2`) MUST carry **all** required v2 keys; absence
  of a required key on a managed session is non-conformant and a reader MAY treat
  it as legacy.
- Metadata is **write-once at create**. A tool MUST NOT rewrite another tool's
  session metadata.
- `SHED_RC_V` is bumped only for removals or semantic changes (such as the v1→v2 kind
  rename). Adding a key does **not** bump it.

## Versioning (v1 → v2)

v2 renamed the `SHED_RC_KIND` values — a value-grammar change to an existing key, so
it bumps `SHED_RC_V`:

| v1 (retired) | v2 |
|--------------|-----|
| `agent` | `claude-broker` |
| `repl` | `claude-rc` |
| `shell` | `shell` (unchanged) |

There is **no aliasing**. A v2 reader does not translate old values: a session with
`SHED_RC_V=1` (or an unrecognized kind) is rendered as legacy/unmanaged — still
listable and killable, kind defaulting to `claude-broker` — never crashing and never
dropped. Adopt v2 across your tools, then kill and recreate any v1 sessions whose
metadata you want fully restored. (The shed image must ship `shed-ext-rc` before the
dependent apps' v2 builds work — see below.)

## The `shed-ext-rc` guest binary

`shed-ext-rc` is the canonical implementation of this convention. It is a one-shot Go
binary baked into the shed `full` image at `/usr/local/bin/shed-ext-rc`; orchestrators
invoke it over SSH (`ssh <shed>@<host> shed-ext-rc <subcommand> …`) and consume its
JSON. Because all tools share it, sessions created by any tool are byte-compatible and
classify identically. (The interactive terminal **attach** is *not* routed through the
binary — it stays a direct `ssh … tmux attach`.)

### Subcommands

| Command | Behaviour |
|---------|-----------|
| `create --kind <k> --name <display> [--slug <s>] [--workdir <d>] [--created-by <tool/ver>] [--target <label>] [--wait]` | Resolve the workdir (`$SHED_WORKSPACE` default), pre-seed claude trust for `claude-*` kinds, and `tmux new-session` with the `SHED_RC_*` env. Non-blocking by default. With `--wait`, poll to `ready`, accept trust, and deliver a prompt. A `--prompt`/`--text` line is read from **stdin**. Prints the resulting [DTO](#json-output-the-neutral-dto). |
| `list` | Print `{ "rc_sessions": [DTO, …] }` for every `rc-*` session. |
| `probe --slug <s>` | Print one DTO (state + url). Read-only. |
| `accept-trust --slug <s>` | Re-capture the pane; if the trust dialog is present, send `Enter`. |
| `prompt --slug <s> [--session-id <id>]` | Deliver a stdin line to a `ready` session (foundation for scheduled prompts). `--session-id` guards against a killed-and-recreated `rc-<slug>`. |
| `kill --slug <s>` | Kill the session (idempotent). |

### Exit codes

The binary distinguishes domain failures it observes locally from the SSH transport
failures the orchestrator observes. Binary exit codes: `0` ok; `2` bad args/validation
(e.g. a `--prompt` for `claude-broker`); `3` duplicate slug (the orchestrator maps this
to `409 RC_SLUG_TAKEN`); `4` session not found (`probe`/`prompt`; `kill` stays
idempotent); `1` generic. SSH-layer outcomes (auth-denied → 401, unreachable → 502) and
a missing binary (`127` → a clear "not installed" message) are classified by the
orchestrator, not the binary.

### JSON output (the neutral DTO)

The binary runs *inside* the shed and therefore reports only what it can observe — it
does **not** know the orchestrator's host alias, shed name, or routing target. Each
field below is omitted (absent, not `null`) when unknown. Each tool adapts this DTO into
its own wire model (adding the target/host/shed it already knows).

```jsonc
{
  "slug": "abc234",
  "tmux_session": "rc-abc234",
  "kind": "claude-rc",            // claude-rc | claude-broker | shell
  "state": "ready",              // starting|ready|reconnecting|needs-trust|needs-auth|dead
  "managed": true,               // a valid SHED_RC_V (>= 2) was present
  "display_name": "my session",  // omitted if unstored (reader applies <target>/<slug>)
  "workdir": "/home/shed",
  "url": "https://claude.ai/code/session_…",
  "id": "uuid",                  // SHED_RC_ID
  "created_by": "shed-remote-agent/0.1.0",
  "created_at": "2026-06-19T18:53:00Z",
  "target_label": "shed:t1@host"
}
```

A golden fixture of this shape is committed to the consuming repos and asserted to
decode in each (the single guard against contract drift).

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
of this standard** and is not read by conformant tools.

There is no automatic migration. A pre-existing `SRA_*` (or `SHED_RC_V=1`) session
appears as legacy/unmanaged (still listable and killable). Kill and recreate it once
the tools you use have adopted the current convention (v2).

!!! warning "Mixed-fleet interop window"
    Until every tool you use adopts v2, tools at different versions will render each
    other's sessions as legacy/unmanaged (defaults only — the session is still
    attachable and killable). Adopt the convention across your tools, then recreate
    any sessions whose metadata you want fully restored.

## Conformance checklist

A conformant tool:

- [ ] Names sessions `rc-<slug>` with a valid slug.
- [ ] Writes all required v2 keys atomically at create (`SHED_RC_V=2`), single-line
      values only, with a `claude-rc`/`claude-broker`/`shell` kind.
- [ ] Generates a fresh `SHED_RC_ID` per session; sets `SHED_RC_CREATED_BY` and
      `SHED_RC_CREATED_AT`.
- [ ] Lists every `rc-*` session; reads `SHED_RC_*`; ignores unknown keys; never
      drops a higher-version session.
- [ ] Treats missing/malformed/pre-v2 `SHED_RC_V` (and unrecognized kinds) as legacy
      with the defaults above; performs no v1→v2 aliasing.
- [ ] Derives `state`/`url` from the pane; never stores them.
- [ ] Never rewrites another tool's metadata; never puts secrets in `SHED_RC_*`.
