/**
 * Typed server settings, read and validated once from the configuration.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

/** The part of node-config used here, so that tests can pass a plain object instead. */
interface ConfigSource {
  get<T = unknown>(key: string): T;
  has(key: string): boolean;
}

// Must match THEMES in src/widgets/widget.js and the files of src/widgets/themes/
const WIDGET_THEMES = ['default', 'native', 'shelf', 'receipt', 'blueprint', 'outdoor', 'terminal', 'magazine', 'pastel', 'neon'] as const;
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
}

interface RecommendationSettings {
  /** Widgets without an id, through the Claude API (the key stays in ANTHROPIC_API_KEY). */
  enabled: boolean;
  /** Hostnames of the pages that may trigger a paid call. */
  allowedHosts: string[];
  /** Maximum paid calls per UTC day. */
  dailyLimit: number;
  /** Shows the most clicked product of the site on pages without a product. */
  fallback: boolean;
}

interface StuffingConfig {
  /** Cards widget.js adds to each article; 0 adds none. */
  count: number;
  /** The id of the element holding the article. */
  containerId: string;
}

interface EffectConfig {
  mode: EffectMode;
}

interface Settings {
  server: ServerSettings;
  redis: RedisSettings;
  amazon: AmazonSettings;
  admin: AdminSettings;
  recommendation: RecommendationSettings;
  stuffing: StuffingConfig;
  effect: EffectConfig;
}

/** A secret only says whether it is set: its value never leaves the server. */
type SettingEntry =
  | { key: string; secret: true; configured: boolean }
  | { key: string; secret?: false; value: string | number | boolean | string[] | null };

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

const DEFAULT_PORT = 8080;
// More cards would turn an article into an advertisement
const MAX_STUFFED_CARDS = 5;
// Prepended to widget.js and given to getElementById: an HTML id without anything to interpret
const CONTAINER_ID = /^[A-Za-z][\w-]{0,63}$/;
const SITE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$/;
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
    expire: Number(source.get('Redis.expire')) || 3600,
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
  };

  const recommendation: RecommendationSettings = {
    enabled: flag('Recommendation.enabled'),
    allowedHosts: optional<string[]>('Recommendation.allowedHosts', []),
    dailyLimit: Number(optional<unknown>('Recommendation.dailyLimit', 100)),
    fallback: optional<unknown>('Recommendation.fallback', true) !== false,
  };

  const stuffing: StuffingConfig = {
    count: Number(optional<unknown>('Stuffing.count', 0)),
    containerId: optional<string>('Stuffing.containerId', 'main-content'),
  };

  const effect: EffectConfig = { mode: optional<string>('Effect.mode', 'none') as EffectMode };

  const settings: Settings = { server, redis, amazon, admin, recommendation, stuffing, effect };
  validateSettings(settings);
  return settings;
}

function validateSettings({ server, redis, recommendation, stuffing, effect }: Settings): void {
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
  if (!EFFECT_MODES.includes(effect.mode)) {
    throw new Error(`Invalid Effect.mode: ${effect.mode}. Must be one of: ${EFFECT_MODES.join(', ')}.`);
  }
  if (!Number.isInteger(stuffing.count) || stuffing.count < 0 || stuffing.count > MAX_STUFFED_CARDS) {
    throw new Error(`Invalid Stuffing.count: ${stuffing.count}. Must be an integer between 0 and ${MAX_STUFFED_CARDS}.`);
  }
  if (typeof stuffing.containerId !== 'string' || !CONTAINER_ID.test(stuffing.containerId)) {
    throw new Error(`Invalid Stuffing.containerId: ${stuffing.containerId}. Must be an HTML id.`);
  }
  if (stuffing.count > 0 && !recommendation.enabled) {
    throw new Error('Stuffing.count requires Recommendation.enabled: stuffed cards show recommended products');
  }
  if (recommendation.enabled) {
    // Each of these would let every visit of a page, or anyone on the Internet, spend Claude credits
    if (!redis.enabled) {
      throw new Error('Recommendation.enabled requires Redis: recommendations would never be remembered');
    }
    if (!Array.isArray(recommendation.allowedHosts) || recommendation.allowedHosts.length === 0) {
      throw new Error('Recommendation.enabled requires Recommendation.allowedHosts: the sites allowed to spend Claude credits');
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
  const value = (key: string, setting: string | number | boolean | string[] | undefined | null): SettingEntry =>
    ({ key, value: setting ?? null });
  const secret = (key: string, setting: unknown): SettingEntry => ({ key, secret: true, configured: Boolean(setting) });

  return [
    {
      title: 'Server',
      entries: [
        value('Server.port', server.port),
        value('Server.path', server.path),
        value('Server.debug', server.debug),
        value('Server.cors', server.cors),
        value('Server.httpCache', server.httpCache),
        value('Server.rateLimit', server.rateLimit),
        value('Server.clickRateLimit', server.clickRateLimit),
        value('Server.viewRateLimit', server.viewRateLimit),
        value('Server.metrics', server.metrics),
        value('Server.swagger', server.swagger),
        value('Server.trustProxy', server.trustProxy),
        value('Server.theme', server.theme),
        value('Server.allowedSites', server.allowedSites),
      ],
    },
    {
      title: 'Redis',
      entries: [
        value('Redis.enabled', redis.enabled),
        value('Redis.host', redis.host),
        value('Redis.port', redis.port),
        secret('Redis.username', redis.username),
        secret('Redis.password', redis.password),
        value('Redis.expire', redis.expire),
        value('Redis.staleExpire', redis.staleExpire),
        value('Redis.notFoundExpire', redis.notFoundExpire),
      ],
    },
    {
      title: 'Amazon',
      entries: [
        secret('Amazon.credentialId', amazon.credentialId),
        secret('Amazon.credentialSecret', amazon.credentialSecret),
        value('Amazon.version', amazon.version),
        value('Amazon.partnerTag', amazon.partnerTag),
        value('Amazon.marketplace', amazon.marketplace),
        value('Amazon.condition', amazon.condition),
        value('Amazon.breakerThreshold', amazon.breakerThreshold),
        value('Amazon.breakerCooldown', amazon.breakerCooldown),
      ],
    },
    {
      title: 'Administration',
      entries: [
        value('Admin.enabled', admin.enabled),
        value('Admin.insights', admin.insights),
        value('Admin.tokenTtl', admin.tokenTtl),
        value('Admin.loginRateLimit', admin.loginRateLimit),
        secret('AMW_ADMIN_PASSWORD', env.AMW_ADMIN_PASSWORD),
        secret('AMW_ADMIN_SECRET', env.AMW_ADMIN_SECRET),
        secret('ANTHROPIC_API_KEY', env.ANTHROPIC_API_KEY),
      ],
    },
    {
      title: 'Recommendation',
      entries: [
        value('Recommendation.enabled', recommendation.enabled),
        value('Recommendation.allowedHosts', recommendation.allowedHosts),
        value('Recommendation.dailyLimit', recommendation.dailyLimit),
        value('Recommendation.fallback', recommendation.fallback),
      ],
    },
  ];
}

export { CONTAINER_ID, describeSettings, EFFECT_MODES, WIDGET_EFFECTS, loadSettings, MAX_STUFFED_CARDS, MAX_PRODUCT_AGE, WIDGET_THEMES };
export type { ConfigSource, EffectConfig, EffectMode, StuffingConfig, WidgetEffect, SettingEntry, Settings, SettingsSection, ServerSettings, RedisSettings, AmazonSettings, AdminSettings, RecommendationSettings };
