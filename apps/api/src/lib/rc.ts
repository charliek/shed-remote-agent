import type { RcKindValue, RcSession, RcState, RcTarget } from '@shed-remote-agent/shared';
import apiPkg from '../../package.json';

// RC Session Convention v2 helpers shared by the shed and machine paths. Creating,
// listing, classifying, and tearing down RC sessions now lives in the guest/host
// binaries (shed-ext-rc / shed-machine-rc), invoked via shedRc.ts / machineRc.ts;
// this module keeps only the cross-cutting wire helpers those two share.

export const RC_PREFIX = 'rc-';
// DEFAULT_WORKDIR is the fallback when a shed session's SHED_RC_WORKDIR is unset
// (a legacy/unmanaged session). For sheds, shed-ext-rc resolves $SHED_WORKSPACE.
export const DEFAULT_WORKDIR = '/workspace';

/** Stable tool identifier for SHED_RC_CREATED_BY. MUST NOT contain '/'. */
const RC_TOOL_NAME = 'shed-remote-agent';
/** `<tool>/<version>` provenance string. The version is read from this package's
 * own version field — NOT package.json `name`, which is "api". */
export const RC_CREATED_BY = `${RC_TOOL_NAME}/${apiPkg.version}`;

// Alphabet chosen to avoid visually-confusable characters so short slugs survive a
// human reading a QR or typed URL.
export function genSlug(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i += 1) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}

/**
 * The neutral, target-agnostic RC session shape the guest/host binaries print on
 * stdout (RC Session Convention v2). The binary runs on the shed/machine, so it
 * reports only what it observes; each caller wraps it with an {@link RcTarget} and a
 * workdir default via {@link toRcSession}.
 */
export interface RawRcSession {
  slug: string;
  tmux_session: string;
  display_name: string;
  /** The workdir captured at bootstrap (SHED_RC_WORKDIR). Undefined for
   * legacy/unmanaged sessions; callers fall back to their target default. */
  workdir?: string;
  // Preserve-raw: an unknown kind from a newer binary is kept verbatim (never
  // aliased) and rendered neutrally by consumers.
  kind: RcKindValue;
  state: RcState;
  url?: string;
  /** Stable session id (SHED_RC_ID). Undefined for legacy/unmanaged sessions. */
  id?: string;
  created_by?: string;
  created_at?: string;
  /** Advisory target label (SHED_RC_TARGET); non-authoritative. */
  target_label?: string;
  /** True when SHED_RC_V is present (created under the convention). */
  managed: boolean;
}

/**
 * Project the target-agnostic {@link RawRcSession} onto the wire {@link RcSession}.
 * This is the single place the metadata field set crosses to the wire, so a new
 * SHED_RC_* field added to RawRcSession reaches every route (list and create, shed
 * and machine) without editing each mapper.
 */
export function toRcSession(
  raw: RawRcSession,
  opts: { target: RcTarget; defaultWorkdir: string },
): RcSession {
  return {
    ...raw,
    // Legacy/unmanaged sessions don't carry a workdir; fall back to the caller's
    // target-specific default.
    workdir: raw.workdir ?? opts.defaultWorkdir,
    target: opts.target,
  };
}
