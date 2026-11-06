/**
 * List prices of the Claude models, to estimate what the portal's AI features cost.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * An estimate only: the Anthropic invoice is the reference. These prices can change without
 * notice, and neither prompt caching nor the higher rate of Haiku above 100K input tokens
 * applies to the short requests AMW sends.
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

/** US dollars per million tokens. Models the API can answer with, fallbacks included. */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
};

/**
 * @returns The estimated cost in US dollars, or null for a model without a known price: a guess
 * would look like a real figure.
 */
function estimateCost(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = Object.hasOwn(PRICES, model) ? PRICES[model] : undefined;
  return price ? (inputTokens * price.input + outputTokens * price.output) / 1_000_000 : null;
}

export { estimateCost };
