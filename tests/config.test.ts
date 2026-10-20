/**
 * Loads the committed config/ directory through the real node-config, the way the server does at
 * startup, so that an upgrade of node-config or of its YAML parser cannot silently change the
 * values or their types (the server compares booleans and numbers with strict equality).
 */

import { execFileSync } from 'child_process';
import path from 'path';

const ROOT = path.join(__dirname, '..');

const KEYS = [
  'Server.port', 'Server.debug', 'Server.path', 'Server.cors', 'Server.rateLimit', 'Server.trustProxy',
  'Server.httpCache', 'Redis.enabled', 'Redis.host', 'Redis.port', 'Redis.password', 'Redis.expire',
  'Amazon.credentialId', 'Amazon.version', 'Amazon.marketplace'
];

// A child process because node-config reads NODE_ENV, NODE_CONFIG and the environment once, when
// first required, and Jest's module registry cannot load its ESM entry point
function loadConfig(env: Record<string, string>): Record<string, unknown> {
  const script = `
    const config = require('config');
    const keys = ${JSON.stringify(KEYS)};
    process.stdout.write(JSON.stringify(Object.fromEntries(keys.map((k) => [k, config.get(k)]))));
  `;
  // Start from a clean environment so that variables of the developer's shell or CI do not leak in
  const output = execFileSync(process.execPath, ['-e', script], {
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? '', NODE_CONFIG_DIR: path.join(ROOT, 'config'), ...env },
    encoding: 'utf8'
  });
  return JSON.parse(output);
}

describe('configuration loading', () => {
  it('reads config/docker.yml with the expected types', () => {
    expect(loadConfig({ NODE_ENV: 'docker' })).toEqual({
      'Server.port': 9080,
      'Server.debug': false,
      'Server.path': '/item',
      'Server.cors': false,
      'Server.rateLimit': 120,
      'Server.trustProxy': 1,
      'Server.httpCache': 604800,
      'Redis.enabled': false,
      'Redis.host': 'localhost',
      'Redis.port': 6379,
      'Redis.password': '',
      'Redis.expire': 2630000,
      'Amazon.credentialId': '',
      'Amazon.version': '3.2',
      'Amazon.marketplace': 'www.amazon.fr'
    });
  });

  it('reads config/development.yml', () => {
    expect(loadConfig({ NODE_ENV: 'development' })).toMatchObject({
      'Server.port': 8080,
      'Server.debug': true,
      'Server.path': '/amw',
      'Server.trustProxy': false,
      'Redis.enabled': false
    });
  });

  it('maps environment variables, parsing the __format: json ones', () => {
    const config = loadConfig({
      NODE_ENV: 'docker',
      SERVER_PORT: '1234',
      SERVER_DEBUG: 'true',
      SERVER_CORS: 'true',
      SERVER_PATH: '/custom',
      SERVER_RATE_LIMIT: '10',
      REDIS_ENABLED: 'true',
      REDIS_HOST: 'redis',
      REDIS_PORT: '6380',
      AMAZON_CREDENTIAL_ID: 'id-from-env'
    });

    expect(config).toMatchObject({
      'Server.port': 1234,
      'Server.debug': true,
      'Server.cors': true,
      'Server.path': '/custom',
      'Server.rateLimit': 10,
      'Redis.enabled': true,
      'Redis.host': 'redis',
      'Redis.port': 6380,
      'Amazon.credentialId': 'id-from-env'
    });
  });

  it('keeps the YAML value when a mapped variable is empty', () => {
    expect(loadConfig({ NODE_ENV: 'docker', REDIS_HOST: '', SERVER_PORT: '' })).toMatchObject({
      'Redis.host': 'localhost',
      'Server.port': 9080
    });
  });

  it('applies NODE_CONFIG over the YAML files, and mapped variables over NODE_CONFIG', () => {
    const config = loadConfig({
      NODE_ENV: 'docker',
      NODE_CONFIG: JSON.stringify({ Server: { rateLimit: 5, port: 7000 }, Redis: { expire: 60 } }),
      SERVER_PORT: '7001'
    });

    expect(config).toMatchObject({
      'Server.rateLimit': 5,
      'Redis.expire': 60,
      'Server.port': 7001
    });
  });
});
