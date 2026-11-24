let authToken: string | null = null;

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

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const textPreview = await res.text().catch(() => '');
    throw new ApiError(
      res.ok
        ? 'Unexpected non-JSON response from server.'
        : `Request failed (${res.status})${textPreview ? '' : ''}`,
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
