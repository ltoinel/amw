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

// Views are the products displayed by the page, each counted once per tab session
// (a page showing three products counts three), as identified by the cleaned Referer
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
  // As Amazon last gave it, absent when never known; from Amazon, so text only
  title?: string;
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

// Page title and URL come from third-party pages, keywords from an AI model: text only
export interface RecommendationEntry {
  hash: string;
  url: string;
  title: string;
  product: string | null;
  createdAt: string;
  editedAt?: string;
  suggested?: string | null;
  searchUrl?: string;
}

export type Recommendations =
  | { available: false; reason: string }
  | { available: true; total: number; items: RecommendationEntry[] };

export interface LlmUsage {
  feature: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  // In US dollars; null when the server does not know the price of the model
  estimatedCost: number | null;
}

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

export interface Stuffing {
  count: number;
  containerId: string;
  // Saving needs Redis, and cards need recommendations to show anything
  editable: boolean;
  recommendationEnabled: boolean;
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

async function request<T>(path: string, method: 'GET' | 'POST' | 'PUT' = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${getToken() ?? ''}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (response.status === 401) {
    logout();
    throw new UnauthorizedError('Session expired');
  }
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(answer.message || `Request failed (HTTP ${response.status})`);
  }
  return answer as T;
}

export const getStatus = () => request<Status>('status');
// Uses one call of the Amazon quota: only on demand
export const testAmazon = () => request<AmazonCheckResult>('amazon/test', 'POST');
export const getStuffing = () => request<Stuffing>('stuffing');
export const saveStuffing = (count: number, containerId: string) => request<Stuffing>('stuffing', 'PUT', { count, containerId });
export const getSettings = () => request<SettingsSection[]>('settings');
export const getDaily = (days: number) => request<DailyStats[]>(`stats/daily?days=${days}`);
// The most the API returns: the tables page through these rows in the browser
export const MAX_ROWS = 500;

export const getProducts = (days: number, limit = MAX_ROWS) => request<ProductStats[]>(`stats/products?days=${days}&limit=${limit}`);
export type PageSort = 'clicks' | 'impressions' | 'ctr';
export const getPages = (days: number, sort: PageSort = 'clicks', domain = '', limit = MAX_ROWS) =>
  request<PageStats[]>(`stats/pages?days=${days}&sort=${sort}${domain ? `&domain=${encodeURIComponent(domain)}` : ''}&limit=${limit}`);
export const getDomains = (days: number) => request<DomainStats[]>(`stats/domains?days=${days}`);
export const getDomainTrends = (days: number, limit = 5) => request<DomainTrend[]>(`stats/domains/daily?days=${days}&limit=${limit}`);
export const getNotFound = (limit = MAX_ROWS) => request<NotFoundStats[]>(`stats/notfound?limit=${limit}`);
export const getLlmUsage = (days: number) => request<LlmUsage[]>(`stats/llm?days=${days}`);
// The last analysis of the period: fast, never calls the AI model
export const getInsights = (days: number) => request<Insights>(`insights?days=${days}`);
// Slow (10 to 60 s, an AI model analyses the statistics) and billed: only on demand
export const generateInsights = (days: number) => request<Insights>(`insights?days=${days}`, 'POST');

export const getRecommendations = () => request<Recommendations>('recommendations');
export const updateRecommendation = (hash: string, product: string | null) =>
  request<RecommendationEntry>(`recommendations/${hash}`, 'PUT', { product });

// The URL a CDN caches for a page: the portal is served from <Server.path>/admin/
export function productUrlOfPage(hash: string): string {
  return new URL(`../product?page=${hash}`, window.location.href).toString();
}

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
