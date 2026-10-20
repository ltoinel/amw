/**
 * Classification of Amazon Creators API failures.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

/**
 * - `timeout`: Amazon did not answer in time (HTTP 504).
 * - `throttled`: Amazon answered 429, the quota is exhausted for now (HTTP 503 + Retry-After).
 * - `upstream`: any other failure (auth, 5xx, network, malformed answer) (HTTP 502).
 * - `unavailable`: Amazon was not called because the circuit breaker is open (HTTP 503 + Retry-After).
 *
 * "Item does not exist" is deliberately not an error: Paapi returns null for it, so that only a
 * real absence is ever answered with 404 (and counted as a product to replace).
 */
type AmazonErrorKind = 'timeout' | 'throttled' | 'upstream' | 'unavailable';

// Used when Amazon throttles without a usable Retry-After header
const DEFAULT_RETRY_AFTER_SECONDS = 60;

class AmazonError extends Error {
  public readonly kind: AmazonErrorKind;
  /** Seconds the client should wait, set for `throttled` and `unavailable`. */
  public readonly retryAfter?: number;

  constructor(kind: AmazonErrorKind, message: string, options?: { retryAfter?: number; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = 'AmazonError';
    this.kind = kind;
    this.retryAfter = options?.retryAfter;
  }
}

/**
 * Accepts the delay-seconds form only; an HTTP-date is converted to seconds from now.
 */
function parseRetryAfter(value: unknown): number {
  if (typeof value !== 'string' || value.trim() === '') {
    return DEFAULT_RETRY_AFTER_SECONDS;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds);
  }
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  }
  return DEFAULT_RETRY_AFTER_SECONDS;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readHeader(headers: any, name: string): unknown {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name);
  return headers[name] ?? headers[name.toLowerCase()];
}

/**
 * Maps a rejection of the amazon-creators-api SDK to an AmazonError, or returns null when the
 * failure means the requested item does not exist (HTTP 404).
 *
 * The SDK rejects with three shapes (see ApiClient.callApi):
 * - `{ status, statusText, body, response }` when Amazon answered with a non-2xx status;
 * - `{ error, statusText? }` when fetch itself failed, `statusText` being "Request timeout" on abort;
 * - an `Error` (missing credentials, OAuth2 token failure carrying `status`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyAmazonError(error: any): AmazonError | null {
  if (error instanceof AmazonError) {
    return error;
  }

  const status = typeof error?.status === 'number' ? error.status : undefined;
  const isSdkHttpError = !(error instanceof Error) && status !== undefined;

  if (isSdkHttpError && status === 404) {
    return null;
  }

  if (status === 429) {
    const retryAfter = parseRetryAfter(readHeader(error?.response?.headers, 'retry-after'));
    return new AmazonError('throttled', 'Amazon API throttled the request', { retryAfter, cause: error });
  }

  if (error?.statusText === 'Request timeout') {
    return new AmazonError('timeout', 'Amazon API request timed out', { cause: error });
  }

  const detail = status !== undefined ? `HTTP ${status}` : (error instanceof Error ? error.message : 'network error');
  return new AmazonError('upstream', `Amazon API call failed: ${detail}`, { cause: error });
}

export { AmazonError, classifyAmazonError, parseRetryAfter, DEFAULT_RETRY_AFTER_SECONDS };
export type { AmazonErrorKind };
