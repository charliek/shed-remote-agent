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

export async function listWorkspaces(host: Host): Promise<WorkspacesResult> {
  const appCfg = await getAppConfig();
  const local = resolveLocalDir(appCfg, host.name);
  if (!local) {
    throw AppError.badRequest(
      `no local_dir configured for host '${host.name}' (set defaults.local_dir or hosts.${host.name}.local_dir)`,
    );
  }

  const target = { host: host.host, user: local.user, port: 22 };

  // One-shot: list top-level dirs and probe .git in a single remote command.
  const script = `set -e; cd ${shellQuote(local.path)} 2>/dev/null || exit 0
ls -1 2>/dev/null | while read d; do [ -d "$d" ] && echo "$d"; done
echo '---GIT---'
for d in */; do [ -d "$d.git" ] && echo "\${d%/}"; done`;

  const result = await run(target, ['bash', '-lc', script], { timeoutMs: 10_000 });
  if (result.code !== 0) {
    const cls = classifySSHError(result.stderr, result.code);
    throw new AppError('SSH_ERROR', `ssh ${cls}: ${result.stderr.trim() || 'no stderr'}`, 502);
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
      path: `${local.path.replace(/\/$/, '')}/${n}`,
      is_git_repo: gitSet.has(n),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { root: local.path, user: local.user, workspaces };
}
