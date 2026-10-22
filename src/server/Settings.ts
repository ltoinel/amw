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
  metrics: boolean;
  swagger: boolean;
  /** Express "trust proxy" value; must match the real proxy chain or client IPs can be spoofed. */
  trustProxy: string | number | boolean | string[];
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
  /** Undefined lets AdminApi apply its own default. */
  tokenTtl?: number;
  loginRateLimit?: number;
}

interface Settings {
  server: ServerSettings;
  redis: RedisSettings;
  amazon: AmazonSettings;
  admin: AdminSettings;
}

const DEFAULT_PORT = 8080;
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
    metrics: flag('Server.metrics'),
    swagger: flag('Server.swagger'),
    trustProxy: optional<ServerSettings['trustProxy']>('Server.trustProxy', false),
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
    tokenTtl: optionalNumber('Admin.tokenTtl'),
    loginRateLimit: optionalNumber('Admin.loginRateLimit'),
  };

  const settings: Settings = { server, redis, amazon, admin };
  validateSettings(settings);
  return settings;
}

function validateSettings({ server, redis }: Settings): void {
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
  if (redis.expire <= 0) {
    throw new Error('Redis.expire must be a positive number');
  }
}

export { loadSettings, MAX_PRODUCT_AGE };
export type { ConfigSource, Settings, ServerSettings, RedisSettings, AmazonSettings, AdminSettings };
