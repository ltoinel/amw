/**
 * Fictitious answers of the administration API, for the screenshots of the user guide: the portal
 * then shows a realistic site without Redis, without real statistics and without any real setting.
 */

const DAYS = 30;
const DAY_MS = 24 * 3600 * 1000;
const SITES = ['blog.example', 'news.example', 'diy.example'];

// A weekly rhythm, so that the charts look like real traffic while staying the same on every run
function wave(index: number, base: number, amplitude: number): number {
  return Math.round(base + amplitude * Math.sin(index / 2.2) + (index % 7 < 2 ? -amplitude / 2 : 0));
}

function dates(): string[] {
  return Array.from({ length: DAYS }, (_, i) => new Date(Date.now() - (DAYS - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

const PRODUCT_TITLES = [
  'Wireless Noise Cancelling Headphones, 40 h battery',
  'Compact Mechanical Keyboard with RGB Backlight',
  'Smartwatch with Heart Rate and GPS Tracking',
  'USB-C Docking Station, 12 Ports',
  '27-inch 4K Monitor with Adjustable Stand',
  'Ergonomic Vertical Mouse',
];

const products = Array.from({ length: 62 }, (_, i) => {
  const value = `B0DOCS${String(i + 1).padStart(4, '0')}`;
  const impressions = Math.round(9000 / (i + 1));
  const clicks = Math.round(impressions * (0.09 - (i % 5) * 0.012));
  return {
    product: `id:${value}`,
    type: 'id',
    value,
    title: `${PRODUCT_TITLES[i % PRODUCT_TITLES.length]}${i < PRODUCT_TITLES.length ? '' : ` (model ${i + 1})`}`,
    image: `https://m.media-amazon.com/images/I/${['B0DOCS0001', 'B0DOCS0002', 'B0DOCS0003'][i % 3]}.jpg`,
    url: `https://www.amazon.example/dp/${value}`,
    impressions,
    clicks,
    ctr: clicks / impressions,
  };
});

const pages = Array.from({ length: 48 }, (_, i) => {
  const impressions = Math.round(6000 / (i + 1));
  const clicks = Math.round(impressions * (0.08 - (i % 4) * 0.014));
  return { url: `https://${SITES[i % 3]}/article-${i + 1}/`, impressions, clicks, ctr: clicks / impressions };
});

const domains = SITES.map((domain, i) => {
  const impressions = [21400, 9300, 3100][i];
  const clicks = [1320, 430, 210][i];
  return { domain, impressions, clicks, ctr: clicks / impressions };
});

const SETTINGS = [
  {
    title: 'Server',
    entries: [
      { key: 'Server.port', value: 8080 }, { key: 'Server.path', value: '/item' }, { key: 'Server.cors', value: false },
      { key: 'Server.httpCache', value: 3600 }, { key: 'Server.rateLimit', value: 120 }, { key: 'Server.trustProxy', value: 2 },
      { key: 'Server.theme', value: 'default' },
    ],
  },
  {
    title: 'Redis',
    entries: [
      { key: 'Redis.enabled', value: true }, { key: 'Redis.host', value: 'redis' }, { key: 'Redis.port', value: 6379 },
      { key: 'Redis.password', secret: true, configured: true }, { key: 'Redis.expire', value: 43200 },
    ],
  },
  {
    title: 'Amazon',
    entries: [
      { key: 'Amazon.credentialId', secret: true, configured: true }, { key: 'Amazon.credentialSecret', secret: true, configured: true },
      { key: 'Amazon.partnerTag', value: 'example-21' }, { key: 'Amazon.marketplace', value: 'www.amazon.example' },
    ],
  },
  {
    title: 'Administration',
    entries: [
      { key: 'Admin.insights', value: true }, { key: 'AMW_ADMIN_PASSWORD', secret: true, configured: true },
      { key: 'AMW_ADMIN_SECRET', secret: true, configured: true }, { key: 'ANTHROPIC_API_KEY', secret: true, configured: true },
    ],
  },
];

/** The answer of the API for a path below <path>/admin/api/, or undefined when it has none. */
export function adminFixture(apiPath: string, method: string): unknown {
  if (apiPath === 'status') {
    return { stats: true, retentionDays: 90, version: { release: 'x.y.z', revision: null, buildDate: null } };
  }
  if (apiPath === 'settings') return SETTINGS;
  if (apiPath === 'stuffing') return { count: 2, containerId: 'main-content', editable: true, recommendationEnabled: true };
  if (apiPath === 'amazon/test' && method === 'POST') {
    return {
      ok: true, marketplace: 'www.amazon.example', partnerTag: 'example-21', checkedAt: new Date().toISOString(), durationMs: 412, cached: false,
      message: 'Amazon accepted the credentials, the partner tag and the marketplace.',
      product: { title: 'A Fictitious Book', url: 'https://www.amazon.example/dp/B0DOCS0099?tag=example-21' },
    };
  }
  if (apiPath === 'stats/daily') {
    return dates().map((date, i) => ({
      date, cache: wave(i, 950, 240), amazon: wave(i, 140, 40), notfound: wave(i, 8, 4),
      views: wave(i, 1140, 300), clicks: wave(i, 62, 18),
    }));
  }
  if (apiPath === 'stats/products') return products;
  if (apiPath === 'stats/pages') return pages;
  if (apiPath === 'stats/domains') return domains;
  if (apiPath === 'stats/domains/daily') {
    return domains.map((site, s) => ({
      ...site,
      daily: dates().map((date, i) => ({ date, impressions: wave(i, 500 - s * 150, 90), clicks: wave(i, 30 - s * 8, 6), ctr: (6 - s) / 100 + Math.sin((i + s) / 3) / 100 })),
    }));
  }
  if (apiPath === 'stats/notfound') {
    return [
      { product: 'id:B0DOCS0201', type: 'id', value: 'B0DOCS0201', count: 148, firstSeen: new Date(Date.now() - 9 * DAY_MS).toISOString(), lastSeen: new Date().toISOString(), url: 'https://www.amazon.example/dp/B0DOCS0201', referers: [{ url: 'https://blog.example/article-3/', count: 120 }, { url: 'https://diy.example/article-8/', count: 28 }] },
      { product: 'id:B0DOCS0202', type: 'id', value: 'B0DOCS0202', count: 31, firstSeen: new Date(Date.now() - 5 * 3600 * 1000).toISOString(), lastSeen: new Date().toISOString(), url: 'https://www.amazon.example/dp/B0DOCS0202', referers: [{ url: 'https://news.example/article-2/', count: 31 }] },
    ];
  }
  if (apiPath === 'stats/llm') {
    return [
      { feature: 'insights', model: 'claude-opus-5-5', calls: 6, inputTokens: 41200, outputTokens: 18300, estimatedCost: 0.53 },
      { feature: 'recommendation', model: 'claude-haiku-5-5', calls: 84, inputTokens: 33600, outputTokens: 9100, estimatedCost: 0.0079 },
    ];
  }
  if (apiPath === 'insights') {
    return {
      available: true, days: 30, generatedAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(), model: 'claude-opus-5-5', cached: true,
      summary: 'This text is a fictitious example. Views rose by 12 % over the period, and blog.example brings most of the clicks with a click-through rate of 6.2 %. Two products are no longer sold while still embedded in three pages.',
      recommendations: [
        { title: 'Replace B0DOCS0201', detail: 'It has been missing for nine days and is still embedded in blog.example/article-3 and diy.example/article-8.' },
        { title: 'Review the cards of news.example', detail: 'Its pages show many cards but a click-through rate of 4.6 %: compare the products with the subject of the articles.' },
      ],
    };
  }
  return undefined;
}
