/**
 * Typed server settings, read and validated once from the configuration.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import { accessSync, constants } from "node:fs";
import { dirname } from "node:path";
import { parseIpRule } from "./IpFilter";

/** The part of node-config used here, so that tests can pass a plain object instead. */
interface ConfigSource {
  get<T = unknown>(key: string): T;
  has(key: string): boolean;
}

// Must match THEMES in src/widgets/widget.js and the files of src/widgets/themes/
// The last three are seasonal: Christmas, Halloween and Black Friday
const WIDGET_THEMES = ['default', 'native', 'shelf', 'receipt', 'blueprint', 'outdoor', 'terminal', 'magazine', 'pastel', 'neon', 'denim', 'leather', 'canvas', 'alpine', 'christmas', 'halloween', 'blackfriday'] as const;
type WidgetTheme = typeof WIDGET_THEMES[number];

interface ServerSettings {
  port: number;
  path: string;
  debug: boolean;
  cors: boolean;
  projectDir: string;
  /** Cache-Control max-age in seconds for product and widget responses. */
  httpCache: number;
  /** Max /product requests per minute and per client IP. */
  rateLimit: number;
  clickRateLimit: number;
  viewRateLimit: number;
  metrics: boolean;
  swagger: boolean;
  /** Express "trust proxy" value; must match the real proxy chain or client IPs can be spoofed. */
  trustProxy: string | number | boolean | string[];
  /** Design of the cards when the page does not choose one (data-theme). */
  theme: WidgetTheme;
  /** Hosts (with the port if not the default) of the sites that may use the widget; empty allows all. */
  allowedSites: string[];
}

interface RedisSettings {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password: string;
  /** Product cache TTL in seconds, before the 24 h cap applied by AmwApi. */
  expire: number;
  staleExpire: number;
  notFoundExpire: number;
}

interface AmazonSettings {
  credentialId: string;
  credentialSecret: string;
  version: string;
  partnerTag: string;
  marketplace: string;
  condition: string;
  /** Endpoint overrides for end-to-end tests against a mock; empty keeps the SDK defaults. */
  apiBasePath: string;
  authEndpoint: string;
  breakerThreshold: number;
  /** In seconds. */
  breakerCooldown: number;
}

interface AdminSettings {
  enabled: boolean;
  /** AI insights through the Claude API (the key stays in ANTHROPIC_API_KEY). */
  insights: boolean;
  /** Undefined lets AdminApi apply its own default. */
  tokenTtl?: number;
  loginRateLimit?: number;
  /** Addresses or CIDR ranges that may reach the portal; empty allows every address. */
  allowedIps: string[];
  /** JSON file holding the settings changed in the portal; empty keeps them in Redis. */
  settingsFile: string;
}

interface RecommendationSettings {
  /** Widgets without an id, through the Claude API (the key stays in ANTHROPIC_API_KEY). */
  enabled: boolean;
  /**
   * Hostnames of the pages that may trigger a paid call: Server.allowedSites, or the deprecated
   * Recommendation.allowedHosts of older configuration files when Server.allowedSites is empty.
   */
  allowedHosts: string[];
  /** Maximum paid calls per UTC day. */
  dailyLimit: number;
  /** Shows the most clicked product of the site on pages without a product. */
  fallback: boolean;
}

/** An Amazon search of discounted products: the API needs keywords, the index narrows them. */
interface DealsConfig {
  keywords: string;
  /** "All" for every category. */
  searchIndex: string;
  /** The smallest discount, in percent. */
  minSavingPercent: number;
}

/** A card of the site's own, outside Amazon: no price, no Amazon ribbon, no affiliate disclosure. */
interface Banner {
  id: string;
  title: string;
  /** https only: the card is shown on https pages. */
  image: string;
  url: string;
  /** The text of the button; the widget's own otherwise. */
  label?: string;
}

/** A search of the Best deals view: at most maxProducts products, the API returning 10 at most. */
interface DealSearch extends DealsConfig {
  maxProducts: number;
}

interface StuffingConfig {
  /** Off: no card is added, whatever the numbers. Absent from older values, which were on. */
  enabled?: boolean;
  /** Cards widget.js adds to each article; 0 adds none. */
  count: number;
  /** recommendation: products chosen for the page content; manual: the products list, in order. */
  mode: StuffingMode;
  /** The id of the element holding the article. */
  containerId: string;
  /** ASINs set in the portal: the cards of manual mode, the first fallback of recommendation mode. */
  products: string[];
  /** Words of the article per card, so that a short article gets fewer; 0 leaves only the maximum. */
  wordsPerCard: number;
  /** The number of cards of a site, by host, in place of count; set in the portal. */
  sites: Record<string, number>;
  /** The single search of deals mode before there could be several; read when dealSearches is empty. */
  deals?: DealsConfig;
  /** The searches of deals mode, set in the Best deals view: their products are drawn together. */
  dealSearches?: DealSearch[];
  /** Cards of the site's own, outside Amazon, that the custom list names as banner:<id>. */
  banners?: Banner[];
  /** The share of the cards of each source in mix mode, as weights (percentages in the portal). */
  weights?: Record<StuffingSource, number>;
}

interface EffectConfig {
  mode: EffectMode;
  /** The effects compare mode draws from, set in the portal: all of them by default. */
  effects: WidgetEffect[];
  /** When the running test started (ISO date), set by the server. */
  startedAt?: string;
  /** When the running test stops by itself (ISO date), set by the server from its planned duration. */
  endsAt?: string;
}

/** Tracking IDs by site, only set in the portal: the other sites keep Amazon.partnerTag. */
interface PartnerTagsConfig {
  sites: Record<string, string>;
}

/** The A/B test of themes, only set in the portal: off leaves Server.theme and data-theme alone. */
interface ThemeTestConfig {
  mode: ThemeTestMode;
  /** compare: each tab session gets one of these at random. */
  themes: WidgetTheme[];
  /** The theme of a site, over Server.theme and the live settings; absent: theirs. */
  theme?: WidgetTheme;
  startedAt?: string;
  endsAt?: string;
}

interface Settings {
  server: ServerSettings;
  redis: RedisSettings;
  amazon: AmazonSettings;
  admin: AdminSettings;
  recommendation: RecommendationSettings;
  stuffing: StuffingConfig;
  effect: EffectConfig;
  /** Deprecated or risky configuration, logged at startup. */
  warnings: string[];
}

/** A secret only says whether it is set: its value never leaves the server. */
// key: the name in the configuration files, or a name in the same style for the environment-only
// secrets (envOnly); env: the environment variable, null when there is none
type SettingEntry = { key: string; env: string | null; description: string } & (
  | { secret: true; configured: boolean; envOnly?: true }
  | { secret?: false; value: string | number | boolean | string[] | null }
);

interface SettingsSection {
  title: string;
  entries: SettingEntry[];
}

// Must match EFFECTS in src/widgets/widget.js and the amw-effect-* rules of widget.css
const WIDGET_EFFECTS = ['none', 'fade', 'slide', 'zoom', 'pulse'] as const;
type WidgetEffect = typeof WIDGET_EFFECTS[number];
// compare: each tab session gets one of the effects at random, to measure them against each other
const EFFECT_MODES = [...WIDGET_EFFECTS, 'compare'] as const;
type EffectMode = typeof EFFECT_MODES[number];
const THEME_TEST_MODES = ['off', 'compare'] as const;
type ThemeTestMode = typeof THEME_TEST_MODES[number];
// The call to action of the card button, by what it says; widget.js holds its text in each language.
// Must match BUTTON_LABELS in src/widgets/widget.js.
const BUTTON_LABELS = ['offer', 'price', 'view', 'buy'] as const;
type ButtonLabel = typeof BUTTON_LABELS[number];

/** The label of the card button, or the labels an A/B test compares. */
interface ButtonLabelConfig {
  label: ButtonLabel;
  mode: ThemeTestMode;
  labels: ButtonLabel[];
  startedAt?: string;
  endsAt?: string;
}

// recommendation: Claude per page; popular: the most clicked products of the site; manual: the portal's list;
// deals: the best discounts of an Amazon search; mix: each card draws one of these by their weights
const STUFFING_MODES = ['recommendation', 'popular', 'manual', 'deals', 'mix'] as const;
// The sources a mix draws from
const STUFFING_SOURCES = ['recommendation', 'popular', 'manual', 'deals'] as const;
type StuffingSource = typeof STUFFING_SOURCES[number];
// A search index of the Creators API, such as Electronics: each marketplace has its own list
const SEARCH_INDEX = /^[A-Za-z]{1,40}$/;
// Several searches mix categories; more would spend the Amazon quota for little
const MAX_DEAL_SEARCHES = 5;
const MAX_DEAL_PRODUCTS = 10;
// Below, nearly every product qualifies; above, nearly none
const MIN_DEAL_SAVING = 5;
const MAX_DEAL_SAVING = 90;
type StuffingMode = typeof STUFFING_MODES[number];

const DEFAULT_PORT = 8080;
// More cards would turn an article into an advertisement
const MAX_STUFFED_CARDS = 5;
// Enough for every card of a few articles; the list is kept in memory by every process
const MAX_STUFFING_PRODUCTS = 20;
// The custom list names a banner by this prefix and its id, beside the ASINs
const BANNER_PREFIX = 'banner:';
const BANNER_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
// More than any list of sites a server realistically serves; the map is prepended to widget.js
const MAX_STUFFING_SITES = 50;
// A card every 10 000 words already means none on almost any article
const MAX_WORDS_PER_CARD = 10000;
// Prepended to widget.js and given to getElementById: an HTML id without anything to interpret
const CONTAINER_ID = /^[A-Za-z][\w-]{0,63}$/;
const SITE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$/;
// An Associates tracking ID such as mysite-21: it is written into the links of the cards
const PARTNER_TAG = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}-\d{2}$/;
// Amazon Associates rules: displayed prices must be less than 24 hours old
const MAX_PRODUCT_AGE = 86400;

/**
 * node-config, loaded on first use: it reads NODE_ENV and the YAML files when required, and
 * modules that receive their settings (unit tests among them) then never load it at all.
 */
function configFiles(): ConfigSource {
  const loaded = require("config");
  // CommonJS export, or the default export of an ES module (as jest.mock factories provide)
  return loaded.default ?? loaded;
}

/**
 * Reads the configuration into a typed object, applying the defaults of optional keys.
 * @param source node-config by default.
 * @throws Error naming the offending key when a value is invalid, so that the server refuses to start.
 */
function loadSettings(source: ConfigSource = configFiles()): Settings {
  const optional = <T>(key: string, defaultValue: T): T => (source.has(key) ? source.get<T>(key) : defaultValue);
  // Environment variables arrive as strings, hence the 'true' comparisons
  const flag = (key: string): boolean => {
    const value = optional<unknown>(key, false);
    return value === true || value === 'true';
  };
  // 0 disables the feature; unset or empty keeps the default so that older configuration files keep working
  const positiveOrZero = (key: string, defaultValue: number): number => {
    const raw = optional<unknown>(key, null);
    if (raw === null || raw === undefined || raw === '') {
      return defaultValue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${key} must be a positive number or 0`);
    }
    return value;
  };
  const optionalNumber = (key: string): number | undefined => (source.has(key) ? Number(source.get(key)) : undefined);

  const server: ServerSettings = {
    port: Number(source.get('Server.port')) || DEFAULT_PORT,
    path: source.get<string>('Server.path') || '/amw',
    debug: flag('Server.debug'),
    cors: flag('Server.cors'),
    projectDir: source.get<string>('Server.projectDir'),
    // 0 or unset falls back to 5 minutes
    httpCache: Number(source.get('Server.httpCache')) || 300,
    rateLimit: source.has('Server.rateLimit') ? Number(source.get('Server.rateLimit')) : 120,
    clickRateLimit: source.has('Server.clickRateLimit') ? Number(source.get('Server.clickRateLimit')) : 60,
    viewRateLimit: source.has('Server.viewRateLimit') ? Number(source.get('Server.viewRateLimit')) : 120,
    metrics: flag('Server.metrics'),
    swagger: flag('Server.swagger'),
    trustProxy: optional<ServerSettings['trustProxy']>('Server.trustProxy', false),
    theme: optional<string>('Server.theme', 'default') as WidgetTheme,
    allowedSites: optional<string[]>('Server.allowedSites', []),
  };

  const redis: RedisSettings = {
    enabled: source.get('Redis.enabled') === true,
    host: source.get<string>('Redis.host'),
    port: source.get<number>('Redis.port'),
    username: source.get<string>('Redis.username'),
    password: source.get<string>('Redis.password'),
    // As long as Amazon allows a price to be shown: one call a day per product
    expire: Number(source.get('Redis.expire')) || MAX_PRODUCT_AGE,
    staleExpire: positiveOrZero('Redis.staleExpire', MAX_PRODUCT_AGE),
    notFoundExpire: positiveOrZero('Redis.notFoundExpire', 3600),
  };

  const amazon: AmazonSettings = {
    credentialId: source.get<string>('Amazon.credentialId'),
    credentialSecret: source.get<string>('Amazon.credentialSecret'),
    version: source.get<string>('Amazon.version'),
    partnerTag: source.get<string>('Amazon.partnerTag'),
    marketplace: source.get<string>('Amazon.marketplace'),
    condition: source.get<string>('Amazon.condition'),
    apiBasePath: optional('Amazon.apiBasePath', ''),
    authEndpoint: optional('Amazon.authEndpoint', ''),
    breakerThreshold: positiveOrZero('Amazon.breakerThreshold', 5),
    breakerCooldown: positiveOrZero('Amazon.breakerCooldown', 60),
  };

  const admin: AdminSettings = {
    enabled: optional<unknown>('Admin.enabled', false) === true,
    insights: optional<unknown>('Admin.insights', false) === true,
    tokenTtl: optionalNumber('Admin.tokenTtl'),
    loginRateLimit: optionalNumber('Admin.loginRateLimit'),
    allowedIps: optional<string[]>('Admin.allowedIps', []),
    settingsFile: optional<string>('Admin.settingsFile', ''),
  };

  const recommendation: RecommendationSettings = {
    enabled: flag('Recommendation.enabled'),
    allowedHosts: server.allowedSites,
    dailyLimit: Number(optional<unknown>('Recommendation.dailyLimit', 100)),
    fallback: optional<unknown>('Recommendation.fallback', true) !== false,
  };

  const stuffingCount = Number(optional<unknown>('Stuffing.count', 0));
  const stuffing: StuffingConfig = {
    // A configuration file turns it on by asking for cards; the portal has its own switch
    enabled: stuffingCount > 0,
    count: stuffingCount,
    mode: optional<string>('Stuffing.mode', 'recommendation') as StuffingMode,
    containerId: optional<string>('Stuffing.containerId', 'main-content'),
    // Only set in the portal: it names products, which belong with the content rather than the deployment
    products: [],
    wordsPerCard: Number(optional<unknown>('Stuffing.wordsPerCard', 0)),
    sites: {},
    // Only set in the portal, like the products
    deals: { keywords: '', searchIndex: 'All', minSavingPercent: 20 },
  };

  const effect: EffectConfig = { mode: optional<string>('Effect.mode', 'none') as EffectMode, effects: [...WIDGET_EFFECTS] };

  const warnings: string[] = [];
  // Both listed the same sites. The old list still serves the recommendations alone: moving it to
  // Server.allowedSites would also start hiding the widget on every other site
  const legacyHosts = optional<unknown>('Recommendation.allowedHosts', []);
  if (Array.isArray(legacyHosts) && legacyHosts.length > 0) {
    if (server.allowedSites.length === 0) {
      recommendation.allowedHosts = legacyHosts as string[];
      warnings.push('Recommendation.allowedHosts is deprecated: move its hosts to Server.allowedSites, which also restricts the widget to them.');
    } else {
      warnings.push('Recommendation.allowedHosts is deprecated and ignored: Server.allowedSites is used instead. Remove it.');
    }
  }

  const settings: Settings = { server, redis, amazon, admin, recommendation, stuffing, effect, warnings };
  validateSettings(settings);
  return settings;
}

function validateSettings({ server, redis, admin, recommendation, stuffing, effect }: Settings): void {
  if (server.port < 1 || server.port > 65535) {
    throw new Error(`Invalid port configuration: ${server.port}. Must be between 1 and 65535.`);
  }
  if (!server.path.startsWith('/')) {
    throw new Error(`Invalid relative path: ${server.path}. Must start with '/'.`);
  }
  if (server.httpCache < 0) {
    throw new Error(`Invalid HTTP cache configuration: ${server.httpCache}. Must be >= 0.`);
  }
  if (!server.projectDir) {
    throw new Error('Server.projectDir configuration is required');
  }
  if (!WIDGET_THEMES.includes(server.theme)) {
    throw new Error(`Invalid Server.theme: ${server.theme}. Must be one of: ${WIDGET_THEMES.join(', ')}.`);
  }
  // A URL or a capital would never match URL.host: the list would block every site, silently
  if (!Array.isArray(server.allowedSites) || !server.allowedSites.every(site => typeof site === 'string' && SITE_HOST.test(site))) {
    throw new Error(`Invalid Server.allowedSites: ${JSON.stringify(server.allowedSites)}. Must be a list of lowercase hosts such as www.example.com.`);
  }
  // Fails at startup: a typo would otherwise lock every admin out, or let everyone in
  if (!Array.isArray(admin.allowedIps) || !admin.allowedIps.every(rule => parseIpRule(rule) !== null)) {
    throw new Error(`Invalid Admin.allowedIps: ${JSON.stringify(admin.allowedIps)}. Must be a list of IP addresses or CIDR ranges such as 192.0.2.10 or 10.0.0.0/8.`);
  }
  if (typeof admin.settingsFile !== 'string') {
    throw new Error(`Invalid Admin.settingsFile: ${JSON.stringify(admin.settingsFile)}. Must be a file path.`);
  }
  // Fails at startup rather than at the first save of the portal, which would then be lost
  if (admin.settingsFile) {
    try {
      accessSync(dirname(admin.settingsFile), constants.W_OK);
    } catch {
      throw new Error(`Invalid Admin.settingsFile: ${admin.settingsFile}. Its directory must exist and be writable by the server.`);
    }
  }
  if (!EFFECT_MODES.includes(effect.mode)) {
    throw new Error(`Invalid Effect.mode: ${effect.mode}. Must be one of: ${EFFECT_MODES.join(', ')}.`);
  }
  if (!Number.isInteger(stuffing.count) || stuffing.count < 0 || stuffing.count > MAX_STUFFED_CARDS) {
    throw new Error(`Invalid Stuffing.count: ${stuffing.count}. Must be an integer between 0 and ${MAX_STUFFED_CARDS}.`);
  }
  if (!Number.isInteger(stuffing.wordsPerCard) || stuffing.wordsPerCard < 0 || stuffing.wordsPerCard > MAX_WORDS_PER_CARD) {
    throw new Error(`Invalid Stuffing.wordsPerCard: ${stuffing.wordsPerCard}. Must be an integer between 0 and ${MAX_WORDS_PER_CARD}.`);
  }
  if (typeof stuffing.containerId !== 'string' || !CONTAINER_ID.test(stuffing.containerId)) {
    throw new Error(`Invalid Stuffing.containerId: ${stuffing.containerId}. Must be an HTML id.`);
  }
  if (!STUFFING_MODES.includes(stuffing.mode)) {
    throw new Error(`Invalid Stuffing.mode: ${stuffing.mode}. Must be one of: ${STUFFING_MODES.join(', ')}.`);
  }
  // Only recommended cards call the AI model: popular, manual and deals ones never do
  if (stuffing.count > 0 && stuffing.mode === 'recommendation' && !recommendation.enabled) {
    throw new Error('Stuffing.count requires Recommendation.enabled, or Stuffing.mode popular, manual or deals: stuffed cards show recommended products');
  }
  if (recommendation.enabled) {
    // Each of these would let every visit of a page, or anyone on the Internet, spend Claude credits
    if (!redis.enabled) {
      throw new Error('Recommendation.enabled requires Redis: recommendations would never be remembered');
    }
    if (!Array.isArray(recommendation.allowedHosts) || recommendation.allowedHosts.length === 0) {
      throw new Error('Recommendation.enabled requires Server.allowedSites: the sites allowed to spend Claude credits');
    }
    if (!Number.isInteger(recommendation.dailyLimit) || recommendation.dailyLimit <= 0) {
      throw new Error('Recommendation.dailyLimit must be a positive integer');
    }
  }
  if (redis.expire <= 0) {
    throw new Error('Redis.expire must be a positive number');
  }
}

/**
 * Effective settings shown in the administration portal.
 *
 * An explicit list rather than a walk through the settings: a key added later, secret or not,
 * stays private until someone decides to show it. Local paths and the endpoints of the test
 * mocks are left out on purpose.
 */
function describeSettings({ server, redis, amazon, admin, recommendation }: Settings, env: NodeJS.ProcessEnv): SettingsSection[] {
  type Value = string | number | boolean | string[] | undefined | null;
  const value = (key: string, envName: string | null, description: string, setting: Value): SettingEntry =>
    ({ key, env: envName, description, value: setting ?? null });
  const secret = (key: string, envName: string | null, description: string, setting: unknown, envOnly = false): SettingEntry =>
    ({ key, env: envName, description, secret: true, configured: Boolean(setting), ...(envOnly ? { envOnly } : {}) });

  // Recommendation.allowedHosts is left out: deprecated, it is reported by a warning at startup
  const recommendationEntries: SettingEntry[] = [
    value('Recommendation.enabled', 'AMW_RECOMMENDATION_ENABLED', 'Widgets without an id get a product chosen by Claude from the page content.', recommendation.enabled),
    value('Recommendation.dailyLimit', 'AMW_RECOMMENDATION_DAILY_LIMIT', 'Maximum Claude calls per UTC day, to bound the bill.', recommendation.dailyLimit),
    value('Recommendation.fallback', 'AMW_RECOMMENDATION_FALLBACK', 'Pages without a chosen product show the most clicked product of their site.', recommendation.fallback),
  ];

  return [
    {
      title: 'Server',
      entries: [
        value('Server.port', 'SERVER_PORT', 'TCP port the server listens on.', server.port),
        value('Server.path', 'SERVER_PATH', 'URL prefix of every route, such as /item.', server.path),
        value('Server.debug', 'SERVER_DEBUG', 'Verbose logs, for troubleshooting.', server.debug),
        value('Server.cors', 'SERVER_CORS', 'Lets pages of other origins call the API (CORS headers).', server.cors),
        value('Server.httpCache', null, 'Seconds browsers and CDNs may cache product responses.', server.httpCache),
        value('Server.rateLimit', 'SERVER_RATE_LIMIT', 'Product requests allowed per IP and per minute.', server.rateLimit),
        value('Server.clickRateLimit', 'SERVER_CLICK_RATE_LIMIT', 'Click reports allowed per IP and per minute.', server.clickRateLimit),
        value('Server.viewRateLimit', 'SERVER_VIEW_RATE_LIMIT', 'View reports allowed per IP and per minute.', server.viewRateLimit),
        value('Server.metrics', 'SERVER_METRICS', 'Serves Prometheus metrics at <path>/metrics.', server.metrics),
        value('Server.swagger', 'SERVER_SWAGGER', 'Serves the API documentation (Swagger UI) at <path>/docs/.', server.swagger),
        value('Server.trustProxy', 'SERVER_TRUST_PROXY', 'Proxies trusted to give the client IP (X-Forwarded-For): a hop count or their addresses.', server.trustProxy),
        value('Server.theme', 'SERVER_THEME', 'Default look of the widgets.', server.theme),
        value('Server.allowedSites', 'SERVER_ALLOWED_SITES', 'Your sites: the only ones that may show the widget and get recommendations. Empty allows every site, without recommendations. The Sites page starts from this list and replaces it once saved.', server.allowedSites),
      ],
    },
    {
      title: 'Redis',
      entries: [
        value('Redis.enabled', 'REDIS_ENABLED', 'Caches products and keeps statistics and recommendations in Redis.', redis.enabled),
        value('Redis.host', 'REDIS_HOST', 'Redis server name or address.', redis.host),
        value('Redis.port', 'REDIS_PORT', 'Redis server port.', redis.port),
        secret('Redis.username', 'REDIS_USERNAME', 'Redis user (ACL), if any.', redis.username),
        secret('Redis.password', 'REDIS_PASSWORD', 'Redis password, if any.', redis.password),
        value('Redis.expire', null, 'Seconds before a cached product is refreshed from Amazon.', redis.expire),
        value('Redis.staleExpire', 'REDIS_STALE_EXPIRE', 'Seconds an outdated product is still shown while Amazon is unavailable.', redis.staleExpire),
        value('Redis.notFoundExpire', 'REDIS_NOT_FOUND_EXPIRE', 'Seconds a product unknown to Amazon is remembered as such.', redis.notFoundExpire),
      ],
    },
    {
      title: 'Amazon',
      entries: [
        secret('Amazon.credentialId', 'AMAZON_CREDENTIAL_ID', 'Creators API credential ID.', amazon.credentialId),
        secret('Amazon.credentialSecret', 'AMAZON_CREDENTIAL_SECRET', 'Creators API credential secret.', amazon.credentialSecret),
        value('Amazon.version', 'AMAZON_CREDENTIAL_VERSION', 'Credential version given by Amazon with the credentials.', amazon.version),
        value('Amazon.partnerTag', 'AMAZON_PARTNER_TAG', 'Your Associates tag, added to every product link.', amazon.partnerTag),
        value('Amazon.marketplace', 'AMAZON_MARKETPLACE', 'Amazon store of the products, such as www.amazon.fr.', amazon.marketplace),
        value('Amazon.condition', null, 'Condition of the offers shown (New, Any…).', amazon.condition),
        value('Amazon.breakerThreshold', 'AMAZON_BREAKER_THRESHOLD', 'Consecutive Amazon failures before calls pause.', amazon.breakerThreshold),
        value('Amazon.breakerCooldown', 'AMAZON_BREAKER_COOLDOWN', 'Seconds calls to Amazon pause after those failures.', amazon.breakerCooldown),
      ],
    },
    {
      title: 'Administration',
      entries: [
        value('Admin.enabled', 'AMW_ADMIN_ENABLED', 'Serves this portal.', admin.enabled),
        secret('Admin.password', 'AMW_ADMIN_PASSWORD', 'Password of this portal, 12 characters at least.', env.AMW_ADMIN_PASSWORD, true),
        secret('Admin.secret', 'AMW_ADMIN_SECRET', 'Signing key of the sessions; without it every restart logs you out.', env.AMW_ADMIN_SECRET, true),
        value('Admin.tokenTtl', 'AMW_ADMIN_TOKEN_TTL', 'Session lifetime, in seconds.', admin.tokenTtl),
        value('Admin.loginRateLimit', 'AMW_ADMIN_LOGIN_RATE_LIMIT', 'Failed logins allowed per IP every 15 minutes.', admin.loginRateLimit),
        value('Admin.allowedIps', 'AMW_ADMIN_ALLOWED_IPS', 'IP addresses or CIDR ranges allowed to reach this portal; empty allows every address.', admin.allowedIps),
        value('Admin.settingsFile', 'AMW_ADMIN_SETTINGS_FILE', 'JSON file holding the settings changed in this portal; empty keeps them in Redis.', admin.settingsFile),
        value('Admin.insights', 'AMW_ADMIN_INSIGHTS', 'AI insights written by Claude from the statistics.', admin.insights),
      ],
    },
    {
      title: 'Recommendation',
      entries: recommendationEntries,
    },
    {
      title: 'Anthropic',
      entries: [
        secret('Anthropic.apiKey', 'ANTHROPIC_API_KEY', 'Claude API key, used by the recommendations and the insights.', env.ANTHROPIC_API_KEY, true),
      ],
    },
  ];
}

/** The searches of deals mode: those of the Best deals view, or the single search of older values. */
function dealSearchesOf(stuffing: Pick<StuffingConfig, 'deals' | 'dealSearches'>): DealSearch[] {
  if (stuffing.dealSearches && stuffing.dealSearches.length > 0) return stuffing.dealSearches;
  return stuffing.deals?.keywords ? [{ ...stuffing.deals, maxProducts: MAX_DEAL_PRODUCTS }] : [];
}

export { BANNER_ID, BANNER_PREFIX, BUTTON_LABELS, CONTAINER_ID, STUFFING_SOURCES, MAX_DEAL_SEARCHES, MAX_DEAL_PRODUCTS, dealSearchesOf, MAX_DEAL_SAVING, MIN_DEAL_SAVING, SEARCH_INDEX, describeSettings, EFFECT_MODES, WIDGET_EFFECTS, loadSettings, MAX_STUFFED_CARDS, MAX_STUFFING_PRODUCTS, MAX_STUFFING_SITES, MAX_WORDS_PER_CARD, MAX_PRODUCT_AGE, PARTNER_TAG, SITE_HOST, STUFFING_MODES, THEME_TEST_MODES, WIDGET_THEMES };
export type { Banner, ButtonLabel, ButtonLabelConfig, StuffingSource, DealSearch, ConfigSource, DealsConfig, EffectConfig, EffectMode, PartnerTagsConfig, StuffingConfig, StuffingMode, ThemeTestConfig, ThemeTestMode, WidgetTheme, WidgetEffect, SettingEntry, Settings, SettingsSection, ServerSettings, RedisSettings, AmazonSettings, AdminSettings, RecommendationSettings };
