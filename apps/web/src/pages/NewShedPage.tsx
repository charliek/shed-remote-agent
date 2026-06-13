import {
  type CreateShedRequest,
  DEFAULT_RC_KIND,
  type ProgressEvent,
  type RcKind,
} from '@shed-remote-agent/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Loader2, Terminal, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LocalDirPicker } from '@/components/LocalDirPicker';
import { RcKindPicker } from '@/components/RcKindPicker';
import { RepoPicker } from '@/components/RepoPicker';
import { Button, Card, PageShell } from '@/components/ui';
import { api } from '@/lib/api';
import { streamCreateShed } from '@/lib/sse';

type SourceKind = 'none' | 'repo' | 'local-dir';

type ProgressLine = ProgressEvent & { id: number };

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export default function NewShedPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const hosts = useQuery({ queryKey: ['hosts'], queryFn: () => api.listHosts() });
  const [host, setHost] = useState<string>('');
  const effectiveHost = host || hosts.data?.hosts[0]?.name || '';
  const images = useQuery({
    queryKey: ['images', effectiveHost],
    queryFn: () => api.listImages(effectiveHost),
    enabled: Boolean(effectiveHost),
  });

  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [source, setSource] = useState<SourceKind>('none');
  const [repo, setRepo] = useState('');
  const [localDir, setLocalDir] = useState('');

  const [startRc, setStartRc] = useState(true);
  const [rcDisplayName, setRcDisplayName] = useState('');
  const [rcKind, setRcKind] = useState<RcKind>(DEFAULT_RC_KIND);

  const [progress, setProgress] = useState<ProgressLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  const disabled = useMemo(() => {
    if (submitting) return true;
    if (!effectiveHost || !name.trim()) return true;
    if (source === 'repo' && !repo) return true;
    if (source === 'local-dir' && !localDir) return true;
    return false;
  }, [effectiveHost, name, source, repo, localDir, submitting]);

  async function onSubmit() {
    if (disabled) return;
    setSubmitting(true);
    setError(null);
    setProgress([]);
    setCompleted(false);

    const body: CreateShedRequest = {
      name: name.trim(),
      image: image || undefined,
      repo: source === 'repo' ? repo : undefined,
      local_dir: source === 'local-dir' ? localDir : undefined,
    };

    try {
      let idx = 0;
      for await (const ev of streamCreateShed(
        `${API_BASE_URL}/sheds/${encodeURIComponent(effectiveHost)}`,
        body,
      )) {
        if (ev.type === 'progress') {
          idx += 1;
          setProgress((prev) => [...prev, { ...ev.data, id: idx }]);
        } else if (ev.type === 'complete') {
          setCompleted(true);
          qc.invalidateQueries({ queryKey: ['sheds'] });
          const shedName = ev.data.name;
          if (startRc) {
            try {
              const trimmed = rcDisplayName.trim();
              await api.createRcSession(effectiveHost, shedName, {
                kind: rcKind,
                ...(trimmed ? { display_name: trimmed } : {}),
              });
            } catch (rcErr) {
              // Shed is up; rc bootstrap failed. Keep the user on this page so
              // they see the error, and leave a link to the detail page.
              setError(
                `Shed created, but remote-control bootstrap failed: ${rcErr instanceof Error ? rcErr.message : String(rcErr)}. Open the shed to retry.`,
              );
              return;
            }
          }
          navigate(`/sheds/${encodeURIComponent(effectiveHost)}/${encodeURIComponent(shedName)}`);
          return;
        } else {
          setError(`${ev.data.error.code}: ${ev.data.error.message}`);
          return;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell
      title={
        <div className="flex items-center gap-3">
          <Link to="/" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <span>New shed</span>
        </div>
      }
    >
      <Card className="space-y-4 p-4">
        {hosts.data && hosts.data.hosts.length > 1 && (
          <Field label="Host">
            <select
              className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
              value={effectiveHost}
              onChange={(e) => setHost(e.target.value)}
            >
              {hosts.data.hosts.map((h) => (
                <option key={h.name} value={h.name}>
                  {h.name} ({h.host})
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Name" hint="lowercase letters, digits, hyphens">
          <input
            type="text"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-shed"
            className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </Field>

        <Field label="Image">
          <select
            className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
            value={image}
            onChange={(e) => setImage(e.target.value)}
          >
            <option value="">(server default)</option>
            {images.data?.images.map((i) => (
              <option key={i.name} value={i.name}>
                {i.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Source">
          <div className="flex gap-1 rounded-xl border border-border bg-secondary p-1">
            {(['none', 'repo', 'local-dir'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setSource(k)}
                className={`flex-1 rounded-lg px-3 py-1.5 font-semibold text-sm transition-all ${
                  source === k
                    ? 'bg-primary text-primary-foreground shadow-[0_2px_8px_hsl(var(--primary)/0.3)]'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </Field>

        {source === 'repo' && <RepoPicker value={repo} onChange={setRepo} />}
        {source === 'local-dir' && effectiveHost && (
          <LocalDirPicker
            source={{ kind: 'host', host: effectiveHost }}
            value={localDir}
            onChange={setLocalDir}
          />
        )}

        <div className="space-y-3 rounded-md border border-border p-3">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={startRc}
              onChange={(e) => setStartRc(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <div className="flex-1 text-sm">
              <div className="font-medium">Start a session on create</div>
              <div className="text-muted-foreground text-xs">
                Bootstraps the chosen kind in /workspace as soon as the shed is up.
              </div>
            </div>
          </label>
          {startRc && (
            <>
              <Field label="Kind" hint="what the tmux session runs">
                <RcKindPicker value={rcKind} onChange={setRcKind} />
              </Field>
              <Field
                label="Display name"
                hint={
                  rcKind === 'shell'
                    ? 'label for this session; the bash shell ignores it'
                    : 'shown in the Claude session UI; defaults to shed/slug'
                }
              >
                <input
                  type="text"
                  value={rcDisplayName}
                  onChange={(e) => setRcDisplayName(e.target.value)}
                  placeholder={`${name.trim() || 'shed-name'}/<slug>`}
                  maxLength={100}
                  className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </Field>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button disabled={disabled} onClick={onSubmit}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Create shed
          </Button>
        </div>
      </Card>

      {(submitting || progress.length > 0 || error || completed) && (
        <Card className="mt-4 p-4">
          <div className="mb-2 flex items-center gap-2 font-medium text-sm">
            <Terminal className="h-4 w-4" />
            Progress
          </div>
          <ol className="space-y-1 text-sm">
            {progress.map((p) => (
              <li key={p.id} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sage" />
                <div>
                  <span className="font-mono text-muted-foreground text-xs">{p.phase}</span>{' '}
                  <span>{p.message}</span>
                </div>
              </li>
            ))}
            {submitting && !completed && !error && (
              <li className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                working…
              </li>
            )}
            {error && (
              <li className="flex items-start gap-2 text-destructive">
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </li>
            )}
            {completed && (
              <li className="flex items-center gap-2 text-sage">
                <CheckCircle2 className="h-3.5 w-3.5" />
                done
              </li>
            )}
          </ol>
        </Card>
      )}
    </PageShell>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-sm">{label}</span>
        {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
