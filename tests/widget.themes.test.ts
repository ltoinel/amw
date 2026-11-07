/**
 * @jest-environment jsdom
 *
 * Widget themes: selection by the script and the stylesheet's guarantees for each design.
 */

import fs from 'fs';
import path from 'path';
import { WIDGET_THEMES } from '../src/server/Settings';

const widgetsDir = path.join(__dirname, '../src/widgets');
const baseCss = fs.readFileSync(path.join(widgetsDir, 'widget.css'), 'utf8');
const themeFiles = fs.readdirSync(path.join(widgetsDir, 'themes')).filter(file => file.endsWith('.css'));
const css = [baseCss, ...themeFiles.map(file => fs.readFileSync(path.join(widgetsDir, 'themes', file), 'utf8'))].join('\n');
const script = fs.readFileSync(path.join(__dirname, '../src/widgets/widget.js'), 'utf8');

type Tokens = Record<string, string>;

function tokensOf(selector: string): Tokens {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const block = css.slice(start, css.indexOf('\n}', start));
  return Object.fromEntries([...block.matchAll(/(--amw-[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

const defaults = tokensOf('.amw-widget');

/** A theme only declares what it changes: the rest comes from the base rule. */
function resolvedTokens(theme: string): Tokens {
  return theme === 'default' ? defaults : { ...defaults, ...tokensOf(`.amw-widget[data-amw-theme="${theme}"]`) };
}

function luminance(hex: string): number {
  const digits = hex.slice(1);
  const full = digits.length === 3 ? digits.replace(/./g, '$&$&') : digits;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const hex = (value: string) => (/^#[0-9a-f]{3,6}$/i.test(value) ? value : null);

describe('theme definitions', () => {
  it('lists the same themes in the server, the script and the stylesheet', () => {
    const listed = script.match(/const THEMES = \[([^\]]+)\]/)![1].match(/[a-z]+/g);
    expect(listed).toEqual([...WIDGET_THEMES]);

    const inCss = [...css.matchAll(/^\.amw-widget\[data-amw-theme="(\w+)"\] \{/gm)].map(([, name]) => name);
    expect([...new Set(inCss)].sort()).toEqual(WIDGET_THEMES.filter(theme => theme !== 'default').sort());
  });

  it('keeps each theme in its own file, and none in the base stylesheet', () => {
    expect(baseCss).not.toContain('data-amw-theme=');
    expect(themeFiles.sort()).toEqual(WIDGET_THEMES.filter(theme => theme !== 'default').map(theme => `${theme}.css`).sort());
    themeFiles.forEach(file => {
      const theme = file.replace('.css', '');
      const content = fs.readFileSync(path.join(widgetsDir, 'themes', file), 'utf8');
      const named = [...content.matchAll(/data-amw-theme="(\w+)"/g)].map(([, name]) => name);
      expect(new Set(named)).toEqual(new Set([theme]));
      // Every rule belongs to the theme: it cannot change a card of another design
      content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{[^}]*\}/g, '\n').split('\n')
        .map(line => line.trim()).filter(Boolean)
        .forEach(selector => expect(selector).toContain(`data-amw-theme="${theme}"`));
    });
  });

  it('only overrides tokens that the base rule declares', () => {
    WIDGET_THEMES.forEach(theme => {
      expect(Object.keys(resolvedTokens(theme)).sort()).toEqual(Object.keys(defaults).sort());
    });
  });

  it('does not load web fonts or any other third-party resource', () => {
    expect(css).not.toMatch(/@import|@font-face|url\(/);
  });

  // The native theme takes its colors from the host page, whose contrast is the host's own
  it.each(WIDGET_THEMES.filter(theme => theme !== 'native'))('keeps %s readable (WCAG AA)', theme => {
    const tokens = resolvedTokens(theme);
    const priceBackground = hex(tokens['--amw-price-bg']) ?? tokens['--amw-surface'];
    const pairs: [string, string, string][] = [
      ['title', tokens['--amw-text'], tokens['--amw-surface']],
      // Price date and affiliate disclosure: required by Amazon, so they must stay legible
      ['disclaimer', tokens['--amw-text-muted'], tokens['--amw-surface']],
      ['price', tokens['--amw-price'], priceBackground],
      ['buy', tokens['--amw-buy-text'], tokens['--amw-buy-bg']],
      ['savings', tokens['--amw-badge-text'], tokens['--amw-badge-bg']],
    ];
    pairs.forEach(([name, foreground, background]) => {
      expect({ name, ratio: contrast(foreground, background) >= 4.5 }).toEqual({ name, ratio: true });
    });
  });
});

describe('theme selection', () => {
  type Api = { destroy(): void; setApiConfig(config: { theme: string }): void; transformElement(element: Element): void; config: { theme: string } };
  const win = window as unknown as { AmwWidget: Api; AMW_DEFAULT_THEME?: string };

  function loadWidget(attribute?: string): Api {
    const body = document.createElement('body');
    body.innerHTML = '<div class="amw" id="B000000001"></div>';
    document.documentElement.replaceChild(body, document.body);
    const current = document.createElement('script');
    if (attribute !== undefined) current.setAttribute('data-theme', attribute);
    Object.defineProperty(document, 'currentScript', { value: current, configurable: true });
    jest.isolateModules(() => {
      require('../src/widgets/widget.js');
    });
    return win.AmwWidget;
  }

  const card = () => document.getElementById('B000000001') as HTMLElement;

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve({ title: 'Product', url: 'https://www.amazon.fr/dp/B000000001', image: '', price: '1 €', timestamp: 0 }),
    }) as unknown as typeof fetch;
    delete win.AMW_DEFAULT_THEME;
    window.sessionStorage.clear();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    win.AmwWidget.destroy();
    delete (document as unknown as { currentScript?: unknown }).currentScript;
    jest.restoreAllMocks();
  });

  it('marks no theme by default, so the base look applies', () => {
    loadWidget();
    expect(card().hasAttribute('data-amw-theme')).toBe(false);
  });

  it('applies the theme of the server', () => {
    win.AMW_DEFAULT_THEME = 'blueprint';
    loadWidget();
    expect(card().getAttribute('data-amw-theme')).toBe('blueprint');
  });

  it('lets the script attribute override the server, even with the default look', () => {
    win.AMW_DEFAULT_THEME = 'blueprint';
    loadWidget(' Shelf ');
    expect(card().getAttribute('data-amw-theme')).toBe('shelf');

    win.AmwWidget.destroy();
    loadWidget('default');
    expect(card().hasAttribute('data-amw-theme')).toBe(false);
  });

  it('ignores an unknown theme with a warning, falling back to the next source', () => {
    win.AMW_DEFAULT_THEME = 'outdoor';
    loadWidget('"><img src=x onerror=alert(1)>');
    expect(card().getAttribute('data-amw-theme')).toBe('outdoor');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('unknown theme'));

    win.AmwWidget.destroy();
    delete win.AMW_DEFAULT_THEME;
    loadWidget('nope');
    expect(card().hasAttribute('data-amw-theme')).toBe(false);
  });

  it('keeps the theme on lazy and loaded cards', () => {
    const observe = jest.fn();
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = jest.fn(() => ({ observe, unobserve: jest.fn(), disconnect: jest.fn() }));
    loadWidget('receipt');
    expect(card().className).toContain('amw-widget-lazy');
    expect(card().getAttribute('data-amw-theme')).toBe('receipt');
    delete (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
  });

  it('changes the widgets rendered after setApiConfig only, and keeps the current theme on a bad name', () => {
    const api = loadWidget('shelf');
    api.setApiConfig({ theme: 'native' });
    expect(card().getAttribute('data-amw-theme')).toBe('shelf');

    const later = Object.assign(document.createElement('div'), { id: 'B000000002' });
    api.transformElement(later);
    expect(later.getAttribute('data-amw-theme')).toBe('native');

    api.setApiConfig({ theme: 'nope' });
    expect(api.config.theme).toBe('native');
  });
});

describe('widget on a site that is not allowed', () => {
  afterEach(() => {
    delete (window as unknown as { AMW_ALLOWED_SITES?: string[] }).AMW_ALLOWED_SITES;
    delete (window as unknown as { AmwWidget?: unknown }).AmwWidget;
    document.body.innerHTML = '';
  });

  function run(sites: string[]): void {
    // Left by the tests above
    delete (window as unknown as { AmwWidget?: unknown }).AmwWidget;
    (window as unknown as { AMW_ALLOWED_SITES: string[] }).AMW_ALLOWED_SITES = sites;
    document.body.innerHTML = '<div class="amw" id="B084DN3XVN"></div>';
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.isolateModules(() => {
      require('../src/widgets/widget.js');
    });
  }

  it('stays silent: no card, no request and no public API', () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    run(['www.example.com']);

    expect((window as unknown as { AmwWidget?: unknown }).AmwWidget).toBeUndefined();
    expect(document.querySelector('.amw-widget')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runs on a listed site', () => {
    run([window.location.host]);

    expect((window as unknown as { AmwWidget?: unknown }).AmwWidget).toBeDefined();
  });
});

describe('stylesheets of the widget', () => {
  type Api = { destroy(): void; setApiConfig(config: { theme: string }): void; transformElement(element: Element): void };
  const win = window as unknown as { AmwWidget: Api; AMW_DEFAULT_THEME?: string };
  const links = () => [...document.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]')].map(link => new URL(link.href).pathname.replace(/^.*\/item\//, ''));

  function load(theme?: string): void {
    document.head.innerHTML = '';
    document.body.innerHTML = '<div class="amw" id="B084DN3XVN"></div>';
    if (theme) win.AMW_DEFAULT_THEME = theme;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ title: 't', url: 'https://www.amazon.fr/dp/B084DN3XVN', image: 'https://m.media-amazon.com/a.jpg', price: '1 €', timestamp: 1 }) }) as unknown as typeof fetch;
    jest.isolateModules(() => {
      require('../src/widgets/widget.js');
    });
  }

  afterEach(() => {
    win.AmwWidget?.destroy();
    delete win.AMW_DEFAULT_THEME;
  });

  it('only loads the base stylesheet with the default theme', () => {
    load();
    expect(links()).toEqual(['widget.css']);
  });

  it('loads the base and the active theme, and no other design', () => {
    load('shelf');
    expect(links()).toEqual(['widget.css', 'themes/shelf.css']);
  });

  it('loads a theme chosen later once, for the widgets rendered afterwards', () => {
    load();
    win.AmwWidget.setApiConfig({ theme: 'receipt' });
    expect(links()).toEqual(['widget.css']);

    [1, 2].forEach(() => {
      const element = document.createElement('div');
      element.id = 'B084DN3XVN';
      document.body.appendChild(element);
      win.AmwWidget.transformElement(element);
    });

    expect(links()).toEqual(['widget.css', 'themes/receipt.css']);
  });
});
