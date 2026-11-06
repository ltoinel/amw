/**
 * Client of the AMW administration API (<Server.path>/admin/api).
 */

export interface Status {
  stats: boolean;
  message?: string;
  retentionDays: number;
  version?: { release: string; revision: string | null; buildDate: string | null };
}

export interface DailyStats {
  date: string;
  cache: number;
  amazon: number;
  notfound: number;
  views: number;
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

export interface DomainStats {
  domain: string;
  impressions: number;
  clicks: number;
  ctr: number;
}

export interface DomainTrend extends DomainStats {
  // ctr is null on days without views
  daily: { date: string; impressions: number; clicks: number; ctr: number | null }[];
}

export interface NotFoundStats {
  product: string;
  type: 'id' | 'keyword';
  value: string;
  count: number;
  // Start of the absence; null for entries recorded by older versions
  firstSeen: string | null;
  lastSeen: string | null;
  // Amazon page of the product, when the server knows the marketplace
  url?: string;
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
  // The period was never analysed
  | { available: true; days: number; missing: true }
  | {
      missing?: undefined;
      available: true;
      days: number;
      generatedAt: string;
      model: string;
      cached: boolean;
      summary: string;
      recommendations: InsightRecommendation[];
    };

// Secrets only say whether they are set: the server never sends their value
export type SettingEntry =
  | { key: string; secret: true; configured: boolean }
  | { key: string; secret?: false; value: string | number | boolean | string[] | null };

export interface SettingsSection {
  title: string;
  entries: SettingEntry[];
}

export interface AmazonCheckResult {
  ok: boolean;
  marketplace: string;
  partnerTag: string;
  checkedAt: string;
  durationMs: number;
  // The previous result: repeated clicks do not call Amazon again
  cached: boolean;
  message: string;
  product?: { title: string; url: string };
}

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

async function request<T>(path: string, method: 'GET' | 'POST' = 'GET'): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method,
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

export const getStatus = () => request<Status>('status');
// Uses one call of the Amazon quota: only on demand
export const testAmazon = () => request<AmazonCheckResult>('amazon/test', 'POST');
export const getSettings = () => request<SettingsSection[]>('settings');
export const getDaily = (days: number) => request<DailyStats[]>(`stats/daily?days=${days}`);
export const getProducts = (days: number, limit = 50) => request<ProductStats[]>(`stats/products?days=${days}&limit=${limit}`);
export type PageSort = 'clicks' | 'impressions' | 'ctr';
export const getPages = (days: number, sort: PageSort = 'clicks', domain = '', limit = 20) =>
  request<PageStats[]>(`stats/pages?days=${days}&sort=${sort}${domain ? `&domain=${encodeURIComponent(domain)}` : ''}&limit=${limit}`);
export const getDomains = (days: number) => request<DomainStats[]>(`stats/domains?days=${days}`);
export const getDomainTrends = (days: number, limit = 5) => request<DomainTrend[]>(`stats/domains/daily?days=${days}&limit=${limit}`);
export const getNotFound = (limit = 100) => request<NotFoundStats[]>(`stats/notfound?limit=${limit}`);
// The last analysis of the period: fast, never calls the AI model
export const getInsights = (days: number) => request<Insights>(`insights?days=${days}`);
// Slow (10 to 60 s, an AI model analyses the statistics) and billed: only on demand
export const generateInsights = (days: number) => request<Insights>(`insights?days=${days}`, 'POST');

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
