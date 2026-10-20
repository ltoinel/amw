/**
 * Spawns the compiled AMW server (dist/main.js) as a child process, so the
 * end-to-end tests exercise the real build, configuration loading and startup.
 */

import { ChildProcess, spawn } from 'child_process';
import { connect, createServer } from 'net';
import path from 'path';
import fs from 'fs';

export const PROJECT_DIR = path.resolve(__dirname, '../../..');
const MAIN_JS = path.join(PROJECT_DIR, 'dist', 'main.js');
const DEFAULT_PATH = '/amw';
const STARTUP_TIMEOUT_MS = 15000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

export interface AmwServerOptions {
  mockApiUrl: string;
  /** Merged over tests/e2e/config/e2e.yml. */
  config?: {
    Server?: Record<string, unknown>;
    Redis?: Record<string, unknown>;
  };
}

export interface AmwServer {
  /** e.g. http://127.0.0.1:12345 */
  origin: string;
  /** Origin plus Server.path, e.g. http://127.0.0.1:12345/amw */
  baseUrl: string;
  stop: () => Promise<void>;
}

/**
 * Ask the OS for a free port. The short window between closing the probe and
 * the child binding the port is an acceptable race for tests.
 */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Whether the Redis designated by REDIS_HOST/REDIS_PORT accepts connections.
 * Checked up front because the server crashes at startup if Redis is down.
 */
export function isRedisReachable(): Promise<boolean> {
  const host = process.env.REDIS_HOST;
  if (!host) {
    return Promise.resolve(false);
  }
  const port = Number(process.env.REDIS_PORT) || 6379;
  return new Promise(resolve => {
    const socket = connect({ host, port });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

export async function startAmwServer(options: AmwServerOptions): Promise<AmwServer> {
  if (!fs.existsSync(MAIN_JS)) {
    throw new Error(`${MAIN_JS} not found: run "npm run build" before the e2e tests`);
  }

  const port = await getFreePort();
  const relativePath = String(options.config?.Server?.path ?? DEFAULT_PATH);
  const runtimeConfig = {
    Amazon: {
      apiBasePath: options.mockApiUrl,
      authEndpoint: `${options.mockApiUrl}/auth/o2/token`
    },
    Server: { ...options.config?.Server, port, projectDir: PROJECT_DIR },
    Redis: { ...options.config?.Redis }
  };

  const child: ChildProcess = spawn(process.execPath, [MAIN_JS], {
    cwd: PROJECT_DIR,
    env: {
      ...process.env,
      // A dedicated config dir keeps a developer's local config/*.yml from leaking into the tests
      NODE_ENV: 'e2e',
      NODE_CONFIG_DIR: path.join(PROJECT_DIR, 'tests', 'e2e', 'config'),
      NODE_CONFIG: JSON.stringify(runtimeConfig)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  child.stdout?.on('data', chunk => { output += chunk; });
  child.stderr?.on('data', chunk => { output += chunk; });
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));

  const stop = async (): Promise<void> => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await exited;
    }
  };

  const origin = `http://127.0.0.1:${port}`;
  const baseUrl = `${origin}${relativePath}`;
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`AMW server exited during startup (code ${child.exitCode}):\n${output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return { origin, baseUrl, stop };
      }
    } catch {
      // Not listening yet
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  await stop();
  throw new Error(`AMW server not healthy after ${STARTUP_TIMEOUT_MS}ms:\n${output}`);
}
