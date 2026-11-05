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

type Api = { destroy(): void; transformElement(element: Element): void };
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

  it('counts each card when a product is shown twice, with a single product request', async () => {
    loadWidget('<div class="amw" id="B000000001"></div><section><div class="amw" id="B000000001"></div></section>');
    await settle();
    jest.advanceTimersByTime(DELAY);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(viewBeacons()).toEqual(['http://localhost/item/view?ids=B000000001,B000000001']);
  });

  it('counts a card served by the session cache, without any product request', async () => {
    loadWidget(cards('B000000001'));
    await settle();
    jest.advanceTimersByTime(DELAY);
    fetchMock.mockClear();
    sendBeacon.mockClear();

    api().destroy();
    loadWidget(cards('B000000001'));
    await settle();
    jest.advanceTimersByTime(DELAY);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(viewBeacons()).toEqual(['http://localhost/item/view?ids=B000000001']);
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
