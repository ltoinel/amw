/**
 * Shared test doubles for the server unit tests.
 *
 * Server classes built without injected settings read node-config through
 * loadSettings(), so every configuration variant needs a fresh module registry:
 * `loadModules()` resets it, installs the `config` mock and re-imports `src/`.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';

type ConfigValues = Record<string, unknown>;

export const baseConfig: ConfigValues = {
  'Amazon.credentialId': 'test-credential-id',
  'Amazon.credentialSecret': 'test-credential-secret',
  'Amazon.version': '3.2',
  'Amazon.partnerTag': 'test-21',
  'Amazon.marketplace': 'www.amazon.fr',
  'Amazon.condition': 'New',
  'Server.port': 8080,
  'Server.debug': false,
  'Server.path': '/amw',
  'Server.cors': false,
  'Server.projectDir': os.tmpdir(),
  'Server.httpCache': 3600,
  'Server.rateLimit': 120,
  'Server.trustProxy': false,
  'Redis.enabled': false,
  'Redis.host': 'localhost',
  'Redis.port': 6379,
  'Redis.username': '',
  'Redis.password': '',
  'Redis.expire': 3600,
};

/**
 * Mirrors node-config: `get()` throws on unknown keys, so a typo in src/ fails the tests.
 */
export function mockConfig(overrides: ConfigValues = {}): void {
  const values: ConfigValues = { ...baseConfig, ...overrides };
  // Keys set to undefined emulate properties that are absent from the YAML file
  for (const key of Object.keys(values)) {
    if (values[key] === undefined) delete values[key];
  }
  jest.doMock('config', () => ({
    __esModule: true,
    default: {
      get: (key: string) => {
        if (!(key in values)) {
          throw new Error(`Configuration property "${key}" is not defined`);
        }
        return values[key];
      },
      has: (key: string) => key in values,
    },
  }));
}

export interface Modules {
  AmwServer: typeof import('../../src/server/AmwServer').AmwServer;
  AmwApi: typeof import('../../src/server/AmwApi').AmwApi;
  Paapi: typeof import('../../src/server/Paapi').Paapi;
}

export function loadModules(overrides: ConfigValues = {}): Modules {
  jest.resetModules();
  mockConfig(overrides);
  return {
    AmwServer: require('../../src/server/AmwServer').AmwServer,
    AmwApi: require('../../src/server/AmwApi').AmwApi,
    Paapi: require('../../src/server/Paapi').Paapi,
  };
}

export function createLoggerMock() {
  return {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  };
}

export function createRedisMock() {
  return {
    status: 'ready',
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    exists: jest.fn().mockResolvedValue(0),
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue('OK'),
  };
}

/**
 * Item shaped like an `amazon-creators-api` GetItems/SearchItems result entry.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAmazonItem(overrides: Record<string, any> = {}) {
  return {
    asin: 'B084DN3XVN',
    detailPageURL: 'https://www.amazon.fr/dp/B084DN3XVN?tag=test-21',
    images: { primary: { large: { url: 'https://m.media-amazon.com/images/I/arduino.jpg' } } },
    itemInfo: {
      title: { displayValue: 'Arduino Uno R3' },
      byLineInfo: { brand: { displayValue: 'Arduino' } },
    },
    offersV2: {
      listings: [{ price: { money: { displayAmount: '24,99 €' }, savings: { percentage: 15 } } }],
    },
    ...overrides,
  };
}

/**
 * Project directory holding a fake built widget, as `Server.projectDir` expects.
 */
export function createProjectDir(widgetSource = '/* widget */'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amw-test-'));
  fs.mkdirSync(path.join(dir, 'dist', 'widgets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist', 'widgets', 'widget.js'), widgetSource);
  return dir;
}
