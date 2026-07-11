import type { RcSession, RcSessionDto } from '@shed-remote-agent/shared';
import { AppError } from './errors.js';
import { DEFAULT_WORKDIR, toRcSession } from './rc.js';
import {
  type RcBin,
  type RcBinClient,
  type RcCreateArgs,
  type RcListResult,
  type Runner,
  rcCreate,
  rcKill,
  rcList,
} from './rcBinClient.js';
import { type CommandTarget, run } from './ssh.js';

/**
 * Name (or path) of the guest binary. Defaults to `shed-ext-rc` (on PATH in the shed
 * `full` image). Overridable via SHED_EXT_RC_BIN for dev/proof, where the binary is
 * scp'd to e.g. /tmp/shed-ext-rc before it's baked into the image.
 */
function rcBin(): string {
  return process.env.SHED_EXT_RC_BIN || 'shed-ext-rc';
}

function shedRcBin(): RcBin {
  return {
    bin: rcBin(),
    missing: () =>
      new AppError(
        'SHED_EXT_RC_MISSING',
        'shed-ext-rc is not installed on this shed — update the shed image',
        502,
      ),
  };
}

/** A shed client: the guest binary plus a DTO→wire adapter applying the `<shed>/<slug>`
 *  display fallback (the in-shed binary doesn't know the shed alias) and the shed target. */
function shedClient(host: string, shed: string): RcBinClient {
  return {
    ...shedRcBin(),
    adapt: (dto: RcSessionDto): RcSession =>
      toRcSession(
        { ...dto, display_name: dto.display_name ?? `${shed}/${dto.slug}` },
        { target: { kind: 'shed', shed_name: shed, host }, defaultWorkdir: DEFAULT_WORKDIR },
      ),
  };
}

export interface ShedCreateOptions extends RcCreateArgs {
  host: string;
  shed: string;
}

/** Create a session by invoking `shed-ext-rc create --wait` over SSH, adapting its
 *  DTO to a shed-targeted RcSession. */
export async function shedRcCreate(
  opts: ShedCreateOptions,
  runner: Runner = run,
): Promise<RcSession> {
  return rcCreate(shedClient(opts.host, opts.shed), opts, runner);
}

/** List a shed's RC sessions via `shed-ext-rc list`, adapting each DTO and passing
 *  the embedded capabilities block through. */
export async function shedRcList(
  opts: { target: CommandTarget; host: string; shed: string },
  runner: Runner = run,
): Promise<RcListResult> {
  return rcList(shedClient(opts.host, opts.shed), opts.target, runner);
}

/** Kill a shed RC session via `shed-ext-rc kill` (idempotent). */
export async function shedRcKill(
  opts: { target: CommandTarget; slug: string },
  runner: Runner = run,
): Promise<void> {
  return rcKill(shedRcBin(), opts.target, opts.slug, runner);
}
