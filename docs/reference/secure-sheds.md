# Secure sheds (TLS + auth)

Modern shed servers (shed `v0.7+`) run in **secure mode**: the HTTP API is served
over HTTPS on a separate port with a self-signed certificate, and every request
must carry a short-lived bearer **control token**. shed-remote-agent speaks this
protocol transparently while still supporting legacy plain-HTTP servers in the
same config.

There is **no new configuration** in shed-remote-agent — everything is driven by
the fields the `shed` CLI already writes to `~/.shed/config.yaml`.

## Config shape

A secure server entry carries four extra fields:

```yaml
servers:
  mini2:
    host: mini2
    http_port: 8080
    ssh_port: 2222
    api_url: https://mini2:8443                 # HTTPS endpoint (must be https)
    control_token: shed_control_…               # bearer token (seed)
    control_token_expires_at: 2026-06-17T…      # token expiry
    tls_cert_fingerprint: sha256:af76…          # pinned self-signed leaf cert
  legacy-box:
    host: 10.0.0.5
    http_port: 8080                             # no api_url ⇒ plain HTTP, no token
    ssh_port: 2222
```

A server is treated as **secure** when it has an `api_url`. The config loader is
fail-closed: an `api_url` must be `https://` and requires both a `control_token`
and a `tls_cert_fingerprint` (`sha256:<64 lowercase hex>`); a token or pin without
a https `api_url` is rejected so credentials can never be sent in the clear.

Secret material (`control_token`, `tls_cert_fingerprint`, `api_url`) lives only in
a server-side `ServerTarget` and **never** crosses to the browser — the wire
`Host` object exposes only a `secure: boolean` flag (rendered as a shield badge).

## Transport: pinned TLS + bearer

Bun's `fetch`/`https`/`http` cannot pin a self-signed certificate (the
`checkServerIdentity` hook never fires, a leaf passed as `ca` fails chain
validation, and `rejectUnauthorized: false` silently trusts *any* cert). So the
backend speaks HTTP/1.1 itself over a raw `node:tls` socket
(`apps/api/src/lib/secureTransport.ts`):

- the leaf certificate's `sha256(DER)` fingerprint is verified against the pin
  **before any request byte — including the bearer token — is written**
  (fail-closed: a mismatch destroys the socket, nothing is sent);
- one request per socket (`Connection: close`), HTTP/1.1 only (ALPN), and
  `Accept-Encoding: identity` (no compression to mis-decode);
- the response parser rejects every framing ambiguity (TE+CL, duplicate or
  non-numeric `Content-Length`, compressed bodies, oversized header/chunk lines)
  and bounds memory;
- connect / header / idle timeouts and socket teardown on cancel/error keep raw
  sockets from leaking.

Legacy plain-HTTP servers keep using `fetch` unchanged — no `Authorization`
header, no TLS code path.

## Token lifecycle

The control token expires (~24h), so the orchestrator keeps itself authenticated
with a per-host `ControlTokenProvider` (`apps/api/src/lib/controlToken.ts`):

- **Seed** from the config `control_token` until the first mint.
- **Mint / refresh** over SSH: `ssh _bootstrap@<host> control` returns a fresh
  token bundle (the same reserved-user mechanism the `shed` CLI uses). The minted
  cert fingerprint must equal the configured pin — it is never silently re-pinned.
- **Proactive** refresh within 2h of expiry (+5m skew, per-host jitter), keeping a
  still-valid token if the refresh mint fails.
- **Reactive** on a `401`: invalidate and retry once with a freshly minted token,
  ignoring a stale `401` for a token already rotated past.
- **Single-flight** mint with a **60s cooldown** after a failure, so a polling UI
  can't storm an unreachable host.

Tokens are held **in memory only** — shed-remote-agent never writes
`~/.shed/config.yaml`, so it can't race the `shed` CLI. A token refreshed on disk
by the CLI is still picked up within the config's 5s memo TTL.

## SSH paths are unaffected

Secure mode gates the **HTTP API** only. Remote-control bootstrap, terminal
attach, and workspace listing reach the shed over direct SSH
(`ssh <shed-name>@host`), which secure mode does not change — those routes need
no token and continue to work against secure hosts.

## Error states

| Code | Meaning |
| --- | --- |
| `SHED_TLS_PIN_MISMATCH` | the server's cert didn't match the configured pin (possible MITM) |
| `SHED_TLS_PIN_MISSING` | a secure server has no `tls_cert_fingerprint` configured |
| `SHED_AUTH_EXPIRED` | the control token is missing/expired and could not be re-minted |

These messages are deliberately generic — they never echo the token or the
fingerprints, and secret-bearing log fields are redacted as defense-in-depth.
</content>
