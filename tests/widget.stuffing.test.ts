/**
 * @jest-environment jsdom
 *
 * Stuffing: the cards widget.js adds to an article (src/widgets/widget.js).
 */

export {};

describe('stuffing', () => {
  const win = window as unknown as { AMW_STUFFING?: { count: number; containerId: string }; AmwWidget?: { destroy(): void } };
  const ARTICLE = `<main id="main-content">
    <p>Intro</p><h2>A</h2><p>Text</p><h3>B</h3><p>Text</p><h2>C</h2><ul><li>x</li></ul><h2>D</h2><p>Text</p><h2>E</h2><p>Text</p>
  </main>`;
  const cardsOf = () => [...document.querySelectorAll<HTMLElement>('[data-amw-slot]')];
  const nextHeadings = () => cardsOf().map(card => card.nextElementSibling?.textContent);

  function load(stuffing: { count: number; containerId: string } | undefined, html = ARTICLE): void {
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
});
