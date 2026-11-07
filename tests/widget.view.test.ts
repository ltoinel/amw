/**
 * @jest-environment jsdom
 *
 * View beacon sent by the widget (src/widgets/widget.js) once its cards are displayed.
 */

export {};

const product = {
  title: 'Arduino Uno R3',
  url: 'https://www.amazon.fr/dp/B084DN3XVN?tag=test-21',
  image: 'https://m.media-amazon.com/images/I/arduino.jpg',
  price: '24,99 €',
  timestamp: Date.UTC(2026, 0, 1),
};

const sendBeacon = jest.fn();
const fetchMock = jest.fn();
const DELAY = 1000;

type Api = { destroy(): void; transformElement(element: Element): void; setApiConfig(config: Record<string, unknown>): void };
const api = () => (window as unknown as { AmwWidget: Api }).AmwWidget;

function loadWidget(html: string): void {
  const body = document.createElement('body');
  body.innerHTML = html;
  document.documentElement.replaceChild(body, document.body);
  jest.isolateModules(() => {
    require('../src/widgets/widget.js');
  });
}

const cards = (...ids: string[]) => ids.map(id => `<div class="amw" id="${id}"></div>`).join('');
const viewBeacons = () => sendBeacon.mock.calls.map(([url]) => url as string).filter(url => url.includes('/view'));

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  sendBeacon.mockReset().mockReturnValue(true);
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(product) });
  global.fetch = fetchMock as unknown as typeof fetch;
  Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true, writable: true });
  delete (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
  window.sessionStorage.clear();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  api().destroy();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('widget view beacon', () => {
  it('groups the cards displayed together into one beacon', async () => {
    loadWidget(cards('B000000001', 'B000000002'));
    await settle();
    expect(viewBeacons()).toEqual([]);

    jest.advanceTimersByTime(DELAY);

    expect(viewBeacons()).toEqual(['http://localhost/item/view?ids=B000000001,B000000002']);
  });

  it('counts a product shown twice on a page once, with a single product request', async () => {
    loadWidget('<div class="amw" id="B000000001"></div><section><div class="amw" id="B000000001"></div></section>');
    await settle();
    jest.advanceTimersByTime(DELAY);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(viewBeacons()).toEqual(['http://localhost/item/view?ids=B000000001']);
  });

  async function reload(html: string): Promise<void> {
    api().destroy();
    sendBeacon.mockClear();
    fetchMock.mockClear();
    loadWidget(html);
    await settle();
    jest.advanceTimersByTime(DELAY);
  }

  it('does not count a card again when the page is reloaded in the same tab session', async () => {
    loadWidget(cards('B000000001'));
    await settle();
    jest.advanceTimersByTime(DELAY);

    await reload(cards('B000000001'));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector('.amw-widget-caption')!.textContent).toBe('Arduino Uno R3');
    expect(viewBeacons()).toEqual([]);
  });

  it('only counts the products not seen yet on a reloaded page', async () => {
    loadWidget(cards('B000000001'));
    await settle();
    jest.advanceTimersByTime(DELAY);

    await reload(cards('B000000001', 'B000000002'));

    expect(viewBeacons()).toEqual(['http://localhost/item/view?ids=B000000002']);
  });

  it('counts the same product again on another page and in a new tab session', async () => {
    loadWidget(cards('B000000001'));
    await settle();
    jest.advanceTimersByTime(DELAY);

    window.history.pushState({}, '', '/another-article/');
    await reload(cards('B000000001'));
    expect(viewBeacons()).toEqual(['http://localhost/item/view?ids=B000000001']);

    window.sessionStorage.clear();
    await reload(cards('B000000001'));
    window.history.pushState({}, '', '/');
    expect(viewBeacons()).toEqual(['http://localhost/item/view?ids=B000000001']);
  });

  it('stores no identifier, only the views of the session, and bounds them', async () => {
    const ids = Array.from({ length: 205 }, (_, i) => `B${String(i).padStart(9, '0')}`);
    window.sessionStorage.setItem('amw:views:v1', JSON.stringify(ids.map(id => `old00000:${id}`)));
    loadWidget(cards('B000000001'));
    await settle();

    const stored = JSON.parse(window.sessionStorage.getItem('amw:views:v1')!) as string[];
    expect(stored).toHaveLength(200);
    expect(stored[199]).toMatch(/^[0-9a-f]{8}:B000000001$/);
    expect(document.cookie).toBe('');
  });

  it('still counts when the stored views are malformed or the storage is blocked', async () => {
    window.sessionStorage.setItem('amw:views:v1', '{not json');
    loadWidget(cards('B000000001'));
    await settle();
    jest.advanceTimersByTime(DELAY);
    expect(viewBeacons()).toEqual(['http://localhost/item/view?ids=B000000001']);

    const blocked = jest.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => { throw new Error('blocked'); });
    await reload(cards('B000000002'));
    blocked.mockRestore();
    expect(viewBeacons()).toEqual(['http://localhost/item/view?ids=B000000002']);
  });

  it('sends at most 10 ids per beacon', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `B${String(i).padStart(9, '0')}`);
    loadWidget(cards(...ids));
    // Product requests run 5 at a time
    for (let i = 0; i < 5; i++) await settle();
    jest.advanceTimersByTime(DELAY);

    expect(viewBeacons()).toEqual([
      `http://localhost/item/view?ids=${ids.slice(0, 10).join(',')}`,
      `http://localhost/item/view?ids=${ids.slice(10).join(',')}`,
    ]);
  });

  it('does not count a product Amazon does not know or an id that is not an ASIN', async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve(url.includes('B00GONE001')
      ? { ok: false, status: 404, json: () => Promise.resolve({}) }
      : { ok: true, status: 200, json: () => Promise.resolve(product) }));
    loadWidget(cards('B00GONE001', 'not-an-asin'));
    await settle();
    jest.advanceTimersByTime(DELAY);

    expect(viewBeacons()).toEqual([]);
  });

  it('sends the pending views when the page is left or hidden', async () => {
    loadWidget(cards('B000000001'));
    await settle();
    window.dispatchEvent(new Event('pagehide'));
    expect(viewBeacons()).toHaveLength(1);

    api().destroy();
    sendBeacon.mockClear();
    loadWidget(cards('B000000002'));
    await settle();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete (document as unknown as { visibilityState?: string }).visibilityState;
    expect(viewBeacons()).toEqual(['http://localhost/item/view?ids=B000000002']);

    // Nothing left for the timer to send twice
    jest.advanceTimersByTime(DELAY);
    expect(viewBeacons()).toHaveLength(1);
  });

  it('keeps rendering when the beacon is unavailable or throws', async () => {
    sendBeacon.mockImplementation(() => { throw new TypeError('blocked'); });
    loadWidget(cards('B000000001'));
    await settle();
    expect(() => jest.advanceTimersByTime(DELAY)).not.toThrow();
    expect(document.querySelector('.amw-widget-caption')!.textContent).toBe('Arduino Uno R3');

    api().destroy();
    Object.defineProperty(navigator, 'sendBeacon', { value: undefined, configurable: true, writable: true });
    loadWidget(cards('B000000002'));
    await settle();
    expect(document.querySelector('.amw-widget-caption')!.textContent).toBe('Arduino Uno R3');
  });
});

describe('widget debug logs', () => {
  const debugLogs = () => (console.log as jest.Mock).mock.calls.map(([message]) => String(message)).filter(message => message.startsWith('AMW:'));

  function loadWithScript(attributes: string): void {
    const script = document.createElement('script');
    if (attributes) script.setAttribute(attributes, '');
    Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
    loadWidget(cards('B000000001'));
    delete (document as unknown as { currentScript?: unknown }).currentScript;
  }

  it('stays quiet by default', async () => {
    loadWithScript('');
    await settle();
    expect(debugLogs()).toEqual([]);
  });

  it('logs with data-debug', async () => {
    loadWithScript('data-debug');
    await settle();
    expect(debugLogs().join()).toContain('Initialized 1 widgets');
  });

  it('follows setApiConfig', async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve(url.includes('B00GONE001')
      ? { ok: false, status: 404, json: () => Promise.resolve({}) }
      : { ok: true, status: 200, json: () => Promise.resolve(product) }));
    loadWithScript('');
    await settle();
    expect(debugLogs()).toEqual([]);

    api().setApiConfig({ debug: true });
    const element = document.createElement('div');
    element.id = 'B00GONE001';
    document.body.appendChild(element);
    api().transformElement(element);
    await settle();

    expect(debugLogs().join()).toContain('does not know product');
  });
});
