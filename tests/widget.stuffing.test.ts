/**
 * @jest-environment jsdom
 *
 * Stuffing: the cards widget.js adds to an article (src/widgets/widget.js).
 */

export {};

describe('stuffing', () => {
  type Setting = { count: number; containerId: string; wordsPerCard?: number; sites?: Record<string, number> };
  const win = window as unknown as { AMW_STUFFING?: Setting; AmwWidget?: { destroy(): void } };
  const ARTICLE = `<main id="main-content">
    <p>Intro</p><h2>A</h2><p>Text</p><h3>B</h3><p>Text</p><h2>C</h2><ul><li>x</li></ul><h2>D</h2><p>Text</p><h2>E</h2><p>Text</p>
  </main>`;
  const cardsOf = () => [...document.querySelectorAll<HTMLElement>('[data-amw-slot]')];
  const nextHeadings = () => cardsOf().map(card => card.nextElementSibling?.textContent);

  function load(stuffing: Setting | undefined, html = ARTICLE): void {
    win.AmwWidget?.destroy();
    delete win.AmwWidget;
    win.AMW_STUFFING = stuffing;
    document.body.innerHTML = html;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ title: 't', url: 'https://www.amazon.fr/dp/B084DN3XVN', image: 'https://m.media-amazon.com/a.jpg', price: '1 €', timestamp: 1 }) }) as unknown as typeof fetch;
    jest.isolateModules(() => {
      require('../src/widgets/widget.js');
    });
  }

  afterEach(() => {
    win.AmwWidget?.destroy();
    delete win.AMW_STUFFING;
    delete win.AmwWidget;
    document.body.innerHTML = '';
    window.sessionStorage.clear();
  });

  it('adds nothing without the setting, with 0, or without the container', () => {
    load(undefined);
    expect(cardsOf()).toEqual([]);
    load({ count: 0, containerId: 'main-content' });
    expect(cardsOf()).toEqual([]);
    load({ count: 2, containerId: 'elsewhere' });
    expect(cardsOf()).toEqual([]);
  });

  it('places a card after a paragraph and before a heading, with its own slot', () => {
    load({ count: 1, containerId: 'main-content' });

    expect(cardsOf().map(card => card.getAttribute('data-amw-slot'))).toEqual(['0']);
    expect(nextHeadings()).toEqual(['A']);
    expect(cardsOf()[0].previousElementSibling?.tagName).toBe('P');
  });

  it('spreads the cards, never after something else than a paragraph', () => {
    load({ count: 2, containerId: 'main-content' });

    // A, B, C and E: D follows a list
    expect(nextHeadings()).toEqual(['A', 'C']);
    load({ count: 4, containerId: 'main-content' });
    expect(nextHeadings()).toEqual(['A', 'B', 'C', 'E']);
  });

  it('adds fewer cards to a short article', () => {
    load({ count: 5, containerId: 'main-content' }, '<div id="main-content"><p>x</p><h2>A</h2><p>y</p></div>');
    expect(nextHeadings()).toEqual(['A']);
  });

  it('only looks inside the container', () => {
    load({ count: 3, containerId: 'main-content' }, '<aside><p>x</p><h2>Out</h2></aside><div id="main-content"><p>y</p><h2>In</h2></div>');
    expect(nextHeadings()).toEqual(['In']);
  });

  it('leaves alone a heading next to a card of the author', () => {
    load({ count: 3, containerId: 'main-content' }, '<div id="main-content"><p>x</p><h2>A</h2><div class="amw" id="B084DN3XVN"></div><p>y</p><h2>B</h2></div>');
    expect(nextHeadings()).toEqual(['B']);
  });

  it('requests a different product per card, without a slot for the first one', async () => {
    load({ count: 2, containerId: 'main-content' });
    for (let i = 0; i < 20; i++) await Promise.resolve();

    const urls = (global.fetch as jest.Mock).mock.calls.map(([url]) => String(url));
    expect(urls.some(url => /page=[0-9a-f]{32}$/.test(url))).toBe(true);
    expect(urls.some(url => /page=[0-9a-f]{32}&slot=1$/.test(url))).toBe(true);
  });

  it('counts the cards the author placed in the article, those without an id taking the first ranks', () => {
    const article = '<div id="main-content"><div class="amw"></div><p>a</p><h2>A</h2><p>b</p><h2>B</h2><p>c</p><h2>C</h2></div>';
    load({ count: 3, containerId: 'main-content' }, article);
    expect(cardsOf().map(card => card.getAttribute('data-amw-slot'))).toEqual(['1', '2']);

    load({ count: 3, containerId: 'main-content' }, article.replace('class="amw"', 'class="amw" id="B084DN3XVN"'));
    expect(cardsOf().map(card => card.getAttribute('data-amw-slot'))).toEqual(['0', '1']);

    // Cards outside the article do not count
    load({ count: 1, containerId: 'main-content' }, `<aside><div class="amw" id="B084DN3XVN"></div></aside>${article.replace('<div class="amw"></div>', '')}`);
    expect(cardsOf()).toHaveLength(1);

    load({ count: 1, containerId: 'main-content' }, article);
    expect(cardsOf()).toEqual([]);
  });

  it('takes the number of the site when the portal set one', () => {
    load({ count: 1, containerId: 'main-content', sites: { [window.location.host]: 3 } });
    expect(cardsOf()).toHaveLength(3);

    load({ count: 2, containerId: 'main-content', sites: { [window.location.host]: 0 } });
    expect(cardsOf()).toEqual([]);

    load({ count: 2, containerId: 'main-content', sites: { 'other.example': 5 } });
    expect(cardsOf()).toHaveLength(2);
  });

  it('shows the affiliate disclosure under the first card displayed only', async () => {
    const disclosures = () => [...document.querySelectorAll('.amw-widget-disclosure')].map(element => element.textContent);
    load({ count: 3, containerId: 'main-content' });
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(document.querySelectorAll('.amw-widget-content')).toHaveLength(3);
    expect(disclosures()).toHaveLength(1);
    expect(disclosures()[0]).not.toBe('');

    // A card of the author keeps its disclosure, as without Stuffing; the stuffed ones share one at most
    load({ count: 3, containerId: 'main-content' }, '<div id="main-content"><div class="amw" id="B084DN3XVN"></div><p>a</p><h2>A</h2><p>b</p><h2>B</h2><p>c</p><h2>C</h2></div>');
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(document.querySelectorAll('.amw-widget-content')).toHaveLength(3);
    expect(document.getElementById('B084DN3XVN')?.querySelector('.amw-widget-disclosure')).not.toBeNull();
    expect(cardsOf().filter(card => card.querySelector('.amw-widget-disclosure')).length).toBeLessThanOrEqual(1);
  });

  it('gives a short article fewer cards with a ratio of words', () => {
    const words = (count: number) => Array.from({ length: count }, (_, i) => `w${i}`).join(' ');
    const article = (count: number) => `<div id="main-content"><p>${words(count)}</p><h2>A</h2><p>x</p><h2>B</h2><p>y</p><h2>C</h2></div>`;
    // The headings and paragraphs add 5 words
    load({ count: 3, containerId: 'main-content', wordsPerCard: 300 }, article(595));
    expect(cardsOf()).toHaveLength(2);
    load({ count: 3, containerId: 'main-content', wordsPerCard: 300 }, article(200));
    expect(cardsOf()).toEqual([]);
    load({ count: 3, containerId: 'main-content', wordsPerCard: 300 }, article(5000));
    expect(cardsOf()).toHaveLength(3);
  });
});
