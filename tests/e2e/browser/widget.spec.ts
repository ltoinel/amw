/**
 * Browser end-to-end tests: a third-party page embeds the widget exactly like
 * a blog would, and Chromium renders it against the real server and mock API.
 */

import { expect, Page, test } from '@playwright/test';
import { AmwServer, startAmwServer } from '../support/amwServer';
import { ASIN_MALICIOUS, MALICIOUS_TITLE, MockAmazonApi, startMockAmazonApi } from '../support/mockAmazonApi';

// widget.js derives its API URL from window.location.origin + "/item",
// so the server must use that path and the page must share its origin.
const WIDGET_PATH = '/item';

let mock: MockAmazonApi;
let amw: AmwServer;

test.beforeAll(async () => {
  mock = await startMockAmazonApi();
  amw = await startAmwServer({ mockApiUrl: mock.url, config: { Server: { path: WIDGET_PATH } } });
});

test.afterAll(async () => {
  await amw?.stop();
  await mock?.close();
});

/**
 * Serve a static article from the AMW origin (intercepted, nothing on disk)
 * and fail the test on any dialog, the usual XSS proof-of-concept signal.
 */
async function openArticle(page: Page, widgetsHtml: string): Promise<void> {
  const articleUrl = `${amw.origin}/blog/article.html`;
  await page.route(articleUrl, route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html>
      <html lang="en">
        <head><meta charset="utf-8"><title>My blog post</title></head>
        <body>
          <h1>My favourite gadget</h1>
          ${widgetsHtml}
          <script src="${WIDGET_PATH}/widget.js"></script>
        </body>
      </html>`
  }));
  page.on('dialog', dialog => {
    throw new Error(`Unexpected dialog: ${dialog.message()}`);
  });
  await page.goto(articleUrl);
}

async function expectNoScriptInjection(page: Page): Promise<void> {
  expect(await page.evaluate(() => (window as unknown as { __amwXss?: boolean }).__amwXss)).toBeUndefined();
}

test('renders the product card of an embedded widget', async ({ page }) => {
  await openArticle(page, '<div class="amw" id="B08N5WRWNW"></div>');

  const widget = page.locator('#B08N5WRWNW');
  await expect(widget.locator('.amw-widget-caption')).toHaveText('E2E product B08N5WRWNW');
  await expect(widget.locator('.amw-widget-price')).toContainText('49,99 €');
  await expect(widget.locator('.amw-widget-badge')).toContainText('-17%');

  const link = widget.locator('a.amw-widget-main-link');
  await expect(link).toHaveAttribute('href', /^https:\/\/www\.amazon\.fr\/dp\/B08N5WRWNW\?tag=e2e-21/);
  await expect(link).toHaveAttribute('rel', /\bsponsored\b/);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(widget.locator('img.amw-widget-img')).toHaveAttribute('src', /^https:\/\//);
});

test('neutralizes javascript: URLs and HTML returned by the API', async ({ page }) => {
  await openArticle(page, `<div class="amw" id="${ASIN_MALICIOUS}"></div>`);

  const widget = page.locator(`#${ASIN_MALICIOUS}`);
  const caption = widget.locator('.amw-widget-caption');
  await expect(caption).toHaveText(MALICIOUS_TITLE);
  await expect(caption.locator('img')).toHaveCount(0);

  // safeUrl() falls back to inert values instead of keeping the javascript: URLs
  await expect(widget.locator('a.amw-widget-main-link')).toHaveAttribute('href', '#');
  await expect(widget.locator('img.amw-widget-img')).toHaveAttribute('src', '');
  await expectNoScriptInjection(page);
});

test('does not execute markup smuggled in the element id', async ({ page }) => {
  const maliciousId = '"><img src=x onerror="window.__amwXss=true">';
  const escapedId = maliciousId.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  await openArticle(page, `<div class="amw" id="${escapedId}"></div>`);

  // The server strips the markup characters, so the API is queried with harmless text
  const widget = page.locator('div.amw-widget').first();
  await expect(widget.locator('.amw-widget-caption')).toHaveText('E2E product img src=x onerror=window.__amwXss=true');
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expectNoScriptInjection(page);
});

test('styles the card with the stylesheet served next to widget.js', async ({ page }) => {
  const stylesheet = page.waitForResponse(response => /\/widget(\.[0-9a-f]{10})?\.css$/.test(new URL(response.url()).pathname));
  await openArticle(page, '<div class="amw" id="B08N5WRWNW"></div>');

  expect((await stylesheet).status()).toBe(200);
  const widget = page.locator('#B08N5WRWNW');
  await expect(widget.locator('.amw-widget-caption')).toHaveText('E2E product B08N5WRWNW');
  await expect(widget).toHaveCSS('border-radius', '12px');
  await expect(page.locator('style')).toHaveCount(0);
});
