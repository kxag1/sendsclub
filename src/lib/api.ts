let authToken: string | null = null;

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');

export function resolveApiUrl(path: string): string {
  if (!API_BASE_URL || /^https?:\/\//i.test(path)) {
    return path;
  }
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export function resolveMediaUrl(src: string): string {
  if (!src || /^https?:\/\//i.test(src) || src.startsWith('data:')) {
    return src;
  }
  if (src.startsWith('/uploads/') || src.startsWith('/api/')) {
    return resolveApiUrl(src);
  }
  return src;
}

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const targetUrl = resolveApiUrl(url);
  const headers = new Headers(options.headers || {});
  if (!headers.has('X-Requested-With')) {
    headers.set('X-Requested-With', 'SendsClub');
  }
  if (authToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(targetUrl, {
    ...options,
    headers,
    credentials: 'include',
  });

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const textPreview = await res.text().catch(() => '');
    const isHtml = /^\s*<!doctype|^\s*<html/i.test(textPreview);
    throw new ApiError(
      isHtml
        ? `API route ${url} returned HTML instead of JSON. Ensure the SendsClub Node server (server.ts) is running and handling /api/* requests.`
        : `Unexpected non-JSON response (${res.status}) from ${url}.`,
      res.status
    );
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  }
  if (data === null || typeof data !== 'object') {
    throw new ApiError('Invalid JSON response from server.', res.status);
  }
  return data as T;
}

export async function uploadImages(files: File[]): Promise<string[]> {
  const formData = new FormData();
  for (const file of files) {
    formData.append('images', file);
  }
  const data = await apiFetch<{ urls: string[] }>('/api/upload', {
    method: 'POST',
    body: formData,
  });
  return Array.isArray(data.urls) ? data.urls : [];
}
