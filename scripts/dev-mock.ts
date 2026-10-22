/**
 * Development server against a mock Amazon API
 * ----------------------------------------------
 * Runs the real AMW server from the sources (tsx, restarts on changes like
 * `npm run dev`) against the end-to-end mock of the Creators API, so the API
 * and the widget can be worked on without Amazon credentials. Also serves a
 * demo page embedding widgets, magic ASINs included.
 *
 * Usage: npm run dev:mock, then open http://localhost:8082/. Ctrl+C stops everything.
 * Ports: AMW_DEV_PORT (8080), AMW_MOCK_PORT (+1), AMW_DEMO_PORT (+2).
 */

import { ChildProcess, spawn } from 'child_process';
import http from 'http';
import path from 'path';
import {
  ASIN_MALICIOUS, ASIN_NOT_FOUND, ASIN_SERVER_ERROR, CatalogEntry,
  MOCK_CREDENTIAL_ID, MOCK_CREDENTIAL_SECRET, startMockAmazonApi
} from '../tests/e2e/support/mockAmazonApi';

const PROJECT_DIR = path.resolve(__dirname, '..');
// AMW_DEV_PORT is also the host port of the Docker dev environment
const AMW_PORT = Number(process.env.AMW_DEV_PORT) || 8080;
const MOCK_PORT = Number(process.env.AMW_MOCK_PORT) || AMW_PORT + 1;
const DEMO_PORT = Number(process.env.AMW_DEMO_PORT) || AMW_PORT + 2;
// Same path as production, so URLs match the user guide (/item/product?id=...)
const AMW_PATH = '/item';
const AMW_URL = `http://localhost:${AMW_PORT}${AMW_PATH}`;

const CATALOG: Record<string, CatalogEntry> = {
  B084DN3XVN: { title: 'Wireless Noise Cancelling Headphones, 40 h battery', brand: 'Acme Audio', price: '89,99 €', savings: 25 },
  B0192CTN72: { title: 'Compact Mechanical Keyboard with RGB Backlight', brand: 'KeyCraft', price: '59,90 €' },
  B0DEMO0003: { title: 'Smartwatch with Heart Rate and GPS Tracking (no offer)', brand: 'Pulse' }
};

const DEMO_WIDGETS: Array<[string, string]> = [
  ['B084DN3XVN', 'Catalog product with a savings badge'],
  ['B0192CTN72', 'Catalog product without savings'],
  ['B0DEMO0003', 'Catalog product without offer'],
  ['B0ANYASIN1', 'Any other ASIN: generic product'],
  [ASIN_NOT_FOUND, 'Unknown to Amazon (404)'],
  [ASIN_SERVER_ERROR, 'Amazon failure (502)'],
  [ASIN_MALICIOUS, 'Malicious data, must render harmless']
];

const DEMO_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AMW demo (mock Amazon API)</title>
  <style>body { max-width: 760px; margin: 0 auto; padding: 24px 16px; font: 16px/1.5 system-ui, sans-serif; }</style>
  <script src="${AMW_URL}/widget.js" data-api-base-url="${AMW_URL}" defer></script>
</head>
<body>
  <h1>AMW demo</h1>
  <p>Served by <code>npm run dev:mock</code>; products come from the mock Amazon API.</p>
  ${DEMO_WIDGETS.map(([asin, label]) => `<h2>${label} <small>(${asin})</small></h2>\n  <div class="amw" id="${asin}"></div>`).join('\n  ')}
</body>
</html>`;

async function main(): Promise<void> {
  const mock = await startMockAmazonApi({ port: MOCK_PORT, catalog: CATALOG });

  const demo = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(DEMO_PAGE);
  });
  await new Promise<void>((resolve, reject) => {
    demo.once('error', reject);
    demo.listen(DEMO_PORT, '127.0.0.1', resolve);
  });

  // Environment variables, mapped by config/custom-environment-variables.yml, take
  // precedence over NODE_CONFIG: the mock credentials override a developer's real
  // AMAZON_* exports, which the mock would reject.
  const amw: ChildProcess = spawn(process.execPath, [
    '--watch-path=src', '--watch-path=config', '--import', 'tsx', 'src/main.ts'
  ], {
    cwd: PROJECT_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      NODE_CONFIG: JSON.stringify({
        Amazon: { apiBasePath: mock.url, authEndpoint: `${mock.url}/auth/o2/token` }
      }),
      AMAZON_CREDENTIAL_ID: MOCK_CREDENTIAL_ID,
      AMAZON_CREDENTIAL_SECRET: MOCK_CREDENTIAL_SECRET,
      AMAZON_CREDENTIAL_VERSION: '3.1',
      AMAZON_PARTNER_TAG: 'mock-21',
      AMAZON_MARKETPLACE: 'www.amazon.fr',
      SERVER_PORT: String(AMW_PORT),
      SERVER_PATH: AMW_PATH,
      SERVER_PROJECT_DIR: `${PROJECT_DIR}/`,
      // The demo page is on another origin
      SERVER_CORS: 'true',
      // Redis stays disabled (config/development.yml) unless REDIS_ENABLED=true is exported
    }
  });

  console.log(`\nMock Amazon API: ${mock.url}\nAMW server:      ${AMW_URL}\nDemo page:       http://localhost:${DEMO_PORT}/\n`);

  let stopping = false;
  const stop = async (code: number): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    if (amw.exitCode === null && amw.signalCode === null) {
      const exited = new Promise(resolve => amw.once('exit', resolve));
      amw.kill('SIGTERM');
      await exited;
    }
    demo.closeAllConnections();
    await Promise.all([mock.close(), new Promise(resolve => demo.close(resolve))]);
    process.exit(code);
  };

  // Ctrl+C also reaches the child (same process group); it shuts down on its own
  process.on('SIGINT', () => void stop(0));
  process.on('SIGTERM', () => void stop(0));
  amw.once('exit', code => void stop(code ?? 0));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
