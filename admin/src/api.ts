/**
 * Client of the AMW administration API (<Server.path>/admin/api).
 */

export interface Status {
  stats: boolean;
  message?: string;
  retentionDays: number;
}

export interface DailyStats {
  date: string;
  cache: number;
  amazon: number;
  notfound: number;
  clicks: number;
}

export interface ProductStats {
  product: string;
  type: 'id' | 'keyword';
  value: string;
  title?: string;
  image?: string;
  url?: string;
  impressions: number;
  clicks: number;
  ctr: number;
}

// Views are the product impressions served to the page (a widget showing three
// products counts three), as identified by the cleaned Referer
export interface PageStats {
  url: string;
  impressions: number;
  clicks: number;
  ctr: number;
}

export interface NotFoundStats {
  product: string;
  type: 'id' | 'keyword';
  value: string;
  count: number;
  lastSeen: string | null;
  referers: { url: string; count: number }[];
}

export interface InsightRecommendation {
  title: string;
  detail: string;
}

// Summary and recommendations are model output derived from client-controlled
// data (page URLs): render them as text only, never as HTML or Markdown
export type Insights =
  | { available: false; reason: string }
  | {
      available: true;
      days: number;
      generatedAt: string;
      model: string;
      cached: boolean;
      summary: string;
      recommendations: InsightRecommendation[];
    };

export class UnauthorizedError extends Error {}

// sessionStorage: the token disappears with the tab and is not shared with other tabs
const TOKEN_KEY = 'amw-admin-token';

// Resolved against the page URL so that the portal works under any Server.path
function apiUrl(path: string): string {
  return new URL(`api/${path}`, window.location.href).toString();
}

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function logout(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

export async function login(password: string): Promise<void> {
  const response = await fetch(apiUrl('login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  if (response.status === 401) {
    throw new UnauthorizedError('Invalid password');
  }
  if (response.status === 429) {
    throw new Error('Too many attempts, try again later');
  }
  if (!response.ok) {
    throw new Error(`Login failed (HTTP ${response.status})`);
  }
  const { token } = await response.json();
  sessionStorage.setItem(TOKEN_KEY, token);
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path), {
    headers: { Authorization: `Bearer ${getToken() ?? ''}` }
  });
  if (response.status === 401) {
    logout();
    throw new UnauthorizedError('Session expired');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message || `Request failed (HTTP ${response.status})`);
  }
  return body as T;
}

export const getStatus = () => get<Status>('status');
export const getDaily = (days: number) => get<DailyStats[]>(`stats/daily?days=${days}`);
export const getProducts = (days: number, limit = 50) => get<ProductStats[]>(`stats/products?days=${days}&limit=${limit}`);
export const getPages = (days: number, limit = 20) => get<PageStats[]>(`stats/pages?days=${days}&limit=${limit}`);
export const getNotFound = (limit = 100) => get<NotFoundStats[]>(`stats/notfound?limit=${limit}`);
// Slow (10 to 60 s, an AI model analyses the statistics): only called on demand.
// refresh=true bypasses the server cache.
export const getInsights = (days: number, refresh = false) =>
  get<Insights>(`insights?days=${days}${refresh ? '&refresh=true' : ''}`);

/**
 * Product data comes from Amazon and referers from third-party pages: only
 * http(s) URLs are rendered as links or images.
 */
export function safeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}
