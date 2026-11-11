/**
 * @jest-environment jsdom
 *
 * Appearance effects of the cards, and the groups of their comparison (src/widgets/widget.js).
 */

export {};

const product = { title: 'A product', url: 'https://www.amazon.fr/dp/B000000001', image: 'https://m.media-amazon.com/a.jpg', price: '1 €', timestamp: 1 };
const win = window as unknown as { AMW_SITE_SETTINGS?: unknown; AMW_EFFECT?: string; AMW_EFFECTS?: unknown; AMW_THEMES?: unknown; AMW_LABEL?: string; AMW_LABELS?: unknown; AmwWidget?: { destroy(): void; setApiConfig(config: object): void } };
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
  delete win.AMW_EFFECTS;
  delete win.AMW_THEMES;
  delete win.AMW_LABEL;
  delete win.AMW_LABELS;
  delete win.AMW_SITE_SETTINGS;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('appearance effects', () => {
  it('does nothing by default', async () => {
    await load();
    expect(card().className).not.toContain('amw-effect');
    expect(viewUrl()).not.toContain('effect=');
  });

  it.each(['fade', 'slide', 'zoom', 'pulse', 'shine'])('applies %s and reports it', async effect => {
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
    jest.spyOn(Math, 'random').mockReturnValue(0.4);
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
    expect([...seen].sort()).toEqual(['fade', 'none', 'pulse', 'shine', 'slide', 'zoom']);
  });

  it('replaces a stored value that is not a group, and survives a blocked storage', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.4);
    window.sessionStorage.setItem('amw:effect:v1', '<b>');
    await load('compare');
    expect(window.sessionStorage.getItem('amw:effect:v1')).toBe('slide');

    window.sessionStorage.clear();
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    await load('compare');
    expect(card().classList.contains('amw-effect-slide')).toBe(true);
  });
});

describe('effects chosen in the portal', () => {
  it('draws only from them', async () => {
    const random = jest.spyOn(Math, 'random');
    const seen = new Set<string>();
    win.AMW_EFFECTS = ['none', 'zoom'];
    for (const value of [0, 0.4, 0.6, 0.99]) {
      window.sessionStorage.clear();
      random.mockReturnValue(value);
      await load('compare');
      seen.add(window.sessionStorage.getItem('amw:effect:v1') as string);
    }
    expect([...seen].sort()).toEqual(['none', 'zoom']);
  });

  it('draws again a stored effect left out since, and ignores a list too short to compare', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.99);
    window.sessionStorage.setItem('amw:effect:v1', 'fade');
    win.AMW_EFFECTS = ['none', 'zoom'];
    await load('compare');
    expect(window.sessionStorage.getItem('amw:effect:v1')).toBe('zoom');

    window.sessionStorage.clear();
    win.AMW_EFFECTS = ['zoom', 'unknown'];
    await load('compare');
    expect(window.sessionStorage.getItem('amw:effect:v1')).toBe('shine');
  });
});

describe('theme test', () => {
  it('gives the tab session one of the themes, over data-theme, and reports it', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.99);
    win.AMW_THEMES = ['shelf', 'neon'];
    await load();
    expect(card().getAttribute('data-amw-theme')).toBe('neon');
    expect(window.sessionStorage.getItem('amw:theme:v1')).toBe('neon');
    expect(viewUrl()).toContain('theme=neon');
    expect(viewUrl()).not.toContain('effect=');
  });

  it('reports nothing without a test, or once the page chose its own theme', async () => {
    await load();
    expect(viewUrl()).not.toContain('theme=');

    win.AMW_THEMES = ['shelf', 'neon'];
    await load();
    win.AmwWidget!.setApiConfig({ theme: 'pastel' });
    sendBeacon.mockClear();
    (document.querySelector('.amw-widget-main-link') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(String(sendBeacon.mock.calls[0][0])).not.toContain('theme=');
  });

  it('ignores unknown themes and a list too short to compare', async () => {
    win.AMW_THEMES = ['shelf', '"><script>'];
    await load();
    expect(card().hasAttribute('data-amw-theme')).toBe(false);
    expect(viewUrl()).not.toContain('theme=');
  });
});

describe('preview of the portal', () => {
  afterEach(() => {
    delete (document as unknown as { currentScript?: unknown }).currentScript;
  });

  it('shows the sample with the values previewed, without request nor beacon', async () => {
    const script = document.createElement('script');
    script.setAttribute('data-preview', JSON.stringify({ theme: 'neon', effect: 'zoom', label: 'buy', product: { ...product, image: 'preview.svg' } }));
    Object.defineProperty(document, 'currentScript', { configurable: true, get: () => script });
    win.AMW_LABEL = 'view';
    win.AMW_LABELS = ['view', 'offer'];
    await load('fade');

    expect(card().classList.contains('amw-effect-zoom')).toBe(true);
    expect(card().getAttribute('data-amw-theme')).toBe('neon');
    expect(card().textContent).toContain('Buy on Amazon');
    expect((card().querySelector('img') as HTMLImageElement).src).toMatch(/^http:\/\/localhost\/.*preview\.svg$/);
    expect(global.fetch).not.toHaveBeenCalled();
    card().querySelector('a')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('ignores a preview that is not a sample', async () => {
    const script = document.createElement('script');
    script.setAttribute('data-preview', 'not json');
    Object.defineProperty(document, 'currentScript', { configurable: true, get: () => script });
    await load('fade');
    expect(global.fetch).toHaveBeenCalled();
  });
});

describe('settings of one site', () => {
  it('applies the settings of the host of the page over those of every site, null removing one', async () => {
    win.AMW_LABEL = 'buy';
    win.AMW_SITE_SETTINGS = { [window.location.host]: { AMW_EFFECT: 'zoom', AMW_LABEL: null, AMW_ALLOWED_SITES: ['evil.example'], 'not a name': 1 } };
    await load('fade');
    expect(card().classList.contains('amw-effect-zoom')).toBe(true);
    expect(win.AMW_LABEL).toBeUndefined();
    expect((window as unknown as { AMW_ALLOWED_SITES?: unknown }).AMW_ALLOWED_SITES).toBeUndefined();
  });

  it('keeps the settings of every site on another host', async () => {
    win.AMW_SITE_SETTINGS = { 'other.example': { AMW_EFFECT: 'zoom' } };
    await load('fade');
    expect(card().classList.contains('amw-effect-fade')).toBe(true);
  });
});

describe('button label', () => {
  const button = () => document.querySelector('.amw-widget-btn-warning')!.textContent;

  it('says "See the offer" by default, or the label chosen in the portal, without reporting it', async () => {
    document.documentElement.lang = 'en';
    await load();
    expect(button()).toBe('See the offer on Amazon');
    win.AMW_LABEL = 'buy';
    await load();
    expect(button()).toBe('Buy on Amazon');
    expect(viewUrl()).not.toContain('label=');
  });

  it('gives the tab session one of the labels compared, and reports it', async () => {
    document.documentElement.lang = 'en';
    jest.spyOn(Math, 'random').mockReturnValue(0.99);
    win.AMW_LABELS = ['offer', 'view'];
    await load();
    expect(button()).toBe('View on Amazon');
    expect(window.sessionStorage.getItem('amw:label:v1')).toBe('view');
    expect(viewUrl()).toContain('label=view');
  });

  it('ignores unknown labels and a list too short to compare', async () => {
    document.documentElement.lang = 'en';
    win.AMW_LABEL = '<script>';
    win.AMW_LABELS = ['offer', '"><img>'];
    await load();
    expect(button()).toBe('See the offer on Amazon');
    expect(viewUrl()).not.toContain('label=');
  });
});

describe('visits', () => {
  it('counts the visit with the first views of the page, once per tab session', async () => {
    await load();
    expect(viewUrl()).toContain('&visit=1');

    // The same page again in the same tab session: its new views are counted, not a new visit
    sendBeacon.mockClear();
    win.AmwWidget?.destroy();
    delete win.AmwWidget;
    document.body.innerHTML = '<div class="amw" id="B000000002"></div>';
    jest.isolateModules(() => {
      require('../src/widgets/widget.js');
    });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    jest.advanceTimersByTime(1000);
    const url = String(sendBeacon.mock.calls.map(([call]) => call).find(call => String(call).includes('/view')));
    expect(url).toContain('ids=B000000002');
    expect(url).not.toContain('visit=1');
  });
});

describe('banners of the site', () => {
  it('shows a banner without the Amazon marks, and counts nothing', async () => {
    // Structured data left by the cards of the tests before
    document.querySelectorAll('script[type="application/ld+json"]').forEach(script => script.remove());
    win.AmwWidget?.destroy();
    delete win.AmwWidget;
    document.body.innerHTML = '<div class="amw" id="B000000001"></div>';
    sendBeacon.mockClear();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({
      custom: true, id: 'newsletter', title: '<b>Join</b> the newsletter', image: 'https://example.com/n.png', url: 'javascript:alert(1)', label: 'Subscribe'
    }) }) as unknown as typeof fetch;
    jest.isolateModules(() => {
      require('../src/widgets/widget.js');
    });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    jest.advanceTimersByTime(1000);

    expect(card().classList.contains('amw-widget-custom')).toBe(true);
    expect(card().querySelector('.amw-widget-caption')!.textContent).toBe('<b>Join</b> the newsletter');
    expect(card().querySelector('b')).toBeNull();
    expect(card().querySelector('.amw-widget-btn-warning')!.textContent).toBe('Subscribe');
    for (const mark of ['.amw-widget-price', '.amw-widget-text', '.amw-widget-banner']) {
      expect(card().querySelector(mark)).toBeNull();
    }
    expect(card().textContent).not.toContain('Amazon');
    const link = card().querySelector('a')!;
    // An unsafe link is not followed
    expect(link.getAttribute('href')).toBe('#');
    expect(link.getAttribute('rel')).toBe('noopener');
    link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(document.querySelector('script[type="application/ld+json"]')).toBeNull();
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

  it('is the same in the forms of the portal, as the themes', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const { WIDGET_EFFECTS, WIDGET_THEMES, BUTTON_LABELS } = jest.requireActual('../src/server/Settings') as Record<string, readonly string[]>;
    const view = fs.readFileSync(path.join(__dirname, '../admin/src/components/AbTestsView.vue'), 'utf8');
    const ids = (list: string) => [...view.match(new RegExp(`const ${list}[^=]*= \\[([\\s\\S]*?)\\];`))![1].matchAll(/id: '([a-z]+)'/g)].map(([, id]) => id);

    expect(ids('EFFECTS')).toEqual([...WIDGET_EFFECTS]);
    expect(ids('LABELS')).toEqual([...BUTTON_LABELS]);
    expect(view.match(/const THEMES = \[([^\]]+)\]/)![1].match(/[a-z]+/g)).toEqual([...WIDGET_THEMES]);
  });
});
