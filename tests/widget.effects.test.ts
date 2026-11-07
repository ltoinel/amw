/**
 * @jest-environment jsdom
 *
 * Appearance effects of the cards, and the groups of their comparison (src/widgets/widget.js).
 */

export {};

const product = { title: 'A product', url: 'https://www.amazon.fr/dp/B000000001', image: 'https://m.media-amazon.com/a.jpg', price: '1 €', timestamp: 1 };
const win = window as unknown as { AMW_EFFECT?: string; AmwWidget?: { destroy(): void } };
const sendBeacon = jest.fn();

async function load(mode?: string, reducedMotion = false): Promise<void> {
  win.AmwWidget?.destroy();
  delete win.AmwWidget;
  win.AMW_EFFECT = mode;
  document.body.innerHTML = '<div class="amw" id="B000000001"></div>';
  sendBeacon.mockClear();
  (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: reducedMotion });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(product) }) as unknown as typeof fetch;
  jest.isolateModules(() => {
    require('../src/widgets/widget.js');
  });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  jest.advanceTimersByTime(1000);
}

const card = () => document.querySelector('.amw-widget') as HTMLElement;
const viewUrl = () => String(sendBeacon.mock.calls.map(([url]) => url).find(url => String(url).includes('/view')));

beforeEach(() => {
  jest.useFakeTimers();
  delete (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
  Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true, writable: true });
  window.sessionStorage.clear();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  win.AmwWidget?.destroy();
  delete win.AMW_EFFECT;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('appearance effects', () => {
  it('does nothing by default', async () => {
    await load();
    expect(card().className).not.toContain('amw-effect');
    expect(viewUrl()).not.toContain('effect=');
  });

  it.each(['fade', 'slide', 'zoom', 'pulse'])('applies %s and reports it', async effect => {
    await load(effect);
    expect(card().classList.contains(`amw-effect-${effect}`)).toBe(true);
    expect(viewUrl()).toContain(`effect=${effect}`);
  });

  it('ignores an unknown mode', async () => {
    await load('nope');
    expect(card().className).not.toContain('amw-effect');
    expect(viewUrl()).not.toContain('effect=');
  });

  it('leaves out visitors who prefer reduced motion, from the effect and from the measure', async () => {
    await load('compare', true);
    expect(card().className).not.toContain('amw-effect');
    expect(viewUrl()).not.toContain('effect=');
    expect(window.sessionStorage.getItem('amw:effect:v1')).toBeNull();
  });

  it('reports the effect with a click', async () => {
    await load('fade');
    sendBeacon.mockClear();
    (document.querySelector('.amw-widget-main-link') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(String(sendBeacon.mock.calls[0][0])).toContain('/click?id=B000000001&effect=fade');
  });
});

describe('compare mode', () => {
  it('keeps one group for the tab session, and reports it', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    await load('compare');
    expect(window.sessionStorage.getItem('amw:effect:v1')).toBe('slide');
    expect(viewUrl()).toContain('effect=slide');

    (Math.random as jest.Mock).mockReturnValue(0);
    await load('compare');
    expect(card().classList.contains('amw-effect-slide')).toBe(true);
  });

  it('shows nothing to the control group, and still reports it', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    await load('compare');
    expect(card().className).not.toContain('amw-effect');
    expect(viewUrl()).toContain('effect=none');
  });

  it('reaches every group', async () => {
    const random = jest.spyOn(Math, 'random');
    const seen = new Set<string>();
    for (const value of [0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
      window.sessionStorage.clear();
      random.mockReturnValue(value);
      await load('compare');
      seen.add(window.sessionStorage.getItem('amw:effect:v1') as string);
    }
    expect([...seen].sort()).toEqual(['fade', 'none', 'pulse', 'slide', 'zoom']);
  });

  it('replaces a stored value that is not a group, and survives a blocked storage', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    window.sessionStorage.setItem('amw:effect:v1', '<b>');
    await load('compare');
    expect(window.sessionStorage.getItem('amw:effect:v1')).toBe('slide');

    window.sessionStorage.clear();
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    await load('compare');
    expect(card().classList.contains('amw-effect-slide')).toBe(true);
  });
});

describe('list of effects', () => {
  it('is the same in the server, the script and the stylesheet', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const { WIDGET_EFFECTS } = jest.requireActual('../src/server/Settings') as { WIDGET_EFFECTS: readonly string[] };
    const script = fs.readFileSync(path.join(__dirname, '../src/widgets/widget.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '../src/widgets/widget.css'), 'utf8');

    expect(script.match(/const EFFECTS = \[([^\]]+)\]/)![1].match(/[a-z]+/g)).toEqual([...WIDGET_EFFECTS]);
    expect([...new Set([...css.matchAll(/\.amw-effect-([a-z]+)/g)].map(([, name]) => name))].sort())
      .toEqual(WIDGET_EFFECTS.filter(effect => effect !== 'none').sort());
  });
});
