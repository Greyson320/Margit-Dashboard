const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

const ACCESS_KEY = 'gp.access_token';
const REFRESH_KEY = 'gp.refresh_token';

export const tokens = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  formData?: FormData;
  signal?: AbortSignal;
  /** Set for the refresh call itself, so a 401 does not loop. */
  skipRefresh?: boolean;
};

let refreshing: Promise<boolean> | null = null;

/** Exchanges the refresh token once, even when several calls 401 at the same time. */
async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const refresh = tokens.refresh;
      if (!refresh) return false;
      const response = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!response.ok) {
        tokens.clear();
        return false;
      }
      const data = (await response.json()) as { access_token: string; refresh_token: string };
      tokens.set(data.access_token, data.refresh_token);
      return true;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function parse(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('application/json')) return response.json();
  return response.text();
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = {};
    const access = tokens.access;
    if (access) headers.Authorization = `Bearer ${access}`;
    if (!options.formData && options.body !== undefined) headers['Content-Type'] = 'application/json';

    return fetch(`${BASE}${path}`, {
      method: options.method ?? (options.body || options.formData ? 'POST' : 'GET'),
      headers,
      body: options.formData ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
      signal: options.signal,
    });
  };

  let response = await send();

  if (response.status === 401 && !options.skipRefresh && tokens.refresh) {
    const ok = await refreshSession();
    if (ok) response = await send();
  }

  const payload = await parse(response);

  if (!response.ok) {
    const body = payload as { error?: string; details?: unknown } | string | null;
    const message = typeof body === 'object' && body?.error ? body.error : `Request failed (${response.status})`;
    throw new ApiError(response.status, message, typeof body === 'object' ? body?.details : undefined);
  }

  return payload as T;
}

/** Opens an authenticated download (CSV/PDF/file) in a new tab via a blob URL. */
export async function download(path: string, filename: string): Promise<void> {
  const access = tokens.access;
  const response = await fetch(`${BASE}${path}`, {
    headers: access ? { Authorization: `Bearer ${access}` } : {},
  });
  if (!response.ok) throw new ApiError(response.status, 'Download failed');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { method: 'GET', signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: body ?? {} }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) => request<T>(path, { method: 'POST', formData }),
};

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
