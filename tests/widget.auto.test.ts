/**
 * @jest-environment jsdom
 *
 * Widgets with the id AUTO (src/widgets/widget.js): the server chooses the product from the title.
 */

export {};

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

type Api = { destroy(): void; setApiConfig(config: { retryAttempts: number; retryDelay?: number }): void };
const win = window as unknown as { AmwWidget: Api };

function loadWidget(html = '<div class="amw" id="AUTO"></div>', head = ''): Api {
  document.head.innerHTML = head;
  const body = document.createElement('body');
  body.innerHTML = html;
  document.documentElement.replaceChild(body, document.body);
  jest.isolateModules(() => {
    require('../src/widgets/widget.js');
  });
  return win.AmwWidget;
}

const card = () => document.getElementById('AUTO') as HTMLElement;
const productUrls = () => fetchMock.mock.calls.map(([url]) => url as string);
const titleOf = (url: string) => new URL(url).searchParams.get('title');
const beacons = (path: string) => sendBeacon.mock.calls.map(([url]) => url as string).filter(url => url.includes(path));

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(product) });
  global.fetch = fetchMock as unknown as typeof fetch;
  sendBeacon.mockReset().mockReturnValue(true);
  Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true, writable: true });
  delete (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
  window.sessionStorage.clear();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  win.AmwWidget.destroy();
  jest.restoreAllMocks();
});

describe('AUTO widget title', () => {
  const og = '<meta property="og:title" content="Titre og"><title>Titre onglet | Mon site</title>';

  it('prefers data-title, then og:title, then the h1, then the page title', async () => {
    loadWidget('<h1>Titre h1</h1><div class="amw" id="AUTO" data-title="Titre choisi"></div>', og);
    await flush();
    expect(titleOf(productUrls()[0])).toBe('Titre choisi');

    fetchMock.mockClear();
    window.sessionStorage.clear();
    win.AmwWidget.destroy();
    loadWidget('<h1>Titre h1</h1><div class="amw" id="AUTO"></div>', og);
    await flush();
    expect(titleOf(productUrls()[0])).toBe('Titre og');

    fetchMock.mockClear();
    window.sessionStorage.clear();
    win.AmwWidget.destroy();
    loadWidget('<h1>  Titre\n  h1 </h1><div class="amw" id="AUTO"></div>', '<title>Titre onglet</title>');
    await flush();
    expect(titleOf(productUrls()[0])).toBe('Titre h1');

    fetchMock.mockClear();
    window.sessionStorage.clear();
    win.AmwWidget.destroy();
    loadWidget('<div class="amw" id="AUTO"></div>', '<title>Titre onglet</title>');
    await flush();
    expect(titleOf(productUrls()[0])).toBe('Titre onglet');
  });

  it('encodes the title and bounds it to what the server accepts', async () => {
    loadWidget(`<div class="amw" id="AUTO" data-title="a&b=c ${'x'.repeat(300)}"></div>`);
    await flush();

    expect(productUrls()[0]).toContain('title=a%26b%3Dc');
    expect(titleOf(productUrls()[0])).toHaveLength(200);
  });

  it('hides itself without calling the API when the page has no title', async () => {
    loadWidget();
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(card().hidden).toBe(true);
  });
});

describe('AUTO widget rendering', () => {
  const page = '<div class="amw" id="AUTO" data-title="Un article"></div>';

  it('renders the product chosen by the server', async () => {
    loadWidget(page);
    await flush();
    expect(card().querySelector('.amw-widget-caption')!.textContent).toBe('Panneau solaire 200W');
  });

  it('reports views and clicks with the ASIN returned by the API, not AUTO', async () => {
    jest.useFakeTimers();
    loadWidget(page);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    jest.advanceTimersByTime(1000);
    expect(beacons('/view')).toEqual(['http://localhost/item/view?ids=B0SOLAR001']);

    const link = card().querySelector('.amw-widget-main-link') as HTMLAnchorElement;
    link.addEventListener('click', event => event.preventDefault());
    link.click();
    expect(beacons('/click')).toEqual(['http://localhost/item/click?id=B0SOLAR001']);
    jest.useRealTimers();
  });

  it('does not show the product of another article from the session cache', async () => {
    loadWidget(page);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Next page of the session
    win.AmwWidget.destroy();
    loadWidget('<div class="amw" id="AUTO" data-title="Un autre article"></div>');
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(titleOf(productUrls()[1])).toBe('Un autre article');

    // Coming back to the first article reuses its product
    win.AmwWidget.destroy();
    loadWidget(page);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one request between the AUTO widgets of a page', async () => {
    loadWidget(`${page}<section>${page}</section>`);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.amw-widget-caption')).toHaveLength(2);
  });

  it('hides itself when no product suits the page', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) });
    loadWidget(page);
    await flush();
    expect(card().hidden).toBe(true);
    expect(beacons('/view')).toEqual([]);
  });

  it('hides itself rather than showing an error once the retries are exhausted', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) });
    const api = loadWidget('');
    api.setApiConfig({ retryAttempts: 1 });
    const element = Object.assign(document.createElement('div'), { className: 'amw', id: 'AUTO' });
    element.setAttribute('data-title', 'Un article');
    document.body.appendChild(element);
    (win.AmwWidget as unknown as { transformElement(e: Element): void }).transformElement(element);
    await flush();
    await flush();

    expect(element.hidden).toBe(true);
    expect(element.querySelector('.amw-widget-error')).toBeNull();
  });

  it('leaves ordinary widgets on the id URL, with their error card', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) });
    const api = loadWidget('');
    api.setApiConfig({ retryAttempts: 1 });
    const element = Object.assign(document.createElement('div'), { id: 'B084DN3XVN' });
    (win.AmwWidget as unknown as { transformElement(e: Element): void }).transformElement(element);
    await flush();
    await flush();

    expect(productUrls()).toEqual(['http://localhost/item/product?id=B084DN3XVN']);
    expect(element.querySelector('.amw-widget-error')).not.toBeNull();
  });
});
