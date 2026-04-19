import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Host } from '@shed-remote-agent/shared';
import { resolveLocalDir } from './appConfig.js';
import { getAppConfig } from './configStore.js';
import { AppError } from './errors.js';
import { shellQuote } from './shell.js';
import { classifySSHError, run } from './ssh.js';

export interface Workspace {
  name: string;
  path: string;
  is_git_repo: boolean;
}

export interface WorkspacesResult {
  root: string;
  user: string;
  workspaces: Workspace[];
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

export async function listWorkspaces(host: Host): Promise<WorkspacesResult> {
  const appCfg = await getAppConfig();
  const local = resolveLocalDir(appCfg, host.name);
  if (!local) {
    throw AppError.badRequest(
      `no local_dir configured for host '${host.name}' (set defaults.local_dir or hosts.${host.name}.local_dir)`,
    );
  }

  if (LOCAL_HOSTNAMES.has(host.host)) {
    return listLocal(local.path, local.user);
  }
  return listRemote(host.host, local.user, local.path);
}

async function listLocal(root: string, user: string): Promise<WorkspacesResult> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError('WORKSPACE_READ_FAILED', `failed to read ${root}: ${msg}`, 502);
  }

  const workspaces: Workspace[] = [];
  await Promise.all(
    entries.map(async (name) => {
      const full = path.join(root, name);
      try {
        const st = await stat(full);
        if (!st.isDirectory()) return;
        let isGit = false;
        try {
          const gitSt = await stat(path.join(full, '.git'));
          isGit = gitSt.isDirectory();
        } catch {
          // no .git — fine
        }
        workspaces.push({ name, path: full, is_git_repo: isGit });
      } catch {
        // skip entries we can't stat (permissions, broken symlinks)
      }
    }),
  );

  workspaces.sort((a, b) => a.name.localeCompare(b.name));
  return { root, user, workspaces };
}

async function listRemote(host: string, user: string, root: string): Promise<WorkspacesResult> {
  const target = { host, user, port: 22 };

  // One-shot: list top-level dirs and probe .git in a single remote command.
  // `set -e` + no `|| exit 0` so a missing/unreadable root surfaces as a
  // failure (matching listLocal's WORKSPACE_READ_FAILED behavior).
  const script = `set -e; cd ${shellQuote(root)}
ls -1 2>/dev/null | while read d; do [ -d "$d" ] && echo "$d"; done
echo '---GIT---'
for d in */; do [ -d "$d.git" ] && echo "\${d%/}"; done`;

  const result = await run(target, ['bash', '-lc', script], { timeoutMs: 10_000 });
  if (result.code !== 0) {
    // Use the exit code (not the stderr classifier) to decide transport vs
    // remote-command failure. ssh(1) uses 255 for any connection/protocol
    // error; `run()` uses our sentinel 124 for its timeout. Anything else is
    // the remote command's own exit status — so `cd ${root}` failing with a
    // filesystem "Permission denied" lands in WORKSPACE_READ_FAILED instead
    // of being misclassified as SSH auth-denied.
    const isTransportFailure = result.code === 124 || result.code === 255;
    if (isTransportFailure) {
      const cls = classifySSHError(result.stderr, result.code);
      throw new AppError('SSH_ERROR', `ssh ${cls}: ${result.stderr.trim() || 'no stderr'}`, 502);
    }
    throw new AppError(
      'WORKSPACE_READ_FAILED',
      `failed to read ${root}: ${result.stderr.trim() || 'no stderr'}`,
      502,
    );
  }

  const [namesPart = '', gitPart = ''] = result.stdout.split('---GIT---');
  const names = namesPart
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const gitSet = new Set(
    gitPart
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  );

  const workspaces = names
    .map<Workspace>((n) => ({
      name: n,
      path: `${root.replace(/\/$/, '')}/${n}`,
      is_git_repo: gitSet.has(n),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { root, user, workspaces };
}
