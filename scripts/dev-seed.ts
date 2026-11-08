/**
 * Simulated statistics for local development
 * ----------------------------------------------
 * Fills a local Redis with 30 days of realistic traffic, so that every view of the portal has
 * something to show: site filter, charts, products, pages, products to replace, Amazon quota,
 * A/B tests and Claude costs. The traffic goes through the real Stats class with a simulated
 * clock, so the keys always match what the server reads. The same seed gives the same data.
 *
 * Usage: start Redis (docker run -d --name amw-redis -p 6379:6379 redis:8), then
 *   REDIS_ENABLED=true npm run dev:mock    # in another terminal
 *   npm run dev:seed [-- --reset]          # --reset clears the statistics first
 * Redis is read from REDIS_HOST, REDIS_PORT, REDIS_USERNAME and REDIS_PASSWORD; only a local
 * server is accepted, as the seed writes fake statistics and replaces the list of sites.
 */

import Redis from 'ioredis';
import type { CatalogEntry } from '../tests/e2e/support/mockAmazonApi';
import { WIDGET_EFFECTS, WIDGET_THEMES, type WidgetEffect, type WidgetTheme } from '../src/server/Settings';
import { SiteSettings } from '../src/server/SiteSettings';
import { Stats } from '../src/server/Stats';

const DAYS = 30;
const DAY_MS = 24 * 3600 * 1000;
// The first days come before the Amazon call counter, as on a server upgraded from 5.4
const DAYS_WITHOUT_CALL_COUNTER = 5;
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', 'redis'];
// The demo page of npm run dev:mock, which must stay allowed once the list of sites is saved
const DEMO_HOST = `localhost:${Number(process.env.AMW_DEMO_PORT) || (Number(process.env.AMW_DEV_PORT) || 8080) + 2}`;
const AMW_URL = process.env.AMW_URL ?? `http://localhost:${Number(process.env.AMW_DEV_PORT) || 8080}/item`;

const SITES = [
  { host: 'blog.example', description: 'Tech blog: reviews and buying guides', views: 220 },
  { host: 'news.example', description: 'Daily tech news', views: 140 },
  { host: 'diy.example', description: 'Do it yourself projects', views: 60 },
];
// Pages of a site that is not on the list: they count in the totals, not in the per-site figures
const OTHER_SITE = 'other.example';

const PRODUCT_NAMES = [
  'Wireless Noise Cancelling Headphones', 'Compact Mechanical Keyboard', 'Smartwatch with GPS',
  'USB-C Docking Station, 12 Ports', '27-inch 4K Monitor', 'Ergonomic Vertical Mouse',
  'Portable SSD 2 TB', 'Mesh Wi-Fi System', 'Cordless Drill Driver 18 V', 'Laser Distance Meter',
  'Robot Vacuum Cleaner', 'Espresso Machine', 'E-reader with Warm Light', 'Action Camera 4K',
  'Bluetooth Speaker, Waterproof', 'Standing Desk Frame', 'Soldering Station', 'Raspberry Pi Kit',
  'Smart Thermostat', 'Multitool with 18 Tools',
];
const BRANDS = ['Acme', 'KeyCraft', 'Pulse', 'Voltix', 'Northwind', 'Brightline'];

/** The products of the simulated traffic, also served by the mock Amazon API of npm run dev:mock. */
export const SEED_CATALOG: Record<string, CatalogEntry> = Object.fromEntries(Array.from({ length: 40 }, (_, i) => {
  const name = PRODUCT_NAMES[i % PRODUCT_NAMES.length];
  const price = 19 + ((i * 37) % 280);
  return [`B0SEED${String(i + 1).padStart(4, '0')}`, {
    title: i < PRODUCT_NAMES.length ? name : `${name}, ${2025 + (i % 2)} model`,
    brand: BRANDS[i % BRANDS.length],
    // A product without an offer now and then, as on Amazon
    price: i % 9 === 8 ? undefined : `${price},${String((i * 13) % 100).padStart(2, '0')} €`,
    savings: i % 4 === 0 ? 10 + (i % 3) * 5 : undefined,
  }];
}));
const ASINS = Object.keys(SEED_CATALOG);

// Products that Amazon no longer returns; the last one disappeared before titles were remembered
const NOT_FOUND = [
  { asin: 'B0GONE0001', title: 'Wireless Earbuds, 2023 model' },
  { asin: 'B0GONE0002', title: 'Fitness Tracker with Heart Rate' },
  { asin: 'B0GONE0003', title: 'USB Microphone for Podcasts' },
  { asin: 'B0GONE0004', title: '1080p Webcam with Ring Light' },
  { asin: 'B0GONE0005', title: undefined },
];

const MODELS = { recommendation: 'claude-haiku-5-5', insights: 'claude-opus-5-5' };

/** Deterministic pseudo-random numbers (mulberry32), so that two runs give the same data. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Reset by each seed, so that two runs give the same data
let rand = random(408);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
// Most of the traffic goes to the first items, as on a real site
const pickPopular = <T>(items: readonly T[]): T => items[Math.floor(items.length * rand() ** 2.2)];

interface Page { url: string; site: string; asins: string[]; missing?: string }

function pages(): Page[] {
  const all: Page[] = [];
  for (const [s, site] of [...SITES.map(site => site.host), OTHER_SITE].entries()) {
    for (let i = 1; i <= 15; i++) {
      // Each page shows one to three products, chosen among those that suit its site
      const asins = Array.from({ length: 1 + ((i + s) % 3) }, (_, card) => ASINS[(s * 7 + i * 3 + card * 11) % ASINS.length]);
      const page: Page = { url: `https://${site}/article-${i}/`, site, asins: [...new Set(asins)] };
      // A few pages still show a product that Amazon no longer returns
      if (i % 4 === 1 && site !== OTHER_SITE) page.missing = NOT_FOUND[(s + i) % NOT_FOUND.length].asin;
      all.push(page);
    }
  }
  return all;
}

// A weekly rhythm with a slow growth, so that the charts look like real traffic
function dailyViews(base: number, day: number): number {
  const weekend = new Date(Date.now() - (DAYS - 1 - day) * DAY_MS).getUTCDay() % 6 === 0;
  return Math.round(base * (0.75 + day / DAYS / 2) * (weekend ? 0.6 : 1) * (0.9 + rand() * 0.2));
}

// Some effects and themes do better, so that the A/B tests have a winner to find
const EFFECT_LIFT: Record<WidgetEffect, number> = { none: 1, fade: 1.15, slide: 1.3, zoom: 0.9, pulse: 1.05 };
const themeLift = (theme: WidgetTheme): number => 0.85 + (WIDGET_THEMES.indexOf(theme) % 4) * 0.12;

async function reset(redis: Redis): Promise<number> {
  let cursor = '0';
  let deleted = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'amw:stats:*', 'COUNT', 500);
    if (keys.length > 0) deleted += await redis.del(...keys);
    cursor = next;
  } while (cursor !== '0');
  return deleted;
}

/** Adds the simulated sites to the Sites page, so that the site filter offers them. */
async function addSites(redis: Redis): Promise<void> {
  const sites = new SiteSettings({ server: { allowedSites: [] }, recommendation: { allowedHosts: [] } }, redis);
  await sites.refresh();
  const list = sites.saved ? sites.list : [];
  const wanted = [
    ...SITES.map(({ host, description }) => ({ host, description, url: `https://${host}/`, partnerTag: '' })),
    { host: DEMO_HOST, description: 'Demo page of npm run dev:mock', url: `http://${DEMO_HOST}/`, partnerTag: '' },
  ];
  const added = wanted.filter(site => !list.some(existing => existing.host === site.host));
  if (added.length > 0 && !await sites.save({ sites: [...list, ...added] })) {
    throw new Error('The simulated sites do not fit in the list of sites');
  }
}

function simulateDay(stats: Stats, clock: { now: Date }, day: number, allPages: Page[]): void {
  const start = Date.now() - (DAYS - 1 - day) * DAY_MS;
  const counted = day >= DAYS_WITHOUT_CALL_COUNTER;
  const effectTest = day >= 10;
  const themeTest = day >= 18;

  for (const site of [...SITES, { host: OTHER_SITE, views: 25 }]) {
    const sitePages = allPages.filter(page => page.site === site.host);
    const views = dailyViews(site.views, day);
    for (let v = 0; v < views; v++) {
      // Spread over the day, up to now for today
      clock.now = new Date(Math.min(Date.now(), start - DAY_MS / 2 + (v / views) * DAY_MS));
      const page = pickPopular(sitePages);
      const effect = effectTest ? pick(WIDGET_EFFECTS) : undefined;
      const theme = themeTest ? pick(WIDGET_THEMES) : undefined;

      // Most lookups are answered by the cache; the others call Amazon
      for (const asin of page.asins) {
        const fromAmazon = rand() < 0.12;
        stats.recordProduct(fromAmazon ? 'amazon' : 'cache', 'id', asin, page.url);
        if (fromAmazon && counted) stats.recordAmazonCall();
      }
      if (page.missing) {
        stats.recordProduct('notfound', 'id', page.missing, page.url);
        if (counted && rand() < 0.3) stats.recordAmazonCall();
      }
      stats.recordViews(page.asins, page.url, effect, theme);

      for (const asin of page.asins) {
        const ctr = (0.015 + (ASINS.indexOf(asin) % 7) * 0.008) * (effect ? EFFECT_LIFT[effect] : 1) * (theme ? themeLift(theme) : 1);
        if (rand() < ctr) stats.recordClick(asin, page.url, effect, theme);
      }
    }
  }

  // Recommendations of new pages, and an insights analysis now and then
  clock.now = new Date(Math.min(Date.now(), start));
  for (let i = Math.round(3 + rand() * 6); i > 0; i--) {
    stats.recordLlmUsage('recommendation', MODELS.recommendation, { input_tokens: 1800 + Math.round(rand() * 900), output_tokens: 120 + Math.round(rand() * 80) });
  }
  if (day % 5 === 2) {
    stats.recordLlmUsage('insights', MODELS.insights, { input_tokens: 14000 + Math.round(rand() * 4000), output_tokens: 1500 + Math.round(rand() * 600) });
  }
}

/** Asks the running server for the products, so that the portal shows their titles and images. */
async function warmProducts(): Promise<number> {
  let warmed = 0;
  for (let i = 0; i < ASINS.length; i += 10) {
    const response = await fetch(`${AMW_URL}/products?ids=${ASINS.slice(i, i + 10).join(',')}`);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    warmed += Math.min(10, ASINS.length - i);
  }
  return warmed;
}

/**
 * Writes the simulated statistics into `redis` and adds the simulated sites to the Sites page.
 * @returns The hosts of the simulated sites.
 */
export async function seed(redis: Redis, options: { reset?: boolean; log?: (line: string) => void } = {}): Promise<string[]> {
  const log = options.log ?? (() => undefined);
  rand = random(408);
  if (options.reset) {
    log(`Deleted ${await reset(redis)} statistics keys`);
  }
  await addSites(redis);

  const clock = { now: new Date() };
  const hosts = SITES.map(site => site.host);
  const stats = new Stats(redis, () => clock.now, hosts);
  const allPages = pages();
  for (const { asin, title } of NOT_FOUND) {
    if (title) stats.rememberTitle('id', asin, title);
  }
  for (let day = 0; day < DAYS; day++) {
    simulateDay(stats, clock, day, allPages);
    // Stats does not wait for Redis: a command sent after the others answers once they are done
    await redis.ping();
    log(`Simulated day ${day + 1}/${DAYS}`);
  }
  return hosts;
}

async function main(): Promise<void> {
  const host = process.env.REDIS_HOST ?? 'localhost';
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(`Refusing to write simulated statistics to ${host}: only a local Redis is accepted (${LOCAL_HOSTS.join(', ')})`);
  }
  const redis = new Redis({
    host,
    port: Number(process.env.REDIS_PORT) || 6379,
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  await redis.connect();
  try {
    const hosts = await seed(redis, { reset: process.argv.includes('--reset'), log: console.log });
    console.log(`Seeded ${DAYS} days of traffic on ${hosts.join(', ')} (and ${OTHER_SITE}, not on the list)`);
  } finally {
    redis.disconnect();
  }

  try {
    console.log(`Warmed ${await warmProducts()} products through ${AMW_URL}`);
  } catch (error) {
    console.log(`Products not warmed (${error instanceof Error ? error.message : String(error)}): start REDIS_ENABLED=true npm run dev:mock and run the seed again to show their titles and images`);
  }
}

// Only when run: npm run dev:mock imports SEED_CATALOG
if (require.main === module) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
