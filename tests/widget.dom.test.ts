/**
 * @jest-environment jsdom
 *
 * Behaviour of the embeddable widget (src/widgets/widget.js) in a browser-like DOM.
 * The widget runs on third-party pages, so most cases check that API data
 * cannot inject markup or dangerous URLs.
 */

import fs from 'fs';
import path from 'path';

interface AmwWidgetApi {
  init(): void;
  transformElement(element: Element): void;
  transformLazyElement(element: Element): void;
  config: { apiBaseUrl: string; disclosure: boolean | string; api: { timeout: number }; performance: Record<string, unknown>; lazyLoading: { enabled: boolean } };
  enableLazyLoading(): void;
  disableLazyLoading(): void;
  loadAllWidgets(): void;
  destroy(): void;
  isLazyLoadingSupported(): boolean;
  setApiConfig(config: { timeout?: number; retryAttempts?: number; retryDelay?: number; maxConcurrentRequests?: number; apiBaseUrl?: string; disclosure?: boolean | string }): void;
  getCacheStats(): { cacheSize: number; activeRequests: number; cacheHitRate: number };
  clearCache(): void;
}

declare global {
  interface Window {
    AmwWidget: AmwWidgetApi;
    IntersectionObserver: typeof IntersectionObserver;
  }
}

const product = {
  asin: 'B084DN3XVN',
  title: 'Arduino Uno R3',
  brand: 'Arduino',
  image: 'https://m.media-amazon.com/images/I/arduino.jpg',
  url: 'https://www.amazon.fr/dp/B084DN3XVN?tag=test-21',
  price: '24,99 €',
  savings: 15,
  timestamp: Date.UTC(2026, 0, 1),
};

const fetchMock = jest.fn();

function respondWith(body: unknown, status = 200) {
  fetchMock.mockResolvedValue({ ok: status < 400, status, json: () => Promise.resolve(body) });
}

/**
 * The widget is an IIFE that initializes itself on load, so each test sets up
 * the page first and then evaluates a fresh copy of the script.
 */
function loadWidget(bodyHtml: string, { lang }: { lang?: string } = {}): AmwWidgetApi {
  document.head.innerHTML = '';
  // A new <body> detaches the MutationObservers left by previously loaded copies of the widget
  const body = document.createElement('body');
  body.innerHTML = bodyHtml;
  document.documentElement.replaceChild(body, document.body);
  if (lang) {
    document.documentElement.setAttribute('lang', lang);
  } else {
    document.documentElement.removeAttribute('lang');
  }
  jest.isolateModules(() => {
    require('../src/widgets/widget.js');
  });
  return window.AmwWidget;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function widget(id = 'B084DN3XVN'): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

beforeEach(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
  respondWith(product);
  // jsdom has no IntersectionObserver: widgets load immediately unless a test provides one
  delete (window as Partial<Window>).IntersectionObserver;
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  // The widget persists its product cache: every test starts a new session
  window.sessionStorage.clear();
});

afterEach(() => {
  window.AmwWidget?.destroy();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('widget rendering', () => {
  it('renders the product returned by the API', async () => {
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

    const el = widget();
    expect(fetchMock).toHaveBeenCalledWith('http://localhost/item/product?id=B084DN3XVN', expect.anything());
    expect(el.className).toBe('amw-widget');
    expect(el.querySelector('.amw-widget-caption')!.textContent).toBe('Arduino Uno R3');
    expect(el.querySelector('.amw-widget-price')!.textContent).toBe('24,99 € -15% de réduction');
    expect(el.querySelector('.amw-widget-badge')!.textContent).toBe('-15% de réduction');
    expect(el.querySelector<HTMLAnchorElement>('.amw-widget-main-link')!.href).toBe(product.url);
    expect(el.querySelector<HTMLImageElement>('.amw-widget-img')!.src).toBe(product.image);
    expect(el.querySelector<HTMLElement>('.amw-widget-spinner')!.style.display).toBe('none');
  });

  it('injects the widget stylesheet once', async () => {
    loadWidget('<div class="amw" id="A1"></div><div class="amw" id="A2"></div>');
    window.AmwWidget.init();
    await flush();

    expect(document.querySelectorAll('#amw-widget-styles')).toHaveLength(1);
  });

  it('loads the stylesheet with a <link> instead of an inline <style>', () => {
    loadWidget('<div class="amw" id="A1"></div>');

    const link = document.getElementById('amw-widget-styles') as HTMLLinkElement;
    expect(link.tagName).toBe('LINK');
    expect(link.rel).toBe('stylesheet');
    expect(document.querySelector('style')).toBeNull();
  });

  it('resolves the stylesheet next to the widget script', () => {
    const script = document.createElement('script');
    script.src = 'https://amw.example.com/amw/widget.js?v=1';
    Object.defineProperty(document, 'currentScript', { configurable: true, get: () => script });
    try {
      loadWidget('<div class="amw" id="A1"></div>');
    } finally {
      delete (document as unknown as Record<string, unknown>).currentScript;
    }

    expect((document.getElementById('amw-widget-styles') as HTMLLinkElement).href).toBe('https://amw.example.com/amw/widget.css');
  });

  it('falls back to the API base URL when the script URL is unknown', () => {
    loadWidget('<div class="amw" id="A1"></div>');

    expect((document.getElementById('amw-widget-styles') as HTMLLinkElement).href).toBe('http://localhost/item/widget.css');
  });

  it('draws the loading spinner as a filled dot that the animation fades in', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'widgets', 'widget.css'), 'utf8');
    const rule = css.match(/\.amw-widget-spinner-grow\s*\{([^}]*)\}/)![1];

    expect(rule).toMatch(/background-color:\s*currentColor/);
    expect(rule).not.toMatch(/border:/);
    expect(rule).toMatch(/animation:\s*spinner-grow/);
  });

  it('truncates long titles to 70 characters', async () => {
    respondWith({ ...product, title: 'x'.repeat(100) });
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

    expect(widget().querySelector('.amw-widget-caption')!.textContent).toBe(`${'x'.repeat(67)}...`);
  });

  it('shows "not available" and no badge when the price is -1', async () => {
    respondWith({ ...product, price: -1, savings: 0 });
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

    expect(widget().querySelector('.amw-widget-price')!.textContent).toBe('Non disponible');
    expect(widget().querySelector('.amw-widget-badge')).toBeNull();
  });

  it('uses the page language for the labels', async () => {
    loadWidget('<div class="amw" id="B084DN3XVN"></div>', { lang: 'en' });
    await flush();

    expect(widget().querySelector('.amw-widget-btn-warning')!.textContent).not.toBe('➕ Plus d\'infos');
    expect(widget().querySelector('.amw-widget-timestamp')!.textContent).toMatch(/^Price and availability as of .+, subject to change$/);
  });

  it('falls back to French for unsupported languages', async () => {
    loadWidget('<div class="amw" id="B084DN3XVN"></div>', { lang: 'xx' });
    await flush();

    expect(widget().querySelector('.amw-widget-btn-warning')!.textContent).toBe('➕ Plus d\'infos');
  });

  it('ignores elements without an id', () => {
    loadWidget('<div class="amw"></div>');

    expect(document.querySelector('div.amw')!.className).toBe('amw');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('transforms widgets added to the page after initialization', async () => {
    loadWidget('<main></main>');

    const container = document.createElement('section');
    container.innerHTML = '<div class="amw" id="B084DN3XVN"></div>';
    document.querySelector('main')!.appendChild(container);
    const direct = document.createElement('div');
    direct.className = 'amw';
    direct.id = 'B000000002';
    document.body.appendChild(direct);
    await flush();

    // Added in the same task, so requested together
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost/item/products?ids=B084DN3XVN,B000000002', expect.anything());
  });
});

describe('widget product image', () => {
  it('is lazy, decoded asynchronously and sized, without a src before the product is known', () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');

    const img = widget().querySelector<HTMLImageElement>('.amw-widget-img')!;
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('width')).toBe('160');
    expect(img.getAttribute('height')).toBe('160');
    expect(img.hasAttribute('src')).toBe(false);
  });

  it('keeps the loading attributes once the product image is set', async () => {
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

    const img = widget().querySelector<HTMLImageElement>('.amw-widget-img')!;
    expect(img.src).toBe(product.image);
    expect(img.getAttribute('loading')).toBe('lazy');
  });
});

describe('widget API base URL', () => {
  /** Emulates <script src=".../widget.js" data-api-base-url="..."> while the widget loads. */
  function loadWidgetFromScript(apiBaseUrl: string | null, bodyHtml = '<div class="amw" id="B084DN3XVN"></div>') {
    const script = document.createElement('script');
    script.src = 'https://amw.example.com/amw/widget.js';
    if (apiBaseUrl !== null) {
      script.setAttribute('data-api-base-url', apiBaseUrl);
    }
    Object.defineProperty(document, 'currentScript', { configurable: true, get: () => script });
    try {
      return loadWidget(bodyHtml);
    } finally {
      delete (document as unknown as Record<string, unknown>).currentScript;
    }
  }

  it('defaults to the page origin under /item', async () => {
    const api = loadWidgetFromScript(null);
    await flush();

    expect(api.config.apiBaseUrl).toBe('http://localhost/item');
    expect(fetchMock).toHaveBeenCalledWith('http://localhost/item/product?id=B084DN3XVN', expect.anything());
  });

  it('uses the data-api-base-url attribute of the script tag', async () => {
    loadWidgetFromScript('https://amw.example.com/amw/');
    await flush();

    expect(fetchMock).toHaveBeenCalledWith('https://amw.example.com/amw/product?id=B084DN3XVN', expect.anything());
  });

  it('resolves a relative data-api-base-url against the page', () => {
    const api = loadWidgetFromScript('/api/amw');

    expect(api.config.apiBaseUrl).toBe('http://localhost/api/amw');
  });

  it.each([['javascript:alert(1)'], ['data:text/plain,x'], ['   ']])('ignores the unsafe or empty value %p', (value) => {
    const api = loadWidgetFromScript(value);

    expect(api.config.apiBaseUrl).toBe('http://localhost/item');
  });

  it('can be changed with setApiConfig', async () => {
    const api = loadWidget('');
    api.setApiConfig({ apiBaseUrl: 'https://amw.example.com/amw' });
    api.transformElement(Object.assign(document.createElement('div'), { id: 'B084DN3XVN' }));
    await flush();

    expect(fetchMock).toHaveBeenCalledWith('https://amw.example.com/amw/product?id=B084DN3XVN', expect.anything());

    api.setApiConfig({ apiBaseUrl: 'javascript:alert(1)' });
    expect(api.config.apiBaseUrl).toBe('https://amw.example.com/amw');
  });
});

describe('widget accessibility', () => {
  /** Name computed from the content, as browsers do: aria-hidden parts and the empty alt are left out. */
  function accessibleName(el: Element): string {
    const clone = el.cloneNode(true) as Element;
    clone.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
    return clone.textContent!.replace(/\s+/g, ' ').trim();
  }

  it('gives the card link a concise name: title, price and a localized notice', async () => {
    loadWidget('<div class="amw" id="B084DN3XVN"></div>', { lang: 'en' });
    await flush();

    const link = widget().querySelector('.amw-widget-main-link')!;
    expect(accessibleName(link)).toBe('Arduino Uno R3 24,99 € -15% off (sponsored link, opens in a new tab)');
    const description = link.getAttribute('aria-describedby')!.split(' ')
      .map((id) => document.getElementById(id)!.textContent).join(' ');
    expect(description).toMatch(/^Price and availability as of .+, subject to change As an Amazon Associate I earn from qualifying purchases\.$/);
  });

  it('localizes the notice and the savings text', async () => {
    loadWidget('<div class="amw" id="B084DN3XVN"></div>', { lang: 'de' });
    await flush();

    expect(accessibleName(widget().querySelector('.amw-widget-main-link')!))
      .toBe('Arduino Uno R3 24,99 € -15% Rabatt (gesponserter Link, öffnet in einem neuen Tab)');
  });

  it('uses unique ids for the widgets of a page', async () => {
    loadWidget('<div class="amw" id="A1"></div><div class="amw" id="A2"></div>');
    await flush();

    const ids = Array.from(document.querySelectorAll('.amw-widget-timestamp')).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(2);
  });

  it('has no fake buttons nested in the link, a decorative image and hidden decorations', async () => {
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

    const el = widget();
    expect(el.querySelector('.amw-widget-main-link [role="button"]')).toBeNull();
    expect(el.querySelector('.amw-widget-img')!.getAttribute('alt')).toBe('');
    expect(el.querySelector('.amw-widget-btn-warning')!.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('.amw-widget-banner')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('is busy while loading and leaves the live region once the card is filled', async () => {
    let resolve!: (value: unknown) => void;
    fetchMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');

    expect(widget().getAttribute('aria-busy')).toBe('true');
    expect(widget().getAttribute('aria-live')).toBe('polite');

    resolve({ ok: true, status: 200, json: () => Promise.resolve(product) });
    await flush();

    expect(widget().getAttribute('aria-busy')).toBe('false');
    expect(widget().hasAttribute('aria-live')).toBe(false);
  });

  it.each([
    ['not found', () => respondWith(null)],
    ['network error', () => fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))],
  ])('announces the %s message through the live region', async (_label, setUp) => {
    setUp();
    const api = loadWidget('');
    api.setApiConfig({ retryAttempts: 1 });
    const el = Object.assign(document.createElement('div'), { id: 'B084DN3XVN' });
    api.transformElement(el);
    await flush();

    expect(el.getAttribute('aria-live')).toBe('polite');
    expect(el.getAttribute('aria-busy')).toBe('false');
    expect(el.querySelector('.amw-widget-error-icon')!.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('widget price disclaimer and affiliate disclosure', () => {
  function loadWidgetWithDisclosure(value: string | null, lang = 'en') {
    const script = document.createElement('script');
    script.src = 'https://amw.example.com/amw/widget.js';
    if (value !== null) {
      script.setAttribute('data-disclosure', value);
    }
    Object.defineProperty(document, 'currentScript', { configurable: true, get: () => script });
    try {
      return loadWidget('<div class="amw" id="B084DN3XVN"></div>', { lang });
    } finally {
      delete (document as unknown as Record<string, unknown>).currentScript;
    }
  }

  it('dates the price and says it may change, in the page language', async () => {
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

    const date = new Date(product.timestamp).toLocaleString();
    expect(widget().querySelector('.amw-widget-timestamp')!.textContent)
      .toBe(`Prix et disponibilité au ${date}, susceptibles de changer`);
  });

  it('shows the localized affiliate disclosure by default', async () => {
    loadWidgetWithDisclosure(null, 'de');
    await flush();

    expect(widget().querySelector('.amw-widget-disclosure')!.textContent).toBe('Als Amazon-Partner verdiene ich an qualifizierten Verkäufen.');
  });

  it('can be turned off with data-disclosure="off"', async () => {
    const api = loadWidgetWithDisclosure('off');
    await flush();

    expect(api.config.disclosure).toBe(false);
    expect(widget().querySelector('.amw-widget-disclosure')).toBeNull();
    expect(widget().querySelector('.amw-widget-main-link')!.getAttribute('aria-describedby')).not.toContain('disclosure');
  });

  it('shows a custom data-disclosure text as plain text', async () => {
    loadWidgetWithDisclosure('Lien affilié <b>Amazon</b>');
    await flush();

    const disclosure = widget().querySelector('.amw-widget-disclosure')!;
    expect(disclosure.textContent).toBe('Lien affilié <b>Amazon</b>');
    expect(disclosure.querySelector('b')).toBeNull();
  });

  it('can be changed with setApiConfig', async () => {
    const api = loadWidget('');
    api.setApiConfig({ disclosure: 'Affiliate link' });
    const el = Object.assign(document.createElement('div'), { id: 'B084DN3XVN' });
    api.transformElement(el);
    await flush();
    expect(el.querySelector('.amw-widget-disclosure')!.textContent).toBe('Affiliate link');

    api.setApiConfig({ disclosure: false });
    const other = Object.assign(document.createElement('div'), { id: 'B084DN3XVN' });
    api.transformElement(other);
    expect(other.querySelector('.amw-widget-disclosure')).toBeNull();
  });

  it('keeps the unmodified Amazon URL with its tag and a sponsored rel', async () => {
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

    const link = widget().querySelector<HTMLAnchorElement>('.amw-widget-main-link')!;
    expect(link.href).toBe(product.url);
    expect(new URL(link.href).searchParams.get('tag')).toBe('test-21');
    expect(link.rel).toBe('sponsored nofollow');
  });
});

describe('widget structured data', () => {
  function jsonLd() {
    return JSON.parse(document.head.querySelector('script[type="application/ld+json"]')!.textContent!);
  }

  // Without requestIdleCallback (jsdom), the JSON-LD is injected by a 1 ms timer after rendering
  const flushIdle = async () => {
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 5));
  };

  // Lets the JSON-LD timers of widgets loaded by previous tests fire before this test resets the page
  beforeEach(() => new Promise((resolve) => setTimeout(resolve, 5)));

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).requestIdleCallback;
  });

  it('is injected after the card is rendered, not during rendering', async () => {
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

    expect(widget().querySelector('.amw-widget-caption')!.textContent).toBe('Arduino Uno R3');
    expect(document.head.querySelector('script[type="application/ld+json"]')).toBeNull();

    await flushIdle();
    expect(document.head.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(1);
  });

  it('waits for requestIdleCallback when the browser has it, with a timeout', async () => {
    const idleCallbacks: Array<() => void> = [];
    const requestIdleCallback = jest.fn((callback: () => void) => {
      idleCallbacks.push(callback);
      return 1;
    });
    (window as unknown as Record<string, unknown>).requestIdleCallback = requestIdleCallback;
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flushIdle();

    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 2000 });
    expect(document.head.querySelector('script[type="application/ld+json"]')).toBeNull();

    idleCallbacks.forEach((callback) => callback());
    expect(jsonLd()).toMatchObject({ '@type': 'Product', name: 'Arduino Uno R3' });
  });

  it('publishes a schema.org Product with a numeric price', async () => {
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flushIdle();

    expect(jsonLd()).toMatchObject({
      '@type': 'Product',
      name: 'Arduino Uno R3',
      sku: 'B084DN3XVN',
      brand: { '@type': 'Brand', name: 'Arduino' },
      offers: { price: 24.99, priceCurrency: 'EUR', availability: 'https://schema.org/InStock' },
    });
  });

  it('marks unavailable products as out of stock and omits missing brand and ASIN', async () => {
    respondWith({ ...product, price: -1, brand: '', asin: '', title: 'y'.repeat(200) });
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flushIdle();

    const data = jsonLd();
    expect(data.offers).toMatchObject({ price: 0, availability: 'https://schema.org/OutOfStock' });
    expect(data.brand).toBeUndefined();
    expect(data.sku).toBeUndefined();
    expect(data.name).toHaveLength(150);
  });

  it('parses dot-decimal prices and falls back to 0 for unparsable ones', async () => {
    respondWith({ ...product, price: '$1,299.00'.replace(',', '') });
    loadWidget('<div class="amw" id="P1"></div>');
    await flushIdle();
    expect(jsonLd().offers.price).toBe(1299);

    respondWith({ ...product, price: 'N/A' });
    loadWidget('<div class="amw" id="P2"></div>');
    await flushIdle();
    expect(jsonLd().offers.price).toBe(0);
  });
});

describe('widget XSS protection', () => {
  const payload = '<img src=x onerror="window.pwned=true">';

  it('renders a malicious title as text', async () => {
    respondWith({ ...product, title: payload });
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

    const caption = widget().querySelector('.amw-widget-caption')!;
    expect(caption.textContent).toBe(payload);
    expect(caption.querySelector('img')).toBeNull();
  });

  it('escapes the price when it is rendered next to the savings badge', async () => {
    respondWith({ ...product, price: payload, savings: 10 });
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

    const price = widget().querySelector('.amw-widget-price')!;
    expect(price.querySelector('img')).toBeNull();
    expect(price.textContent).toContain(payload);
  });

  it('coerces savings to a number so it cannot carry markup', async () => {
    respondWith({ ...product, savings: `15${payload}` });
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

    const price = widget().querySelector('.amw-widget-price')!;
    expect(price.querySelector('.amw-widget-badge')).toBeNull();
    expect(price.querySelector('img')).toBeNull();
  });

  it('accepts numeric strings as savings', async () => {
    respondWith({ ...product, savings: '20' });
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

    expect(widget().querySelector('.amw-widget-badge')!.textContent).toBe('-20% de réduction');
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['a malformed', 'not a url'],
  ])('replaces a %s product URL with "#"', async (_label, url) => {
    respondWith({ ...product, url });
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

    expect(widget().querySelector('.amw-widget-main-link')!.getAttribute('href')).toBe('#');
  });

  it('drops a javascript: image URL', async () => {
    respondWith({ ...product, image: 'javascript:alert(1)' });
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

    expect(widget().querySelector('.amw-widget-img')!.getAttribute('src')).toBe('');
  });

  it('accepts plain http URLs', async () => {
    respondWith({ ...product, url: 'http://www.amazon.fr/dp/B084DN3XVN' });
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

    expect(widget().querySelector<HTMLAnchorElement>('.amw-widget-main-link')!.href).toBe('http://www.amazon.fr/dp/B084DN3XVN');
  });

  it('escapes the element id in the "not found" message', async () => {
    respondWith(null);
    const container = document.createElement('div');
    container.className = 'amw';
    container.id = payload;
    loadWidget('');
    window.AmwWidget.transformElement(container);
    await flush();

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.amw-widget-error')!.textContent).toContain(`Produit non trouvé: ${payload}`);
    expect(fetchMock).toHaveBeenCalledWith(`http://localhost/item/product?id=${encodeURIComponent(payload)}`, expect.anything());
  });

  it('hides a broken image instead of showing the browser placeholder', async () => {
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

    const img = widget().querySelector<HTMLImageElement>('.amw-widget-img')!;
    img.dispatchEvent(new Event('error'));

    expect(img.style.display).toBe('none');
  });
});

describe('widget batch requests', () => {
  const ids = (count: number) => Array.from({ length: count }, (_, i) => `B00000000${i}`.slice(-10));
  const page = (productIds: string[]) => productIds.map(id => `<div class="amw" id="${id}"></div>`).join('');
  const batchUrl = (productIds: string[]) => `http://localhost/item/products?ids=${productIds.join(',')}`;
  const ok = (id: string) => ({ id, status: 200, product: { ...product, asin: id, title: `Product ${id}` } });

  /** Answers /products with the given result for each requested id. */
  function respondPerId(result: (id: string) => unknown) {
    fetchMock.mockImplementation((url: string) => {
      const requested = new URL(url).searchParams.get('ids')!.split(',');
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ results: requested.map(result) }) });
    });
  }

  const caption = (id: string) => widget(id).querySelector('.amw-widget-caption')!.textContent;
  const error = (id: string) => widget(id).querySelector('.amw-widget-error')?.textContent;

  it('fills the widgets of a page with one request', async () => {
    respondPerId(ok);
    loadWidget(page(['B000000001', 'B000000002', 'B000000003']));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(batchUrl(['B000000001', 'B000000002', 'B000000003']), expect.anything());
    expect(caption('B000000002')).toBe('Product B000000002');
  });

  it('sends at most 10 ids per request', async () => {
    respondPerId(ok);
    const all = ids(10).concat(['B000000010', 'B000000011']);
    loadWidget(page(all));
    await flush();

    // Counted on this page's ids only: a widget left by an earlier test may still be retrying
    const batchCalls = fetchMock.mock.calls.map(([url]) => url as string).filter(url => url.includes('B000000010'));
    expect(batchCalls).toEqual([batchUrl(all.slice(10))]);
    expect(fetchMock).toHaveBeenCalledWith(batchUrl(all.slice(0, 10)), expect.anything());
    expect(fetchMock).toHaveBeenCalledWith(batchUrl(all.slice(10)), expect.anything());
  });

  it('keeps /product for a lone remainder and for ids that are not ASINs', async () => {
    respondPerId(ok);
    loadWidget(page(['B000000001', 'not-an-asin']));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost/item/product?id=B000000001', expect.anything());
    expect(fetchMock).toHaveBeenCalledWith('http://localhost/item/product?id=not-an-asin', expect.anything());
  });

  it('shows "not found" only for the products Amazon does not have', async () => {
    respondPerId(id => (id === 'B000000002' ? { id, status: 404 } : ok(id)));
    const api = loadWidget(page(['B000000001', 'B000000002']));
    api.setApiConfig({ retryAttempts: 3, retryDelay: 0 });
    await flush();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(caption('B000000001')).toBe('Product B000000001');
    expect(error('B000000002')).toContain('Produit non trouvé: B000000002');
  });

  it('retries only the ids that failed', async () => {
    let calls = 0;
    respondPerId(id => (id === 'B000000002' && ++calls === 1 ? { id, status: 503 } : ok(id)));
    const api = loadWidget(page(['B000000001', 'B000000002', 'B000000003']));
    api.setApiConfig({ retryAttempts: 2, retryDelay: 0 });
    await flush();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(batchUrl(['B000000002']), expect.anything());
    expect(caption('B000000002')).toBe('Product B000000002');
  });

  it('shows a network error once the retries of a failing batch are exhausted', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const api = loadWidget(page(['B000000001', 'B000000002']));
    api.setApiConfig({ retryAttempts: 2, retryDelay: 0 });
    await flush();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(error('B000000001')).toContain('Erreur de connexion');
    expect(error('B000000002')).toContain('Erreur de connexion');
  });

  it('treats an id missing from the answer as failed, not as not found', async () => {
    respondPerId(id => (id === 'B000000002' ? null : ok(id)));
    const api = loadWidget(page(['B000000001', 'B000000002']));
    api.setApiConfig({ retryAttempts: 1 });
    await flush();

    expect(error('B000000002')).toContain('Erreur de connexion');
  });

  it('requests a product shown by several widgets once', async () => {
    respondPerId(ok);
    loadWidget('<div class="amw" id="B000000001"></div><div class="amw" id="B000000002"></div>' +
      '<div class="amw" data-dup id="B000000001"></div>');
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(batchUrl(['B000000001', 'B000000002']), expect.anything());
    const duplicate = document.querySelector('[data-dup]')!;
    expect(duplicate.querySelector('.amw-widget-caption')!.textContent).toBe('Product B000000001');
  });
});

describe('widget error handling', () => {
  it('shows a network error after the configured retries', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const api = loadWidget('');
    api.setApiConfig({ retryAttempts: 2, retryDelay: 0 });
    const el = document.createElement('div');
    el.id = 'B084DN3XVN';
    api.transformElement(el);
    await flush();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(el.querySelector('.amw-widget-error')!.textContent).toContain('Erreur de connexion');
  });

  it.each([502, 503, 504])('treats HTTP %i as a network error', async (status) => {
    respondWith({ error: 'Bad Gateway' }, status);
    const api = loadWidget('');
    api.setApiConfig({ retryAttempts: 1 });
    const el = document.createElement('div');
    el.id = 'B084DN3XVN';
    api.transformElement(el);
    await flush();

    expect(el.querySelector('.amw-widget-error')!.textContent).toContain('Erreur de connexion');
  });

  it('shows "not found" on HTTP 404 without retrying or caching', async () => {
    respondWith({ error: 'Product Not Found' }, 404);
    const api = loadWidget('');
    api.setApiConfig({ retryAttempts: 3, retryDelay: 0 });
    const el = document.createElement('div');
    el.id = 'B084DN3XVN';
    api.transformElement(el);
    await flush();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(el.querySelector('.amw-widget-error')!.textContent).toContain('Produit non trouvé: B084DN3XVN');
    expect(api.getCacheStats().cacheSize).toBe(0);
  });

  it('shows a timeout error when the API does not answer', async () => {
    jest.useFakeTimers();
    fetchMock.mockReturnValue(new Promise(() => undefined));
    const api = loadWidget('');
    api.setApiConfig({ timeout: 100, retryAttempts: 1 });
    const el = document.createElement('div');
    el.id = 'B084DN3XVN';

    api.transformElement(el);
    await jest.advanceTimersByTimeAsync(100);

    expect(el.querySelector('.amw-widget-error')!.textContent).toContain('Délai dépassé');
  });
});

describe('widget shared requests', () => {
  it('fills every widget showing the same product with one request', async () => {
    loadWidget('<div class="amw" id="B084DN3XVN"></div><div class="amw" id="B084DN3XVN"></div>');
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const captions = document.querySelectorAll('.amw-widget-caption');
    expect(captions).toHaveLength(2);
    captions.forEach((caption) => expect(caption.textContent).toBe('Arduino Uno R3'));
  });

  it('shows the error in every widget sharing a failed request', async () => {
    respondWith({}, 500);
    const api = loadWidget('');
    api.setApiConfig({ retryAttempts: 1 });
    const first = Object.assign(document.createElement('div'), { id: 'B084DN3XVN' });
    const second = Object.assign(document.createElement('div'), { id: 'B084DN3XVN' });
    api.transformElement(first);
    api.transformElement(second);
    expect(api.getCacheStats().activeRequests).toBe(1);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.querySelector('.amw-widget-error')).not.toBeNull();
    expect(second.querySelector('.amw-widget-error')).not.toBeNull();
    expect(api.getCacheStats().activeRequests).toBe(0);
  });

  it('shows "not found" in every widget when the API returns null', async () => {
    respondWith(null);
    loadWidget('<div class="amw" id="B084DN3XVN"></div><div class="amw" id="B084DN3XVN"></div>');
    await flush();

    expect(document.querySelectorAll('.amw-widget-error')).toHaveLength(2);
  });

  it('aborts a timed-out request and retries it', async () => {
    jest.useFakeTimers();
    const signals: AbortSignal[] = [];
    fetchMock
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        signals.push(init.signal as AbortSignal);
        return new Promise(() => undefined);
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(product) });
    const api = loadWidget('');
    api.setApiConfig({ timeout: 100, retryAttempts: 2, retryDelay: 10 });
    const el = Object.assign(document.createElement('div'), { id: 'B084DN3XVN' });

    api.transformElement(el);
    await jest.advanceTimersByTimeAsync(100);
    expect(signals[0].aborted).toBe(true);
    await jest.advanceTimersByTimeAsync(10);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(el.querySelector('.amw-widget-caption')!.textContent).toBe('Arduino Uno R3');
  });
});

describe('widget request concurrency', () => {
  const ids = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'];

  function deferFetches() {
    const pending: Array<() => void> = [];
    fetchMock.mockImplementation(() => new Promise((resolve) => {
      pending.push(() => resolve({ ok: true, status: 200, json: () => Promise.resolve(product) }));
    }));
    return pending;
  }

  it('runs at most maxConcurrentRequests requests at once (5 by default)', async () => {
    const pending = deferFetches();
    loadWidget(ids.map((id) => `<div class="amw" id="${id}"></div>`).join(''));

    expect(fetchMock).toHaveBeenCalledTimes(5);

    pending[0]();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(6);

    pending.slice(1).forEach((resolve) => resolve());
    await flush();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(document.querySelectorAll('.amw-widget-caption')).toHaveLength(7);
  });

  it('can be lowered with setApiConfig, and never below one request', async () => {
    const pending = deferFetches();
    const api = loadWidget('');
    api.setApiConfig({ maxConcurrentRequests: 0 });
    ids.slice(0, 3).forEach((id) => api.transformElement(Object.assign(document.createElement('div'), { id })));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    pending[0]();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    api.setApiConfig({ maxConcurrentRequests: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('frees the slot of a request whose fetch throws synchronously', async () => {
    fetchMock.mockImplementationOnce(() => {
      throw new TypeError('Invalid URL');
    });
    const api = loadWidget('');
    api.setApiConfig({ maxConcurrentRequests: 1, retryAttempts: 1 });
    const first = Object.assign(document.createElement('div'), { id: 'A1' });
    const second = Object.assign(document.createElement('div'), { id: 'A2' });
    api.transformElement(first);
    api.transformElement(second);
    await flush();
    await flush();

    expect(first.querySelector('.amw-widget-error')).not.toBeNull();
    expect(second.querySelector('.amw-widget-caption')!.textContent).toBe('Arduino Uno R3');
  });

  it('no longer exposes the unused debounceDelay and preloadImages options', () => {
    const api = loadWidget('');

    expect(api.config.performance).toEqual({ maxConcurrentRequests: 5, cacheExpiry: 300000 });
  });
});

describe('widget client cache', () => {
  it('reuses a cached product instead of calling the API again', async () => {
    const api = loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

    const second = document.createElement('div');
    second.id = 'B084DN3XVN';
    api.transformElement(second);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.querySelector('.amw-widget-caption')!.textContent).toBe('Arduino Uno R3');
    expect(api.getCacheStats()).toEqual({ cacheSize: 1, activeRequests: 0, cacheHitRate: 1 });
  });

  it('can be cleared', async () => {
    const api = loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

    api.clearCache();

    expect(api.getCacheStats()).toEqual({ cacheSize: 0, activeRequests: 0, cacheHitRate: 0 });
  });
});

describe('widget session cache', () => {
  const STORAGE_KEY = 'amw:products:v1';

  function storeProducts(entries: Record<string, unknown>) {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  function stored(): Record<string, { data: unknown; timestamp: number }> {
    return JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || '{}');
  }

  it('persists fetched products in sessionStorage', async () => {
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

    expect(stored()['B084DN3XVN_fr']).toMatchObject({ data: product, timestamp: expect.any(Number) });
  });

  it('reuses the products stored by a previous page view', async () => {
    storeProducts({ B084DN3XVN_fr: { data: product, timestamp: Date.now() } });

    const api = loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(widget().querySelector('.amw-widget-caption')!.textContent).toBe('Arduino Uno R3');
    expect(api.getCacheStats().cacheSize).toBe(1);
  });

  it('ignores expired and malformed entries', async () => {
    storeProducts({
      B084DN3XVN_fr: { data: product, timestamp: Date.now() - 300001 },
      A1_fr: { data: 'not a product', timestamp: Date.now() },
      A2_fr: null,
    });

    const api = loadWidget('<div class="amw" id="B084DN3XVN"></div>');

    expect(api.getCacheStats().cacheSize).toBe(0);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never reuses product data older than 24 hours, even with a longer cacheExpiry', async () => {
    const api = loadWidget('');
    api.config.performance.cacheExpiry = 7 * 24 * 60 * 60 * 1000;
    const start = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(start);

    api.transformElement(Object.assign(document.createElement('div'), { id: 'B084DN3XVN' }));
    await flush();
    now.mockReturnValue(start + 23 * 60 * 60 * 1000);
    api.transformElement(Object.assign(document.createElement('div'), { id: 'B084DN3XVN' }));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now.mockReturnValue(start + 24 * 60 * 60 * 1000 + 1);
    api.transformElement(Object.assign(document.createElement('div'), { id: 'B084DN3XVN' }));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignores unparsable stored data', async () => {
    window.sessionStorage.setItem(STORAGE_KEY, '{not json');

    const api = loadWidget('<div class="amw" id="B084DN3XVN"></div>');

    expect(api.getCacheStats().cacheSize).toBe(0);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps only the 50 most recent products', async () => {
    const now = Date.now();
    const entries: Record<string, unknown> = {};
    for (let i = 0; i < 60; i++) {
      entries[`P${i}_fr`] = { data: product, timestamp: now - 1000 - i };
    }
    storeProducts(entries);

    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

    const keys = Object.keys(stored());
    expect(keys).toHaveLength(50);
    expect(keys).toContain('B084DN3XVN_fr');
    expect(keys).toContain('P0_fr');
    expect(keys).not.toContain('P59_fr');
  });

  it('still renders when sessionStorage is blocked', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage')!;
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('Access denied', 'SecurityError');
      },
    });
    try {
      const api = loadWidget('<div class="amw" id="B084DN3XVN"></div>');
      await flush();
      api.clearCache();
    } finally {
      Object.defineProperty(window, 'sessionStorage', descriptor);
    }

    expect(widget().querySelector('.amw-widget-caption')!.textContent).toBe('Arduino Uno R3');
  });

  it('still renders when sessionStorage is full', async () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });

    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

    expect(widget().querySelector('.amw-widget-caption')!.textContent).toBe('Arduino Uno R3');
  });

  it('is emptied by clearCache', async () => {
    const api = loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

    api.clearCache();

    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('widget lazy loading', () => {
  let observed: Element[];
  let unobserved: Element[];
  let trigger: (entries: Array<{ isIntersecting: boolean; target: Element }>) => void;

  beforeEach(() => {
    observed = [];
    unobserved = [];
    window.IntersectionObserver = jest.fn().mockImplementation((callback) => {
      trigger = callback;
      return {
        observe: (el: Element) => observed.push(el),
        unobserve: (el: Element) => unobserved.push(el),
        disconnect: jest.fn(),
      };
    }) as unknown as typeof IntersectionObserver;
  });

  it('shows a placeholder until the widget becomes visible', async () => {
    const api = loadWidget('<div class="amw" id="B084DN3XVN"></div>', { lang: 'de' });

    expect(api.isLazyLoadingSupported()).toBe(true);
    expect(widget().className).toBe('amw-widget amw-widget-lazy');
    expect(widget().getAttribute('data-language')).toBe('de');
    expect(observed).toEqual([widget()]);
    expect(fetchMock).not.toHaveBeenCalled();

    trigger([{ isIntersecting: false, target: widget() }]);
    expect(fetchMock).not.toHaveBeenCalled();

    trigger([{ isIntersecting: true, target: widget() }]);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(unobserved).toEqual([widget()]);
    expect(widget().className).toBe('amw-widget');
  });

  it('loads every pending widget on demand', async () => {
    const api = loadWidget('<div class="amw" id="A1"></div><div class="amw" id="A2"></div>');

    api.loadAllWidgets();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('loads new widgets immediately once lazy loading is disabled', async () => {
    const api = loadWidget('');
    api.disableLazyLoading();

    const el = document.createElement('div');
    el.className = 'amw';
    el.id = 'B084DN3XVN';
    document.body.appendChild(el);
    await flush();

    expect(api.config.lazyLoading.enabled).toBe(false);
    expect(observed).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    api.enableLazyLoading();
    api.transformLazyElement(Object.assign(document.createElement('div'), { id: 'B000000002' }));
    expect(observed).toHaveLength(1);
  });

  it('waits for DOMContentLoaded and honours a lazy loading change made before it', async () => {
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    try {
      const api = loadWidget('<div class="amw" id="B084DN3XVN"></div>');
      expect(widget().className).toBe('amw');

      api.disableLazyLoading();
      document.dispatchEvent(new Event('DOMContentLoaded'));
      await flush();
    } finally {
      delete (document as unknown as Record<string, unknown>).readyState;
    }

    expect(widget().className).toBe('amw-widget');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
