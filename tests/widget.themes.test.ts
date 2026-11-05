/**
 * @jest-environment jsdom
 *
 * Widget themes: selection by the script and the stylesheet's guarantees for each design.
 */

import fs from 'fs';
import path from 'path';
import { WIDGET_THEMES } from '../src/server/Settings';

const css = fs.readFileSync(path.join(__dirname, '../src/widgets/widget.css'), 'utf8');
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
