/**
 * Reads and edits the stored product recommendations, for the administration portal.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import type { Redis } from "ioredis";
import { RECOMMENDATION_KEY_PREFIX, StoredRecommendation } from "./Recommender";
import { MAX_KEYWORD_LENGTH, PAGE_HASH_PATTERN, sanitizeText } from "./Schemas";

interface RecommendationEntry extends StoredRecommendation {
  hash: string;
}

/** Keywords refused for a manual edit, reported to the operator as they are. */
class InvalidKeywordsError extends Error {
  constructor() {
    super(`Keywords must be 2 to ${MAX_KEYWORD_LENGTH} characters long`);
    this.name = 'InvalidKeywordsError';
  }
}

class RecommendationStore {

  private static readonly BATCH_SIZE: number = 200;

  constructor(private readonly redis: Redis) {}

  /**
   * Most recent first. Recommendations have no index and are few (bounded by the daily limit),
   * so they are all read to sort them: an operator's rare request can afford it.
   */
  public async list(limit: number): Promise<{ total: number; items: RecommendationEntry[] }> {
    const hashes = await this.scanHashes();
    const items: RecommendationEntry[] = [];
    for (let start = 0; start < hashes.length; start += RecommendationStore.BATCH_SIZE) {
      const batch = hashes.slice(start, start + RecommendationStore.BATCH_SIZE);
      const values = await this.redis.mget(...batch.map(hash => RECOMMENDATION_KEY_PREFIX + hash));
      values.forEach((value, index) => {
        const stored = RecommendationStore.parse(value);
        if (stored) {
          items.push({ ...stored, hash: batch[index] });
        }
      });
    }
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return { total: items.length, items: items.slice(0, limit) };
  }

  /**
   * @param product The keywords, or null for a page that should have no chosen product.
   * @returns The updated entry, or null when this page has no recommendation.
   * @throws InvalidKeywordsError when the keywords cannot be searched.
   */
  public async update(hash: string, product: string | null, now: Date = new Date()): Promise<RecommendationEntry | null> {
    const keywords = product === null ? null : sanitizeText(product);
    if (keywords !== null && (keywords.length < 2 || keywords.length > MAX_KEYWORD_LENGTH)) {
      throw new InvalidKeywordsError();
    }

    const key = RECOMMENDATION_KEY_PREFIX + hash;
    const stored = RecommendationStore.parse(await this.redis.get(key));
    if (!stored) {
      return null;
    }
    const updated: StoredRecommendation = {
      ...stored,
      product: keywords,
      // The edit concerns the first card; the other cards of Stuffing keep their products
      products: [...(keywords === null ? [] : [keywords]), ...(stored.products ?? []).slice(1)],
      // The first edit keeps what Claude said: later edits must not replace it with a manual value
      suggested: stored.editedAt ? stored.suggested : stored.product,
      editedAt: now.toISOString(),
    };
    await this.redis.set(key, JSON.stringify(updated));
    return { ...updated, hash };
  }

  private async scanHashes(): Promise<string[]> {
    const hashes = new Set<string>();
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${RECOMMENDATION_KEY_PREFIX}*`, 'COUNT', RecommendationStore.BATCH_SIZE);
      cursor = next;
      // SCAN may return a key twice
      keys.map(key => key.slice(RECOMMENDATION_KEY_PREFIX.length))
        .filter(hash => PAGE_HASH_PATTERN.test(hash))
        .forEach(hash => hashes.add(hash));
    } while (cursor !== '0');
    return [...hashes];
  }

  private static parse(value: string | null): StoredRecommendation | null {
    if (!value) {
      return null;
    }
    try {
      return JSON.parse(value) as StoredRecommendation;
    } catch {
      return null;
    }
  }
}

export { RecommendationStore, InvalidKeywordsError };
export type { RecommendationEntry };
