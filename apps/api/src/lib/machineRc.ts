import type { RcSession, RcSessionDto } from '@shed-remote-agent/shared';
import { AppError } from './errors.js';
import { toRcSession } from './rc.js';
import {
  type RcBin,
  type RcBinClient,
  type RcCreateArgs,
  type Runner,
  rcCreate,
  rcKill,
  rcList,
} from './rcBinClient.js';
import { type CommandTarget, run } from './ssh.js';

/**
 * Resolve the host binary to invoke on a machine. Precedence: the machine's `rc_bin`
 * (an absolute path, for SSH machines whose non-login PATH doesn't include it), then
 * the SHED_MACHINE_RC_BIN dev/proof override, then `shed-machine-rc` on PATH.
 * shed-machine-rc is the host-side sibling of the shed image's shed-ext-rc.
 */
function machineRcBin(rcBin?: string): string {
  return rcBin || process.env.SHED_MACHINE_RC_BIN || 'shed-machine-rc';
}

function machineRcBinSpec(rcBin?: string): RcBin {
  const bin = machineRcBin(rcBin);
  return {
    bin,
    // On an SSH machine "not found" is most often a non-login PATH gap (or a bad
    // rc_bin), not a real absence — name the fix.
    missing: () =>
      new AppError(
        'MACHINE_RC_MISSING',
        `${bin} could not be run on the machine (not found or not executable) — install it ` +
          `(\`brew install charliek/tap/shed-machine-rc\` or \`apt install shed-machine-rc\`). If it is ` +
          `installed but not on the machine's non-login SSH PATH (e.g. Apple-Silicon Homebrew under ` +
          `/opt/homebrew/bin), set \`rc_bin\` to its absolute path in the machine config.`,
        502,
      ),
  };
}

/** Adapt a binary DTO to the wire RcSession for this machine: apply the
 *  `<machine>/<slug>` display fallback the binary can't know (it doesn't see the
 *  orchestrator's machine name), then wrap with the machine target + workdir default. */
function adaptMachineDto(dto: RcSessionDto, machine: string, defaultWorkdir: string): RcSession {
  return toRcSession(
    { ...dto, display_name: dto.display_name ?? `${machine}/${dto.slug}` },
    { target: { kind: 'machine', machine_name: machine }, defaultWorkdir },
  );
}

function machineClient(machine: string, defaultWorkdir: string, rcBin?: string): RcBinClient {
  return {
    ...machineRcBinSpec(rcBin),
    adapt: (dto) => adaptMachineDto(dto, machine, defaultWorkdir),
  };
}

export interface MachineCreateOptions extends RcCreateArgs {
  /** Machine name — the {@link RcTarget} identifier and `<machine>/<slug>` fallback. */
  machine: string;
  /** Per-machine binary override (absolute path) for the non-login PATH case. */
  rcBin?: string;
  /** Wire fallback for a legacy/unmanaged session with no SHED_RC_WORKDIR. */
  defaultWorkdir: string;
}

/** Create a session by invoking `shed-machine-rc create --wait` on the machine,
 *  adapting its DTO to a machine-targeted RcSession. */
export async function machineRcCreate(
  opts: MachineCreateOptions,
  runner: Runner = run,
): Promise<RcSession> {
  return rcCreate(machineClient(opts.machine, opts.defaultWorkdir, opts.rcBin), opts, runner);
}

export interface MachineListOptions {
  target: CommandTarget;
  machine: string;
  rcBin?: string;
  defaultWorkdir: string;
}

/** List a machine's RC sessions via `shed-machine-rc list`, adapting each DTO. */
export async function machineRcList(
  opts: MachineListOptions,
  runner: Runner = run,
): Promise<RcSession[]> {
  return rcList(machineClient(opts.machine, opts.defaultWorkdir, opts.rcBin), opts.target, runner);
}

/** Kill a machine RC session via `shed-machine-rc kill` (idempotent). */
export async function machineRcKill(
  opts: { target: CommandTarget; slug: string; rcBin?: string },
  runner: Runner = run,
): Promise<void> {
  return rcKill(machineRcBinSpec(opts.rcBin), opts.target, opts.slug, runner);
}
