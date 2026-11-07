/**
 * Checks from the administration portal that the Amazon settings work.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import { AmazonError } from "./AmazonError";

type AmazonCheckFailure = 'credentials' | 'forbidden' | 'request' | 'throttled' | 'timeout' | 'other';

interface AmazonCheckResult {
  ok: boolean;
  marketplace: string;
  partnerTag: string;
  checkedAt: string;
  durationMs: number;
  /** True when this is the previous result: see MIN_INTERVAL. */
  cached: boolean;
  failure?: AmazonCheckFailure;
  message: string;
  /** The product found, as a proof that the answer is real. Absent on failure. */
  product?: { title: string; url: string };
}

/** The part of Paapi used here, and only created when a check runs. */
interface ProductSearch {
  searchItemApi(keyword: string): Promise<{ title?: string; url?: string } | null>;
}

interface AmazonCheckOptions {
  search: () => ProductSearch;
  marketplace: string;
  partnerTag: string;
  now?: () => number;
}

/**
 * Runs one real product search, so it uses one call of the Amazon quota. It bypasses the circuit
 * breaker on purpose: the check is most useful while the breaker has stopped calling Amazon.
 */
class AmazonCheck {

  // Each check is a call of the quota: repeated clicks within this delay get the last result
  private static readonly MIN_INTERVAL: number = 10 * 1000;
  // Sold on every marketplace, in any language: finding nothing would not be about the settings
  private static readonly KEYWORD: string = 'book';

  private readonly options: AmazonCheckOptions;
  private readonly now: () => number;
  private search: ProductSearch | undefined;
  private last: { result: AmazonCheckResult; at: number } | undefined;
  private pending: Promise<AmazonCheckResult> | undefined;

  constructor(options: AmazonCheckOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  public run(): Promise<AmazonCheckResult> {
    if (this.last && this.now() - this.last.at < AmazonCheck.MIN_INTERVAL) {
      return Promise.resolve({ ...this.last.result, cached: true });
    }
    this.pending ??= this.check().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async check(): Promise<AmazonCheckResult> {
    const startedAt = this.now();
    const outcome = await this.attempt();
    const result: AmazonCheckResult = {
      marketplace: this.options.marketplace,
      partnerTag: this.options.partnerTag,
      checkedAt: new Date(startedAt).toISOString(),
      durationMs: this.now() - startedAt,
      cached: false,
      ...outcome
    };
    this.last = { result, at: this.now() };
    return result;
  }

  private async attempt(): Promise<Pick<AmazonCheckResult, 'ok' | 'failure' | 'message' | 'product'>> {
    try {
      this.search ??= this.options.search();
      const product = await this.search.searchItemApi(AmazonCheck.KEYWORD);
      if (!product) {
        return { ok: true, message: 'Amazon accepted the request, but this test search found no product to display.' };
      }
      const tag = `tag=${encodeURIComponent(this.options.partnerTag)}`;
      if (!product.url?.includes(tag)) {
        return {
          ok: false,
          failure: 'request',
          message: 'Amazon answered, but its product links do not carry your partner tag: purchases would not be credited to you. Check Amazon.partnerTag.'
        };
      }
      return {
        ok: true,
        message: 'Amazon accepted the credentials, the partner tag and the marketplace.',
        product: { title: product.title ?? '', url: product.url }
      };
    } catch (error) {
      return { ok: false, ...AmazonCheck.explain(error) };
    }
  }

  /**
   * Only our own messages reach the portal: the errors of the SDK may carry request details.
   */
  private static explain(error: unknown): { failure: AmazonCheckFailure; message: string } {
    const kind = error instanceof AmazonError ? error.kind : undefined;
    if (kind === 'throttled') {
      return { failure: 'throttled', message: 'Amazon limits the calls of this account for now: the credentials work, try again later.' };
    }
    if (kind === 'timeout') {
      return { failure: 'timeout', message: 'Amazon did not answer in time. Try again; if it persists, check the outgoing network of the server.' };
    }

    const cause = error instanceof AmazonError ? error.cause : undefined;
    const status = (cause as { status?: unknown } | undefined)?.status;
    if (status === 401) {
      return { failure: 'credentials', message: 'Amazon rejected the credentials (HTTP 401). Check Amazon.credentialId, Amazon.credentialSecret and Amazon.version.' };
    }
    if (status === 403) {
      return { failure: 'forbidden', message: 'Amazon refused this account (HTTP 403). Check the partner tag, the marketplace and that the account meets the sales requirement of the Creators API.' };
    }
    if (status === 400) {
      return { failure: 'request', message: 'Amazon rejected the request (HTTP 400). Check Amazon.partnerTag, Amazon.marketplace and Amazon.condition.' };
    }
    return {
      failure: 'other',
      message: typeof status === 'number'
        ? `Amazon failed (HTTP ${status}). Try again later, and see the server logs if it persists.`
        : 'Amazon could not be reached or the credentials could not be used. See the server logs.'
    };
  }
}

export { AmazonCheck };
export type { AmazonCheckFailure, AmazonCheckResult };
