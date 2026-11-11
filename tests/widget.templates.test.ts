/**
 * @jest-environment jsdom
 *
 * Card templates (src/widgets/templates): chosen per card or for the site, filled without ever
 * reading product data as markup.
 */

import fs from 'fs';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readTemplates } = require('../scripts/widget-templates');

const product = {
  asin: 'B084DN3XVN',
  title: 'Arduino Uno R3',
  image: 'https://m.media-amazon.com/images/I/arduino.jpg',
  url: 'https://www.amazon.fr/dp/B084DN3XVN?tag=test-21',
  price: '24,99 €',
  timestamp: Date.UTC(2026, 0, 1),
};

interface AmwWidgetApi {
  destroy(): void;
  setApiConfig(config: { template?: string }): void;
  transformElement(element: Element): void;
}

declare global {
  interface Window { AmwWidget: AmwWidgetApi }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function loadWidget(bodyHtml: string, scriptAttributes: Record<string, string> = {}): AmwWidgetApi {
  document.head.innerHTML = '';
  const body = document.createElement('body');
  body.innerHTML = bodyHtml;
  document.documentElement.replaceChild(body, document.body);
  document.documentElement.setAttribute('lang', 'en');
  const script = document.createElement('script');
  Object.entries(scriptAttributes).forEach(([name, value]) => script.setAttribute(name, value));
  Object.defineProperty(document, 'currentScript', { configurable: true, get: () => script });
  try {
    jest.isolateModules(() => {
      require('../src/widgets/widget.js');
    });
  } finally {
    delete (document as unknown as Record<string, unknown>).currentScript;
  }
  return window.AmwWidget;
}

beforeEach(() => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(product) })) as unknown as typeof fetch;
  window.sessionStorage.clear();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  window.AmwWidget?.destroy();
  jest.restoreAllMocks();
});

describe('card templates', () => {
  it('keeps the default card, with its texts, ids and description', async () => {
    loadWidget('<div class="amw" id="B084DN3XVN"></div>');
    await flush();
    const card = document.getElementById('B084DN3XVN')!;

    expect(card.hasAttribute('data-amw-card')).toBe(false);
    expect(card.querySelector('.amw-widget-banner')).not.toBeNull();
    expect(card.querySelector('.amw-widget-btn-warning')!.textContent).toBe('See the offer on Amazon');
    expect(card.querySelector('.amw-widget-body > .amw-widget-visually-hidden')!.textContent).toBe('(sponsored link, opens in a new tab)');
    const link = card.querySelector('.amw-widget-main-link')!;
    const [update, disclosure] = link.getAttribute('aria-describedby')!.split(' ');
    expect(document.getElementById(update)!.className).toBe('amw-widget-timestamp');
    expect(document.getElementById(disclosure)!.className).toBe('amw-widget-disclosure');
    expect(card.querySelector('.amw-widget-caption')!.textContent).toBe('Arduino Uno R3');
    // Nothing of the template's mechanics stays in the page
    expect(card.querySelector('[data-amw-text]')).toBeNull();
  });

  it('gives each card its own ids', async () => {
    loadWidget('<div class="amw" id="B000000001"></div><div class="amw" id="B000000002"></div>');
    await flush();
    const ids = [...document.querySelectorAll('.amw-widget-timestamp')].map(node => node.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('uses the template of a card, over the one of the site', async () => {
    loadWidget('<div class="amw" id="B000000001"></div><div class="amw" id="B000000002" data-amw-template="default"></div>', { 'data-template': 'compact' });
    await flush();
    const [compact, standard] = ['B000000001', 'B000000002'].map(id => document.getElementById(id)!);

    expect(compact.getAttribute('data-amw-card')).toBe('compact');
    expect(compact.querySelector('.amw-widget-main-link')!.classList.contains('amw-widget-compact')).toBe(true);
    expect(compact.querySelector('.amw-widget-banner')).toBeNull();
    // Filled like any card
    expect(compact.querySelector('.amw-widget-caption')!.textContent).toBe('Arduino Uno R3');
    expect(compact.querySelector('.amw-widget-price')!.textContent).toBe('24,99 €');
    expect(standard.hasAttribute('data-amw-card')).toBe(false);
  });

  it('keeps the default card for an unknown or unsafe name', async () => {
    loadWidget('<div class="amw" id="B000000001" data-amw-template="missing"></div><div class="amw" id="B000000002" data-amw-template="__proto__"></div>', { 'data-template': '<b>x</b>' });
    await flush();
    for (const id of ['B000000001', 'B000000002']) {
      const card = document.getElementById(id)!;
      expect(card.hasAttribute('data-amw-card')).toBe(false);
      expect(card.querySelector('.amw-widget-banner')).not.toBeNull();
    }
    expect(console.warn).toHaveBeenCalledWith('AMW: unknown template ignored: missing');
  });

  it('lets the page choose the template of the cards rendered afterwards', async () => {
    const api = loadWidget('');
    api.setApiConfig({ template: 'compact' });
    const element = document.createElement('div');
    element.id = 'B000000003';
    document.body.appendChild(element);
    api.transformElement(element);
    await flush();
    expect(element.getAttribute('data-amw-card')).toBe('compact');
  });

  it('drops the disclosure of a template when the site turns it off', async () => {
    loadWidget('<div class="amw" id="B000000001" data-amw-template="compact"></div>', { 'data-disclosure': 'off' });
    await flush();
    const card = document.getElementById('B000000001')!;
    expect(card.querySelector('.amw-widget-disclosure')).toBeNull();
    expect(card.querySelector('.amw-widget-main-link')!.getAttribute('aria-describedby')).toMatch(/^amw-widget-\d+-update$/);
  });

  it('never reads product data as markup', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ ...product, title: '<img src=x onerror="window.pwned=1">', price: '<b>1 €</b>' })
    })) as unknown as typeof fetch;
    loadWidget('<div class="amw" id="B000000001" data-amw-template="compact"></div>');
    await flush();
    const card = document.getElementById('B000000001')!;
    expect(card.querySelector('.amw-widget-caption img')).toBeNull();
    expect(card.querySelector('.amw-widget-price b')).toBeNull();
    expect(card.querySelector('.amw-widget-caption')!.textContent).toContain('<img');
  });
});

describe('template files', () => {
  const templates: Record<string, string> = readTemplates();
  const REQUIRED = ['amw-widget-main-link', 'amw-widget-img', 'amw-widget-caption', 'amw-widget-price', 'amw-widget-timestamp', 'amw-widget-content', 'amw-widget-body', 'amw-widget-spinner'];

  it.each(Object.keys(templates))('%s holds every element the widget fills, and no script', name => {
    const html = templates[name];
    REQUIRED.forEach(className => expect(html).toMatch(new RegExp(`class="[^"]*\\b${className}\\b`)));
    expect(html).not.toMatch(/<script|\bon\w+=|javascript:|\$\{/i);
  });

  it('ships the default card, and only valid names', () => {
    expect(Object.keys(templates)).toContain('default');
    const files = fs.readdirSync(path.join(__dirname, '../src/widgets/templates'));
    expect(files.every(file => /^[a-z][a-z0-9-]*\.html$/.test(file))).toBe(true);
  });

  it('refuses a template directory without a default card', () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'amw-templates-'));
    try {
      fs.writeFileSync(path.join(dir, 'compact.html'), '<a></a>');
      expect(() => readTemplates(dir)).toThrow(/default\.html is missing/);
      fs.writeFileSync(path.join(dir, 'Bad_Name.html'), '<a></a>');
      expect(() => readTemplates(dir)).toThrow(/Invalid template name/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
