import { ttlMemoize } from './cache.js';
import { AppError } from './errors.js';

export interface Repo {
  nameWithOwner: string;
  description?: string;
  updatedAt: string;
  isPrivate: boolean;
}

const memoizedForOwner = ttlMemoize<string, Repo[]>(60_000);

export async function listReposForOwner(owner: string): Promise<Repo[]> {
  return memoizedForOwner(owner, async () => {
    const proc = Bun.spawn(
      [
        'gh',
        'repo',
        'list',
        owner,
        '--limit',
        '200',
        '--json',
        'nameWithOwner,description,updatedAt,isPrivate',
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );

    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (code !== 0) {
      const s = stderr.toLowerCase();
      if (s.includes('authentication required') || s.includes('not logged in')) {
        throw new AppError(
          'GH_NOT_AUTHENTICATED',
          'gh CLI is not authenticated — run `gh auth login`',
          400,
        );
      }
      if (s.includes('command not found') || s.includes('no such file')) {
        throw new AppError('GH_NOT_INSTALLED', 'gh CLI is not installed on the backend host', 500);
      }
      throw new AppError('GH_ERROR', stderr.trim() || `gh exited ${code}`, 500);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new AppError('GH_PARSE', 'failed to parse gh output', 500);
    }
    if (!Array.isArray(parsed)) throw new AppError('GH_PARSE', 'unexpected gh output', 500);
    return parsed as Repo[];
  });
}

export async function listReposForOwners(owners: string[]): Promise<Repo[]> {
  const results = await Promise.all(owners.map((o) => listReposForOwner(o)));
  const seen = new Set<string>();
  const out: Repo[] = [];
  for (const list of results) {
    for (const r of list) {
      if (!seen.has(r.nameWithOwner)) {
        seen.add(r.nameWithOwner);
        out.push(r);
      }
    }
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}
