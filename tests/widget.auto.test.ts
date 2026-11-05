/**
 * @jest-environment jsdom
 *
 * Widgets without an id (src/widgets/widget.js): the server chooses the product suited to the page.
 */

import crypto from 'crypto';

const product = {
  asin: 'B0SOLAR001',
  title: 'Panneau solaire 200W',
  url: 'https://www.amazon.fr/dp/B0SOLAR001?tag=test-21',
  image: 'https://m.media-amazon.com/images/I/solar.jpg',
  price: '129,99 €',
  timestamp: Date.UTC(2026, 0, 1),
};

const fetchMock = jest.fn();
const sendBeacon = jest.fn();
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const md5 = (text: string) => crypto.createHash('md5').update(text).digest('hex');

type Api = { destroy(): void; setApiConfig(config: { retryAttempts: number }): void; transformElement(element: Element): void };
const win = window as unknown as { AmwWidget: Api };

function loadWidget(html = '<div class="amw"></div>'): Api {
  const body = document.createElement('body');
  body.innerHTML = html;
  document.documentElement.replaceChild(body, document.body);
  jest.isolateModules(() => {
    require('../src/widgets/widget.js');
  });
  return win.AmwWidget;
}

const card = () => document.querySelector('.amw-widget') as HTMLElement;
const productUrls = () => fetchMock.mock.calls.map(([url]) => url as string);
const beacons = (path: string) => sendBeacon.mock.calls.map(([url]) => url as string).filter(url => url.includes(path));
const goTo = (path: string) => window.history.pushState({}, '', path);

beforeEach(() => {
  goTo('/mon-article/');
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(product) });
  global.fetch = fetchMock as unknown as typeof fetch;
  sendBeacon.mockReset().mockReturnValue(true);
  Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true, writable: true });
  delete (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
  window.sessionStorage.clear();
  document.title = 'Un titre que le widget ne doit jamais envoyer';
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  win.AmwWidget.destroy();
  jest.restoreAllMocks();
});

describe('widget without an id: request', () => {
  it('sends only the MD5 of the page URL, never its title', async () => {
    loadWidget();
    await flush();

    expect(productUrls()).toEqual([`http://localhost/item/product?page=${md5('http://localhost/mon-article/')}`]);
    expect(productUrls()[0]).not.toContain('titre');
  });

  it('hashes neither the query string nor the fragment, like the server', async () => {
    goTo('/mon-article/?utm_source=x#top');
    loadWidget();
    await flush();

    expect(productUrls()[0]).toContain(md5('http://localhost/mon-article/'));
  });

  // Lengths around the 64-byte blocks of MD5, where a padding mistake would show
  it('computes the same MD5 as the server for any URL length', async () => {
    for (const length of [1, 30, 39, 40, 41, 42, 43, 44, 45, 100, 103, 104, 105, 106, 107, 108, 500]) {
      const path = `/${'a'.repeat(length)}`;
      goTo(path);
      fetchMock.mockClear();
      loadWidget();
      await flush();
      expect(productUrls()[0]).toContain(md5(`http://localhost${path}`));
      win.AmwWidget.destroy();
      window.sessionStorage.clear();
    }
  });

  it('hashes a non-ASCII path as its percent-encoded URL, which is what the Referer carries', async () => {
    goTo('/été/');
    loadWidget();
    await flush();
    expect(productUrls()[0]).toContain(md5('http://localhost/%C3%A9t%C3%A9/'));
  });

  it('asks the browser for the full Referer, which the server needs across origins', async () => {
    loadWidget();
    await flush();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ referrerPolicy: 'no-referrer-when-downgrade' });
  });

  it('does not change the Referer of widgets with an id', async () => {
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();
    expect(productUrls()).toEqual(['http://localhost/item/product?id=B084DN3XVN']);
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('referrerPolicy');
  });

  it('also works when lazy loaded', async () => {
    let reveal: (entries: unknown[]) => void = () => undefined;
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = jest.fn(callback => {
      reveal = callback;
      return { observe: jest.fn(), unobserve: jest.fn(), disconnect: jest.fn() };
    });
    loadWidget();
    expect(fetchMock).not.toHaveBeenCalled();

    reveal([{ isIntersecting: true, target: card() }]);
    await flush();
    expect(productUrls()[0]).toContain('page=');
    expect(document.querySelector('.amw-widget-caption')!.textContent).toBe('Panneau solaire 200W');
    delete (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
  });
});

describe('widget without an id: rendering', () => {
  it('renders the product chosen by the server', async () => {
    loadWidget();
    await flush();
    expect(card().querySelector('.amw-widget-caption')!.textContent).toBe('Panneau solaire 200W');
  });

  it('reports views and clicks with the ASIN returned by the API', async () => {
    jest.useFakeTimers();
    loadWidget();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    jest.advanceTimersByTime(1000);
    expect(beacons('/view')).toEqual(['http://localhost/item/view?ids=B0SOLAR001']);

    const link = card().querySelector('.amw-widget-main-link') as HTMLAnchorElement;
    link.addEventListener('click', event => event.preventDefault());
    link.click();
    expect(beacons('/click')).toEqual(['http://localhost/item/click?id=B0SOLAR001']);
    jest.useRealTimers();
  });

  it('does not show the product of another page from the session cache', async () => {
    loadWidget();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    win.AmwWidget.destroy();
    goTo('/autre-article/');
    loadWidget();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(productUrls()[1]).toContain(md5('http://localhost/autre-article/'));

    // Coming back to the first article reuses its product
    win.AmwWidget.destroy();
    goTo('/mon-article/');
    loadWidget();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one request between the widgets of a page', async () => {
    loadWidget('<div class="amw"></div><section><div class="amw"></div></section>');
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.amw-widget-caption')).toHaveLength(2);
  });

  it('hides itself when no product suits the page, or when the feature is off', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) });
    loadWidget();
    await flush();
    expect(card().hidden).toBe(true);
    expect(beacons('/view')).toEqual([]);
  });

  it('hides itself rather than showing an error once the retries are exhausted', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) });
    const api = loadWidget('');
    api.setApiConfig({ retryAttempts: 1 });
    const element = document.createElement('div');
    document.body.appendChild(element);
    api.transformElement(element);
    await flush();
    await flush();

    expect(element.hidden).toBe(true);
    expect(element.querySelector('.amw-widget-error')).toBeNull();
  });

  it('leaves widgets with an id their error card', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) });
    const api = loadWidget('');
    api.setApiConfig({ retryAttempts: 1 });
    const element = Object.assign(document.createElement('div'), { id: 'B084DN3XVN' });
    api.transformElement(element);
    await flush();
    await flush();

    expect(element.querySelector('.amw-widget-error')).not.toBeNull();
  });
});
