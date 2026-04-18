import type {
  CreateRcRequest,
  HostsResponse,
  ImagesResponse,
  RcSession,
  RcSessionsResponse,
  ReposResponse,
  SessionsResponse,
  ShedsResponse,
  ShedWithHost,
  WorkspacesResponse,
} from '@shed-remote-agent/shared';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export class APIError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'APIError';
  }
}

async function fetchAPI<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const err = data?.error || {};
    throw new APIError(
      err.code || 'UNKNOWN_ERROR',
      err.message || 'An error occurred',
      response.status,
      err.details,
    );
  }

  return data as T;
}

export const api = {
  listHosts: () => fetchAPI<HostsResponse>('/hosts'),

  listSheds: () => fetchAPI<ShedsResponse>('/sheds'),

  getShed: (host: string, name: string) =>
    fetchAPI<ShedWithHost>(`/sheds/${encodeURIComponent(host)}/${encodeURIComponent(name)}`),

  startShed: (host: string, name: string) =>
    fetchAPI<ShedWithHost>(`/sheds/${encodeURIComponent(host)}/${encodeURIComponent(name)}/start`, {
      method: 'POST',
    }),

  stopShed: (host: string, name: string) =>
    fetchAPI<ShedWithHost>(`/sheds/${encodeURIComponent(host)}/${encodeURIComponent(name)}/stop`, {
      method: 'POST',
    }),

  deleteShed: (host: string, name: string) =>
    fetchAPI<void>(`/sheds/${encodeURIComponent(host)}/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),

  listSessions: (host: string, name: string) =>
    fetchAPI<SessionsResponse>(
      `/sheds/${encodeURIComponent(host)}/${encodeURIComponent(name)}/sessions`,
    ),

  killSession: (host: string, name: string, session: string) =>
    fetchAPI<void>(
      `/sheds/${encodeURIComponent(host)}/${encodeURIComponent(name)}/sessions/${encodeURIComponent(session)}`,
      { method: 'DELETE' },
    ),

  listImages: (host: string) =>
    fetchAPI<ImagesResponse>(`/hosts/${encodeURIComponent(host)}/images`),

  listWorkspaces: (host: string) =>
    fetchAPI<WorkspacesResponse>(`/hosts/${encodeURIComponent(host)}/workspaces`),

  listRepos: () => fetchAPI<ReposResponse & { owners: string[] }>('/repos'),

  listRcSessions: (host: string, name: string) =>
    fetchAPI<RcSessionsResponse>(
      `/sheds/${encodeURIComponent(host)}/${encodeURIComponent(name)}/rc`,
    ),

  createRcSession: (host: string, name: string, body: CreateRcRequest = {}) =>
    fetchAPI<RcSession>(`/sheds/${encodeURIComponent(host)}/${encodeURIComponent(name)}/rc`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  killRcSession: (host: string, name: string, slug: string) =>
    fetchAPI<void>(
      `/sheds/${encodeURIComponent(host)}/${encodeURIComponent(name)}/rc/${encodeURIComponent(slug)}`,
      { method: 'DELETE' },
    ),
};
