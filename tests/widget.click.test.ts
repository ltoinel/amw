/**
 * @jest-environment jsdom
 *
 * Click beacon sent by the widget (src/widgets/widget.js) when its affiliate link is followed.
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
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function loadWidget(id: string): void {
  const body = document.createElement('body');
  body.innerHTML = `<div class="amw" id="${id}"></div>`;
  document.documentElement.replaceChild(body, document.body);
  jest.isolateModules(() => {
    require('../src/widgets/widget.js');
  });
}

async function renderedLink(id = 'B084DN3XVN'): Promise<HTMLAnchorElement> {
  loadWidget(id);
  await flush();
  const link = document.querySelector('.amw-widget-main-link') as HTMLAnchorElement;
  // jsdom does not implement navigation
  link.addEventListener('click', (event) => event.preventDefault());
  return link;
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(product) }) as unknown as typeof fetch;
  Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true, writable: true });
  sendBeacon.mockReturnValue(true);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  (window as unknown as { AmwWidget?: { destroy(): void } }).AmwWidget?.destroy();
  jest.restoreAllMocks();
});

describe('widget click beacon', () => {
  it('sends the ASIN to /click when the affiliate link is clicked', async () => {
    const link = await renderedLink();
    link.click();

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon).toHaveBeenCalledWith('http://localhost/item/click?id=B084DN3XVN');
  });

  it('counts a middle click but not a right click', async () => {
    const link = await renderedLink();
    link.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    link.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 2 }));

    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it('ignores ids that are not ASINs', async () => {
    const link = await renderedLink('my-product');
    link.click();

    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('does nothing when sendBeacon is unavailable or throws', async () => {
    const link = await renderedLink();
    sendBeacon.mockImplementation(() => { throw new TypeError('blocked'); });
    expect(() => link.click()).not.toThrow();

    Object.defineProperty(navigator, 'sendBeacon', { value: undefined, configurable: true, writable: true });
    expect(() => link.click()).not.toThrow();
  });
});
