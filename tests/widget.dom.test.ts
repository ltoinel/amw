/**
 * @jest-environment jsdom
 *
 * Behaviour of the embeddable widget (src/widgets/widget.js) in a browser-like DOM.
 * The widget runs on third-party pages, so most cases check that API data
 * cannot inject markup or dangerous URLs.
 */

export {};

interface AmwWidgetApi {
  init(): void;
  transformElement(element: Element): void;
  transformLazyElement(element: Element): void;
  config: { api: { timeout: number }; lazyLoading: { enabled: boolean } };
  enableLazyLoading(): void;
  disableLazyLoading(): void;
  loadAllWidgets(): void;
  destroy(): void;
  isLazyLoadingSupported(): boolean;
  setApiConfig(config: { timeout?: number; retryAttempts?: number; retryDelay?: number }): void;
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
    expect(fetchMock).toHaveBeenCalledWith('http://localhost/item/product?id=B084DN3XVN');
    expect(el.className).toBe('amw-widget');
    expect(el.querySelector('.amw-widget-caption')!.textContent).toBe('Arduino Uno R3');
    expect(el.querySelector('.amw-widget-price')!.textContent).toBe('24,99 €-15%Savings');
    expect(el.querySelector('.amw-widget-badge')!.textContent).toBe('-15%Savings');
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
    expect(widget().querySelector('.amw-widget-timestamp')!.textContent).toMatch(/^↻ Last product update : /);
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

    expect(fetchMock).toHaveBeenCalledWith('http://localhost/item/product?id=B084DN3XVN');
    expect(fetchMock).toHaveBeenCalledWith('http://localhost/item/product?id=B000000002');
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

  it('injects no invalid "loading" CSS property', () => {
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');

    expect(document.getElementById('amw-widget-styles')!.textContent).not.toMatch(/loading\s*:/);
  });
});

describe('widget structured data', () => {
  function jsonLd() {
    return JSON.parse(document.head.querySelector('script[type="application/ld+json"]')!.textContent!);
  }

  it('publishes a schema.org Product with a numeric price', async () => {
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

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
    await flush();

    const data = jsonLd();
    expect(data.offers).toMatchObject({ price: 0, availability: 'https://schema.org/OutOfStock' });
    expect(data.brand).toBeUndefined();
    expect(data.sku).toBeUndefined();
    expect(data.name).toHaveLength(150);
  });

  it('parses dot-decimal prices and falls back to 0 for unparsable ones', async () => {
    respondWith({ ...product, price: '$1,299.00'.replace(',', '') });
    loadWidget('<div class="amw" id="P1"></div>');
    await flush();
    expect(jsonLd().offers.price).toBe(1299);

    respondWith({ ...product, price: 'N/A' });
    loadWidget('<div class="amw" id="P2"></div>');
    await flush();
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

    expect(widget().querySelector('.amw-widget-badge')!.textContent).toBe('-20%Savings');
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
    expect(fetchMock).toHaveBeenCalledWith(`http://localhost/item/product?id=${encodeURIComponent(payload)}`);
  });

  it('hides a broken image instead of showing the browser placeholder', async () => {
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();

    const img = widget().querySelector<HTMLImageElement>('.amw-widget-img')!;
    img.dispatchEvent(new Event('error'));

    expect(img.style.display).toBe('none');
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

  it('treats HTTP errors as network errors', async () => {
    respondWith({ error: 'Product Not Found' }, 404);
    const api = loadWidget('');
    api.setApiConfig({ retryAttempts: 1 });
    const el = document.createElement('div');
    el.id = 'B084DN3XVN';
    api.transformElement(el);
    await flush();

    expect(el.querySelector('.amw-widget-error')!.textContent).toContain('Erreur de connexion');
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
