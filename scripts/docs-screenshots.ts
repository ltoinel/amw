/**
 * Documentation screenshots
 * ----------------------------------------------
 * Captures the images of the user guide (docs/assets/screenshots/) from the
 * real compiled server, the real widget and the end-to-end mock Amazon API,
 * so they always show what the code actually renders.
 *
 * Usage: npm run docs:screenshots (builds first; needs Playwright Chromium:
 * npx playwright install --with-deps chromium; on Linux the widget's emoji
 * labels also need an emoji font such as fonts-noto-color-emoji).
 */

import fs from 'fs';
import path from 'path';
import { Browser, chromium, Page } from '@playwright/test';
import { AmwServer, PROJECT_DIR, startAmwServer } from '../tests/e2e/support/amwServer';
import { ASIN_NOT_FOUND, CatalogEntry, MockAmazonApi, startMockAmazonApi } from '../tests/e2e/support/mockAmazonApi';

const OUTPUT_DIR = path.join(PROJECT_DIR, 'docs', 'assets', 'screenshots');

// widget.js calls window.location.origin + "/item", so the server uses that path
const WIDGET_PATH = '/item';

const ASIN_HEADPHONES = 'B0DOCS0001';
const ASIN_KEYBOARD = 'B0DOCS0002';
const ASIN_WATCH = 'B0DOCS0003';
const ASIN_LAZY = 'B0DOCS0004';

const CATALOG: Record<string, CatalogEntry> = {
  [ASIN_HEADPHONES]: { title: 'Wireless Noise Cancelling Headphones, 40 h battery', brand: 'Acme Audio', price: '89,99 €', savings: 25 },
  [ASIN_KEYBOARD]: { title: 'Compact Mechanical Keyboard with RGB Backlight', brand: 'KeyCraft', price: '59,90 €' },
  [ASIN_WATCH]: { title: 'Smartwatch with Heart Rate and GPS Tracking', brand: 'Pulse' }
};

// Product images normally come from Amazon's CDN; the mock points there, so
// these requests are answered with simple illustrations instead.
const ILLUSTRATIONS: Record<string, string> = {
  [ASIN_HEADPHONES]: `
    <path d="M120 300v-60a130 130 0 0 1 260 0v60" fill="none" stroke="#3f3d56" stroke-width="26" stroke-linecap="round"/>
    <rect x="90" y="270" width="80" height="130" rx="34" fill="#5c6bc0"/>
    <rect x="330" y="270" width="80" height="130" rx="34" fill="#5c6bc0"/>`,
  [ASIN_KEYBOARD]: `
    <rect x="60" y="170" width="380" height="170" rx="22" fill="#3f3d56"/>
    ${Array.from({ length: 4 }, (_, row) => Array.from({ length: 10 }, (_, col) =>
      `<rect x="${80 + col * 35}" y="${188 + row * 35}" width="27" height="27" rx="6" fill="${['#ff8a65', '#ffd54f', '#81c784', '#64b5f6'][row]}"/>`
    ).join('')).join('')}`,
  [ASIN_WATCH]: `
    <rect x="200" y="60" width="100" height="380" rx="30" fill="#3f3d56"/>
    <rect x="160" y="150" width="180" height="200" rx="44" fill="#263238"/>
    <rect x="178" y="168" width="144" height="164" rx="32" fill="#26a69a"/>
    <path d="M200 255h30l15-30 20 55 15-25h20" fill="none" stroke="#fff" stroke-width="9" stroke-linejoin="round"/>`
};

function productImage(asin: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e8eaf6"/>
    </linearGradient></defs>
    <rect width="500" height="500" fill="url(#bg)"/>
    ${ILLUSTRATIONS[asin] ?? ''}
  </svg>`;
}

const ARTICLE_STYLE = `
  body { margin: 0; background: #f6f7fb; font: 17px/1.6 Inter, "Segoe UI", Roboto, sans-serif; color: #1f2333; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 28px 24px; background: #fff; }
  h1 { font-size: 30px; margin: 0 0 8px; }
  .meta { color: #6b7080; font-size: 14px; margin-bottom: 24px; }
  p { margin: 16px 0; }`;

interface ArticleOptions {
  lang?: string;
  widgets: string[];
  intro?: string;
}

/**
 * Serve a blog article from the AMW origin (intercepted, nothing on disk),
 * embedding the widget exactly as the integration guide recommends.
 */
async function openArticle(page: Page, amw: AmwServer, options: ArticleOptions): Promise<void> {
  const url = `${amw.origin}/blog/article.html`;
  const body = options.widgets
    .map((asin, index) => `<p>${index === 0 ? (options.intro ?? '') : 'Another product worth a look:'}</p><div class="amw" id="${asin}"></div>`)
    .join('\n');
  await page.route(url, route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html>
      <html lang="${options.lang ?? 'en'}">
        <head>
          <meta charset="utf-8"><title>My blog post</title>
          <style>${ARTICLE_STYLE}</style>
          <script src="${WIDGET_PATH}/widget.js" defer></script>
        </head>
        <body><main>
          <h1>My home office setup</h1>
          <div class="meta">Published on 20 October 2026 · 4 min read</div>
          ${body}
        </main></body>
      </html>`
  }));
  await page.goto(url);
}

async function newPage(browser: Browser, width: number, height: number, locale = 'en-US'): Promise<Page> {
  // The widget formats the update date with the browser locale
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1.5, locale });
  await page.route('https://m.media-amazon.com/**', route => {
    const asin = /images\/I\/([^.]+)\./.exec(route.request().url())?.[1] ?? '';
    return route.fulfill({ contentType: 'image/svg+xml', body: productImage(asin) });
  });
  return page;
}

async function waitForCards(page: Page, count: number): Promise<void> {
  await page.waitForFunction(n => {
    const loaded = [...document.querySelectorAll<HTMLImageElement>('.amw-widget-img')]
      .filter(img => img.complete && img.naturalWidth > 0 && img.style.display === 'block');
    return loaded.length >= n;
  }, count);
}

async function capture(page: Page, name: string, selector?: string): Promise<void> {
  const file = path.join(OUTPUT_DIR, `${name}.png`);
  if (selector) {
    await page.locator(selector).screenshot({ path: file });
  } else {
    await page.screenshot({ path: file });
  }
  console.log(`  ✓ ${path.relative(PROJECT_DIR, file)}`);
}

async function main(): Promise<void> {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let mock: MockAmazonApi | undefined;
  let amw: AmwServer | undefined;
  let browser: Browser | undefined;

  try {
    mock = await startMockAmazonApi({ catalog: CATALOG });
    // Swagger UI is enabled only to capture it; the default is off
    amw = await startAmwServer({ mockApiUrl: mock.url, config: { Server: { path: WIDGET_PATH, swagger: true } } });
    browser = await chromium.launch();
    console.log('Capturing documentation screenshots:');

    // A blog article with several widgets: savings badge, regular price, no offer
    let page = await newPage(browser, 900, 1180);
    await openArticle(page, amw, {
      widgets: [ASIN_HEADPHONES, ASIN_KEYBOARD, ASIN_WATCH],
      intro: 'After two years of remote work, here is the gear I use every day.'
    });
    await waitForCards(page, 3);
    await capture(page, 'blog-article', 'main');
    await capture(page, 'product-card', `#${ASIN_HEADPHONES}`);
    await capture(page, 'product-unavailable', `#${ASIN_WATCH}`);
    await page.close();

    // Same card on a French page: labels follow <html lang>
    page = await newPage(browser, 900, 500, 'fr-FR');
    await openArticle(page, amw, { lang: 'fr', widgets: [ASIN_HEADPHONES] });
    await waitForCards(page, 1);
    await capture(page, 'product-card-fr', `#${ASIN_HEADPHONES}`);
    await page.close();

    // Lazy placeholder: shown until the card scrolls into view, so the
    // observer is stubbed out to keep it on screen
    page = await newPage(browser, 900, 500);
    await page.addInitScript(() => {
      (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
        observe(): void { /* never intersects */ }
        unobserve(): void { /* nothing observed */ }
        disconnect(): void { /* nothing observed */ }
      };
    });
    await openArticle(page, amw, { widgets: [ASIN_LAZY] });
    await page.locator(`#${ASIN_LAZY}.amw-widget-lazy`).waitFor();
    await capture(page, 'product-lazy', `#${ASIN_LAZY}`);
    await page.close();

    // Error state: AMW answers 404, the widget retries once then gives up
    page = await newPage(browser, 900, 500);
    await openArticle(page, amw, { widgets: [ASIN_NOT_FOUND] });
    await page.locator(`#${ASIN_NOT_FOUND} .amw-widget-error`).waitFor({ timeout: 15000 });
    await capture(page, 'product-error', `#${ASIN_NOT_FOUND}`);
    await page.close();

    // Swagger UI (Server.swagger: true)
    page = await newPage(browser, 1280, 900);
    await page.goto(`${amw.baseUrl}/docs/`);
    await page.locator('.swagger-ui .opblock').first().waitFor();
    await capture(page, 'swagger-ui');
    await page.close();
  } finally {
    await browser?.close();
    await amw?.stop();
    await mock?.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
