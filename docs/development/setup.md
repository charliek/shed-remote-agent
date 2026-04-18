# Development Setup

## Clone and install

```bash
git clone https://github.com/charliek/shed-remote-agent.git
cd shed-remote-agent
bun install
```

## Monorepo layout

```
apps/
  api/           Hono + pino API on Bun
  web/           React + Vite + Tailwind
packages/
  shared/        Zod schemas + inferred types
config.example.yaml
pyproject.toml   Docs tooling (mkdocs + uv dep group)
mkdocs.yml
```

## Scripts

| Command | Purpose |
|---------|---------|
| `bun run dev` | Run API (`:8787`) + web (`:5173`) together with watch mode |
| `bun run dev:api` | API only |
| `bun run dev:web` | Web only |
| `bun run build` | Production build for both workspaces |
| `bun run test` | All tests (currently `bun:test` in `apps/api`) |
| `bun run lint` | Biome check across `apps/**` + `packages/**` |
| `bun run lint:fix` | Biome auto-fix |
| `bun run format` | Biome format |

## Env files

Each app has a `.env.example` documenting the knobs:

- `apps/api/.env.example` — `PORT`, `HOST`, `NODE_ENV`, `LOG_LEVEL`, `CORS_ORIGINS`, `SHED_CONFIG_PATH`, `APP_CONFIG_PATH`
- `apps/web/.env.example` — `VITE_API_URL` (defaults to `/api`)

Copy `config.example.yaml` to `~/.config/shed-remote-agent/config.yaml` as described in [Configuration](../getting-started/configuration.md).

## Code style

- **Biome** (`biome.json`) — lint + format. Single quotes, trailing commas, semicolons, 100-char lines.
- **TypeScript strict** everywhere; `apps/web` additionally has `noUnusedLocals` / `noUnusedParameters`.
- Tailwind utilities sorted by Biome's `useSortedClasses` (nursery) rule.

## Pre-commit

No hooks are installed by default. If you want them, add `bun x lint-staged` to a local `.git/hooks/pre-commit` or use husky.

## Docs tooling

The docs use `mkdocs-material`, installed into a `uv`-managed virtualenv:

```bash
make docs         # build into site-build/
make docs-serve   # serve on http://127.0.0.1:7070
```

Docs deploy to GitHub Pages on every push to `main` that touches `docs/**`, `mkdocs.yml`, `pyproject.toml`, or `.github/workflows/docs.yml` — see `.github/workflows/docs.yml`.
