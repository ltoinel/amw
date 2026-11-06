/**
 * Request validation schemas, shared by the handlers and the OpenAPI description.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import { z } from "zod";

// Amazon Standard Identification Number: 10 uppercase letters or digits (ISBN-10 for books)
const ASIN_PATTERN = /^[A-Z0-9]{10}$/;
const MAX_KEYWORD_LENGTH = 100;
const MAX_TITLE_LENGTH = 200;
const PAGE_HASH_PATTERN = /^[a-f0-9]{32}$/;
// Amazon accepts at most 10 ASINs per GetItems call
const MAX_BATCH_IDS = 10;
const MAX_VIEW_IDS = 10;

const ASIN_MESSAGE = 'must be an ASIN (10 uppercase letters or digits)';

/**
 * Strips control characters (log stuffing) and HTML-significant characters from free text.
 * Values are never interpolated into HTML or shell, this is defence in depth.
 */
function sanitizeText(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\x00-\x1f\x7f<>"']/g, '').trim();
}

/**
 * For the title read from a web page. It keeps its apostrophes, which French titles are full of:
 * only what could break out of the prompt's <title> delimiter or the logs goes.
 */
function sanitizeTitle(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\x00-\x1f\x7f<>]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Express parses a repeated parameter (?id=a&id=b) as an array; an empty value counts as absent
const blankToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);

const queryString = (name: string) => z.string({ error: `Parameter ${name} must be a string` });

/** `GET <path>/product?id=<ASIN>`, `?keyword=<text>` or `?page=<MD5 of the page URL>`, in that precedence. */
const productQuerySchema = z.object({
  id: z.preprocess(blankToUndefined, queryString('id')
    .trim()
    .regex(ASIN_PATTERN, { error: `Parameter id ${ASIN_MESSAGE}` })
    .optional()),
  keyword: z.preprocess(blankToUndefined, queryString('keyword')
    .max(MAX_KEYWORD_LENGTH, { error: `Keyword too long (max ${MAX_KEYWORD_LENGTH} characters)` })
    .transform(sanitizeText)
    .optional()),
  page: z.preprocess(blankToUndefined, queryString('page')
    .trim()
    .regex(PAGE_HASH_PATTERN, { error: 'Parameter page must be the MD5 of the page URL (32 lowercase hexadecimal characters)' })
    .optional()),
  slot: z.preprocess(blankToUndefined, queryString('slot')
    .regex(/^[0-4]$/, { error: 'Parameter slot must be between 0 and 4' })
    .transform(Number)
    .optional()),
})
  // Sanitization may leave nothing usable (e.g. "?keyword=%3C%3E")
  .refine(query => Boolean(query.id || query.keyword || query.page), { error: 'Missing required parameter: id, keyword or page' })
  .transform(query => {
    if (query.id) return { id: query.id };
    return query.keyword ? { keyword: query.keyword } : { page: query.page as string, slot: query.slot ?? 0 };
  });

/** `GET <path>/products?ids=<ASIN>,<ASIN>,...`: distinct ASINs, in request order. */
const productsQuerySchema = z.object({
  ids: z.preprocess(
    // A repeated parameter (array) becomes `false` so that it fails as "not a string"
    value => (typeof value === 'string'
      ? [...new Set(value.split(',').map(id => id.trim()).filter(id => id !== ''))]
      : value === undefined ? undefined : false),
    z.array(z.string().regex(ASIN_PATTERN, { error: `Parameter ids ${ASIN_MESSAGE}` }), {
      error: issue => (issue.input === undefined ? 'Missing required parameter: ids' : 'Parameter ids must be a string')
    })
      .min(1, { error: 'Missing required parameter: ids' })
      .max(MAX_BATCH_IDS, { error: `Too many ids (max ${MAX_BATCH_IDS})` })
  ),
}).transform(query => query.ids);

/** `POST <path>/view?ids=<ASIN>,<ASIN>,...`: one id per card shown, so repeats are kept. */
const viewQuerySchema = z.object({
  ids: z.preprocess(
    value => (typeof value === 'string'
      ? value.split(',').map(id => id.trim()).filter(id => id !== '')
      : value === undefined ? undefined : false),
    z.array(z.string().regex(ASIN_PATTERN, { error: `Parameter ids ${ASIN_MESSAGE}` }), {
      error: issue => (issue.input === undefined ? 'Missing required parameter: ids' : 'Parameter ids must be a string')
    })
      .min(1, { error: 'Missing required parameter: ids' })
      .max(MAX_VIEW_IDS, { error: `Too many ids (max ${MAX_VIEW_IDS})` })
  ),
}).transform(query => query.ids);

type ProductQuery = z.output<typeof productQuerySchema>;

/**
 * @returns The parsed value, or the message of the first validation issue.
 */
function parseQuery<T>(schema: z.ZodType<T>, query: unknown): { success: true; data: T } | { success: false; message: string } {
  const result = schema.safeParse(query);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, message: result.error.issues[0]?.message ?? 'Invalid request' };
}

export {
  ASIN_PATTERN,
  MAX_KEYWORD_LENGTH,
  MAX_TITLE_LENGTH,
  PAGE_HASH_PATTERN,
  MAX_BATCH_IDS,
  sanitizeText,
  sanitizeTitle,
  productQuerySchema,
  productsQuerySchema,
  viewQuerySchema,
  parseQuery
};
export type { ProductQuery };
