import { User } from './types';

const TOKEN_KEY = 'multischool_auth_token';

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string) {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(TOKEN_KEY, token);
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch (e) {}
}

export function clearStoredToken() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
}

export async function apiRequest<T = any>(endpoint: string, options: RequestInit = {}, retries = 2): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      ...options,
      headers
    });
  } catch (err: any) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 400));
      return apiRequest<T>(endpoint, options, retries - 1);
    }
    throw err;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      clearStoredToken();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('multischool_auth_unauthorized', { detail: data.error }));
      }
    }
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }

  return data as T;
}
