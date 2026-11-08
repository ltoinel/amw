import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import LoginView from '../src/components/LoginView.vue';
import DashboardView from '../src/components/DashboardView.vue';
import TopProducts from '../src/components/TopProducts.vue';
import NotFoundTable from '../src/components/NotFoundTable.vue';
import TopPages from '../src/components/TopPages.vue';
import SitesTrend from '../src/components/SitesTrend.vue';
import InsightsView from '../src/components/InsightsView.vue';
import KeywordsView from '../src/components/KeywordsView.vue';
import LlmCosts from '../src/components/LlmCosts.vue';
import SettingsView from '../src/components/SettingsView.vue';
import StuffingForm from '../src/components/StuffingForm.vue';
import EffectForm from '../src/components/EffectForm.vue';
import EffectComparison from '../src/components/EffectComparison.vue';
import { compareEffects } from '../src/effects';
import ActivityBar from '../src/components/ActivityBar.vue';
import AmazonQuota from '../src/components/AmazonQuota.vue';
import { amazonUsage, estimateQuota } from '../src/quota';
import DailyChart from '../src/components/DailyChart.vue';
import { Bar, Line } from 'vue-chartjs';
import { getToken, safeUrl } from '../src/api';
import { initTheme, theme, toggleTheme } from '../src/theme';
import { toCsv } from '../src/tables';

// jsdom has no canvas: the chart is replaced by a component exposing its props
vi.mock('vue-chartjs', async () => {
  const { defineComponent, h } = await import('vue');
  const chart = (name: string) => defineComponent({ name, props: ['data', 'options'], setup: () => () => h('canvas') });
  return { Bar: chart('Bar'), Line: chart('Line') };
});

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

// Mounted dashboards listen to hashchange: leftovers would react to later tests
enableAutoUnmount(afterEach);

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState(null, '', window.location.pathname);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LoginView', () => {
  test('stores the token in sessionStorage after a successful login', async () => {
    const fetchMock = vi.fn(() => jsonResponse(200, { token: '123.abc', expiresAt: '' }));
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mount(LoginView);

    await wrapper.find('input[type=password]').setValue('correct horse battery');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/login$/);
    expect(JSON.parse(init.body as string)).toEqual({ password: 'correct horse battery' });
    expect(getToken()).toBe('123.abc');
    expect(wrapper.emitted('logged-in')).toHaveLength(1);
  });

  test('shows an error on a wrong password', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(401, { message: 'Invalid password' })));
    const wrapper = mount(LoginView);

    await wrapper.find('input[type=password]').setValue('wrong');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[role=alert]').text()).toBe('Invalid password');
    expect(getToken()).toBeNull();
    expect(wrapper.emitted('logged-in')).toBeUndefined();
  });
});

describe('DashboardView', () => {
  test('says that statistics require Redis', async () => {
    sessionStorage.setItem('amw-admin-token', 'token');
    const fetchMock = vi.fn(() => jsonResponse(200, { stats: false, message: 'Statistics require Redis', retentionDays: 90 }));
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mount(DashboardView);
    await flushPromises();

    expect(wrapper.text()).toContain('Statistics require Redis');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toEqual({ Authorization: 'Bearer token' });
  });

  test('loads the best performing pages for the selected period', async () => {
    sessionStorage.setItem('amw-admin-token', 'token');
    const fetchMock = vi.fn((url: string) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/status')) return jsonResponse(200, { stats: true, retentionDays: 90 });
      if (path.endsWith('/stats/pages')) {
        return jsonResponse(200, [{ url: 'https://blog.example/post', impressions: 40, clicks: 2, ctr: 0.05 }]);
      }
      return jsonResponse(200, []);
    });
    vi.stubGlobal('fetch', fetchMock);

    window.location.hash = '#/pages';
    const wrapper = mount(DashboardView, { global: { stubs: { DailyChart: true } } });
    await flushPromises();

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.some(url => url.includes('/api/stats/pages?days=30&sort=clicks&limit=500'))).toBe(true);
    expect(wrapper.text()).toContain('Best performing pages');
    expect(wrapper.find('td.page a').attributes('href')).toBe('https://blog.example/post');

    await wrapper.findAll('.periods button')[0].trigger('click');
    await flushPromises();
    expect(fetchMock.mock.calls.map(([url]) => String(url)).some(url => url.includes('/api/stats/pages?days=7'))).toBe(true);
  });

  test('shows the number of distinct products shown over the period', async () => {
    sessionStorage.setItem('amw-admin-token', 'token');
    const fetchMock = statsFetch(path => (path.endsWith('/stats/products/count') ? jsonResponse(200, { count: 1234 }) : undefined));
    vi.stubGlobal('fetch', fetchMock);

    window.location.hash = '#/overview';
    const wrapper = mount(DashboardView, { global: { stubs: { DailyChart: true } } });
    await flushPromises();

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/stats/products/count?days=30'))).toBe(true);
    const tile = wrapper.findAll('.kpi').find(kpi => kpi.text().startsWith('Products shown'));
    expect(tile?.find('.kpi-value').text()).toBe('1,234');
  });

  test('shows the copyright and the build version in the footer', async () => {
    sessionStorage.setItem('amw-admin-token', 'token');
    const version = { release: '5.1.0', revision: 'd3d5300a1b2c3d4e', buildDate: '2026-10-31T09:00:00Z' };
    vi.stubGlobal('fetch', vi.fn((url: string) => (new URL(url).pathname.endsWith('/status')
      ? jsonResponse(200, { stats: false, retentionDays: 90, version })
      : jsonResponse(200, []))));
    const wrapper = mount(DashboardView, { global: { stubs: { DailyChart: true } } });
    await flushPromises();

    const footer = wrapper.find('footer');
    expect(footer.text()).toContain(`© 2024–${new Date().getFullYear()} Ludovic Toinel`);
    expect(footer.text()).toContain('AMW 5.1.0');
    expect(footer.text()).toContain('build d3d5300');
    expect(footer.find('a').attributes('href')).toBe('https://github.com/ltoinel/amw/releases/tag/v5.1.0');
  });

  test('sorts and filters the pages on the server', async () => {
    sessionStorage.setItem('amw-admin-token', 'token');
    const fetchMock = vi.fn((url: string) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/status')) return jsonResponse(200, { stats: true, retentionDays: 90 });
      if (path.endsWith('/stats/domains')) {
        return jsonResponse(200, [{ domain: 'blog.example', impressions: 40, clicks: 2, ctr: 0.05 }]);
      }
      if (path.endsWith('/stats/pages')) {
        return jsonResponse(200, [{ url: 'https://blog.example/post', impressions: 40, clicks: 2, ctr: 0.05 }]);
      }
      return jsonResponse(200, []);
    });
    vi.stubGlobal('fetch', fetchMock);

    window.location.hash = '#/pages';
    const wrapper = mount(DashboardView, { global: { stubs: { DailyChart: true } } });
    await flushPromises();
    const urls = () => fetchMock.mock.calls.map(([url]) => String(url));

    await wrapper.find('.filter select').setValue('blog.example');
    await flushPromises();
    expect(urls().some(url => url.includes('/api/stats/pages?days=30&sort=clicks&domain=blog.example&limit=500'))).toBe(true);

    await wrapper.findAll('th button.sort')[2].trigger('click');
    await flushPromises();
    expect(urls().some(url => url.includes('/api/stats/pages?days=30&sort=ctr&domain=blog.example&limit=500'))).toBe(true);
  });

  test('goes back to the login screen when the token expired', async () => {
    sessionStorage.setItem('amw-admin-token', 'expired');
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(401, {})));

    const wrapper = mount(DashboardView);
    await flushPromises();

    expect(wrapper.emitted('logout')).toHaveLength(1);
    expect(getToken()).toBeNull();
  });
});

function statsFetch(extra: (path: string) => Promise<Response> | undefined = () => undefined) {
  return vi.fn((url: string) => {
    const path = new URL(url).pathname;
    const answer = extra(path);
    if (answer) return answer;
    if (path.endsWith('/status')) return jsonResponse(200, { stats: true, retentionDays: 90 });
    return jsonResponse(200, []);
  });
}

describe('Navigation', () => {
  test('opens the overview by default and keeps the view in the URL hash', async () => {
    sessionStorage.setItem('amw-admin-token', 'token');
    const fetchMock = statsFetch();
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mount(DashboardView, { global: { stubs: { DailyChart: true } } });
    await flushPromises();

    expect(window.location.hash).toBe('#/overview');
    expect(wrapper.find('h1').text()).toBe('Overview');
    expect(wrapper.text()).toContain('Product requests');
    expect(wrapper.find('#tab-overview').attributes('aria-selected')).toBe('true');
    // The slow AI request is never made on dashboard load
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/insights'))).toBe(false);

    await wrapper.find('#tab-notfound').trigger('click');
    expect(window.location.hash).toBe('#/notfound');
    expect(wrapper.find('h1').text()).toBe('Products to replace');
    expect(wrapper.find('#tab-notfound').attributes('aria-selected')).toBe('true');
    expect(wrapper.find('#tab-overview').attributes('aria-selected')).toBe('false');
    expect(wrapper.text()).toContain('Nothing to replace');
    expect(wrapper.text()).not.toContain('Product requests');
  });

  test('follows the hash on back and forward', async () => {
    sessionStorage.setItem('amw-admin-token', 'token');
    vi.stubGlobal('fetch', statsFetch());
    window.location.hash = '#/products';

    const wrapper = mount(DashboardView, { global: { stubs: { DailyChart: true } } });
    await flushPromises();
    expect(wrapper.find('h1').text()).toBe('Most displayed products');

    window.location.hash = '#/pages';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flushPromises();
    expect(wrapper.find('h1').text()).toBe('Best performing pages');
  });

  test('falls back to the overview on an unknown hash', async () => {
    sessionStorage.setItem('amw-admin-token', 'token');
    vi.stubGlobal('fetch', statsFetch());
    window.location.hash = '#/unknown';

    const wrapper = mount(DashboardView, { global: { stubs: { DailyChart: true } } });
    await flushPromises();
    expect(wrapper.find('h1').text()).toBe('Overview');
    expect(window.location.hash).toBe('#/overview');
  });

  test('arrow keys move the focus between views without opening them', async () => {
    const wrapper = mount(ActivityBar, { props: { active: 'overview' }, attachTo: document.body });
    const tabs = wrapper.findAll('[role=tab]');
    expect(tabs.map(tab => tab.attributes('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1', '-1', '-1']);
    expect(tabs.map(tab => tab.attributes('aria-label'))).toEqual(['Overview', 'Products', 'Pages', 'To replace', 'Keywords', 'Insights', 'Settings']);

    (tabs[0].element as HTMLElement).focus();
    await tabs[0].trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();
    expect(document.activeElement).toBe(tabs[1].element);
    expect(tabs[1].attributes('tabindex')).toBe('0');

    await tabs[1].trigger('keydown', { key: 'ArrowUp' });
    await flushPromises();
    await tabs[0].trigger('keydown', { key: 'ArrowUp' });
    await flushPromises();
    expect(document.activeElement).toBe(tabs[6].element);
    expect(wrapper.emitted('select')).toBeUndefined();

    await tabs[6].trigger('click');
    expect(wrapper.emitted('select')).toEqual([['settings']]);
  });

  test('the sign out button of the activity bar logs out', async () => {
    const wrapper = mount(ActivityBar, { props: { active: 'overview' } });
    await wrapper.find('button[aria-label="Sign out"]').trigger('click');
    expect(wrapper.emitted('logout')).toHaveLength(1);
  });
});

describe('Theme', () => {
  test('applies the stored theme and persists the manual choice', async () => {
    localStorage.setItem('amw-admin-theme', 'light');
    initTheme();
    expect(theme.value).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');

    const wrapper = mount(ActivityBar, { props: { active: 'overview' } });
    const toggle = wrapper.find('.theme-toggle');
    expect(toggle.attributes('aria-label')).toBe('Switch to dark theme');
    await toggle.trigger('click');

    expect(theme.value).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('amw-admin-theme')).toBe('dark');
    expect(toggle.attributes('aria-label')).toBe('Switch to light theme');
  });

  test('charts read the theme colors and re-render when the theme changes', async () => {
    const root = document.documentElement.style;
    root.setProperty('--chart-grid', '#111111');
    const wrapper = mount(DailyChart, {
      props: { daily: [{ date: '2026-10-01', cache: 1, amazon: 2, notfound: 0, views: 3, clicks: 1 }], kind: 'hits' }
    });
    const gridColor = () => (wrapper.findComponent(Bar).props('options') as { scales: { y: { grid: { color: string } } } })
      .scales.y.grid.color;
    expect(gridColor()).toBe('#111111');

    root.setProperty('--chart-grid', '#eeeeee');
    toggleTheme();
    await flushPromises();
    expect(gridColor()).toBe('#eeeeee');
    root.removeProperty('--chart-grid');
  });

  test('still toggles when localStorage is unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    try {
      expect(() => initTheme()).not.toThrow();
      const before = theme.value;
      expect(() => toggleTheme()).not.toThrow();
      expect(theme.value).not.toBe(before);
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});

describe('InsightsView', () => {
  const SUCCESS = {
    available: true, days: 30, generatedAt: '2026-10-20T10:00:00.000Z', model: 'claude-opus-5-5', cached: true,
    summary: 'Clicks are up.\n<b>Not bold</b>',
    recommendations: [{ title: 'Replace <i>gone</i> products', detail: 'Three pages\nembed them.' }]
  };

  beforeEach(() => {
    sessionStorage.setItem('amw-admin-token', 'token');
  });

  test('explains how to enable the feature when it is disabled', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(200, { available: false, reason: 'Insights are disabled' })));
    const wrapper = mount(InsightsView, { props: { days: 30 } });
    await flushPromises();

    expect(wrapper.text()).toContain('Insights are disabled');
    expect(wrapper.text()).toContain('Admin.insights');
    expect(wrapper.text()).toContain('ANTHROPIC_API_KEY');
    const link = wrapper.find('a');
    expect(link.attributes('href')).toContain('#insights');
    expect(link.attributes('rel')).toBe('noopener noreferrer');
  });

  test('shows the last analysis without asking the model, and regenerates on demand', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-23T10:00:00Z'), toFake: ['Date'] });
    const fetchMock = vi.fn(() => jsonResponse(200, SUCCESS));
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mount(InsightsView, { props: { days: 30 } });
    await flushPromises();
    vi.useRealTimers();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/insights\?days=30$/);
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ Authorization: 'Bearer token' });

    expect(wrapper.text()).toContain('AI-generated');
    expect(wrapper.text()).toContain('claude-opus-5-5');
    expect(wrapper.find('.insights-meta time').text()).toBe('3 days ago');
    expect(wrapper.find('.model-text').element.textContent).toBe('Clicks are up.\n<b>Not bold</b>');
    expect(wrapper.find('b').exists()).toBe(false);
    expect(wrapper.find('i').exists()).toBe(false);
    expect(wrapper.find('.recommendations strong').text()).toBe('Replace <i>gone</i> products');

    await wrapper.find('.insights-meta button').trigger('click');
    await flushPromises();
    const [regenerateUrl, regenerate] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(regenerateUrl).toMatch(/\/api\/insights\?days=30$/);
    expect(regenerate.method).toBe('POST');
  });

  test('offers to generate the first analysis of a period, with a progress state', async () => {
    let resolve: (response: Response) => void = () => {};
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => jsonResponse(200, { available: true, days: 7, missing: true }))
      .mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mount(InsightsView, { props: { days: 7 } });
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('No analysis of the last 7 days yet.');
    await wrapper.find('button').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role=status]').text()).toContain('Analysing the last 7 days');
    expect((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].method).toBe('POST');

    resolve(new Response(JSON.stringify(SUCCESS), { status: 200 }));
    await flushPromises();
    expect(wrapper.find('[role=status]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Clicks are up.');
  });

  test('shows the last analysis of the new period when it changes', async () => {
    const fetchMock = vi.fn(() => jsonResponse(200, SUCCESS));
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mount(InsightsView, { props: { days: 30 } });
    await flushPromises();
    await wrapper.setProps({ days: 90 });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toMatch(/days=90$/);
    expect(init.method).toBe('GET');
  });

  test('shows the server error and lets the admin retry', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => jsonResponse(503, { error: 'Unavailable', message: 'Statistics require Redis' }))
      .mockImplementationOnce(() => jsonResponse(200, SUCCESS));
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mount(InsightsView, { props: { days: 30 } });
    await flushPromises();

    expect(wrapper.find('[role=alert]').text()).toContain('Statistics require Redis');
    await wrapper.find('[role=alert] button').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role=alert]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Clicks are up.');
    expect((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].method).toBe('GET');
  });

  test('goes back to the login screen when the token expired', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(401, {})));
    const wrapper = mount(InsightsView, { props: { days: 30 } });
    await flushPromises();
    expect(wrapper.emitted('logout')).toHaveLength(1);
  });

  test('is only requested when the Insights view is opened, once per period', async () => {
    const fetchMock = statsFetch(path => (path.endsWith('/insights') ? jsonResponse(200, SUCCESS) : undefined));
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mount(DashboardView, { global: { stubs: { DailyChart: true } } });
    await flushPromises();
    const insightCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/insights')).length;
    expect(insightCalls()).toBe(0);

    await wrapper.find('#tab-insights').trigger('click');
    await flushPromises();
    expect(insightCalls()).toBe(1);
    expect(wrapper.text()).toContain('Clicks are up.');

    // Going away and back reuses the result instead of reading it again
    await wrapper.find('#tab-overview').trigger('click');
    await flushPromises();
    await wrapper.find('#tab-insights').trigger('click');
    await flushPromises();
    expect(insightCalls()).toBe(1);
  });
});

describe('Tables', () => {
  test('TopProducts shows impressions, clicks and CTR', () => {
    const wrapper = mount(TopProducts, {
      props: {
        products: [{
          product: 'id:B084DN3XVN', type: 'id', value: 'B084DN3XVN', title: 'Arduino Uno',
          image: 'https://m.media-amazon.com/a.jpg', url: 'https://www.amazon.fr/dp/B084DN3XVN',
          impressions: 1200, clicks: 30, ctr: 0.025
        }]
      }
    });
    const cells = wrapper.findAll('td').map(cell => cell.text());
    expect(cells).toEqual(['Arduino Uno', 'B084DN3XVN', '1,200', '30', '2.5 %', '—']);
    expect(wrapper.find('a').attributes('href')).toBe('https://www.amazon.fr/dp/B084DN3XVN');
  });

  test('TopProducts tells how long each product has been cached', () => {
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000 - 1000).toISOString();
    const product = (value: string, fetchedAt?: string) =>
      ({ product: `id:${value}`, type: 'id' as const, value, title: value, impressions: 1, clicks: 0, ctr: 0, fetchedAt });
    const wrapper = mount(TopProducts, {
      props: { products: [product('B000000001', ago(0)), product('B000000002', ago(42)), product('B000000003', ago(185)), product('B000000004')] }
    });

    const ages = wrapper.findAll('tbody tr').map(row => row.findAll('td').at(-1)?.text());
    expect(ages).toEqual(['< 1 min', '42 min', '3 h 05', '—']);
    expect(wrapper.findAll('tbody tr')[3].findAll('td').at(-1)?.attributes('title')).toBe('Not in cache');
  });

  test('untrusted URLs are never rendered as links or images', () => {
    const wrapper = mount(TopProducts, {
      props: {
        products: [{
          product: 'id:X', type: 'id', value: 'X', title: 'Evil',
          image: 'javascript:alert(1)', url: 'javascript:alert(1)', impressions: 1, clicks: 0, ctr: 0
        }]
      }
    });
    expect(wrapper.find('a').exists()).toBe(false);
    expect(wrapper.find('img').exists()).toBe(false);
  });

  test('NotFoundTable lists the referer pages', () => {
    const wrapper = mount(NotFoundTable, {
      props: {
        products: [{
          product: 'id:B00GONE001', type: 'id', value: 'B00GONE001', count: 4, firstSeen: null, lastSeen: null,
          referers: [{ url: 'https://blog.example/post', count: 3 }]
        }]
      }
    });
    expect(wrapper.text()).toContain('B00GONE001');
    expect(wrapper.find('a').attributes('href')).toBe('https://blog.example/post');
    expect(wrapper.find('a').attributes('rel')).toBe('noopener noreferrer');
  });

  test('NotFoundTable shows how long products are missing and links them to Amazon', () => {
    vi.useFakeTimers({ now: new Date('2026-10-20T12:00:00Z') });
    const missing = (value: string, firstSeen: string | null, url?: string) => ({
      product: `id:${value}`, type: 'id' as const, value, count: 1, firstSeen, lastSeen: firstSeen, referers: [], url
    });
    const wrapper = mount(NotFoundTable, {
      props: {
        products: [
          missing('B00GONE001', '2026-10-20T11:30:00Z', 'https://www.amazon.fr/dp/B00GONE001'),
          missing('B00GONE002', '2026-10-19T07:00:00Z', 'javascript:alert(1)'),
          missing('B00GONE003', '2026-10-15T12:00:00Z'),
          missing('B00GONE004', null)
        ]
      }
    });
    vi.useRealTimers();

    const rows = wrapper.findAll('tbody tr');
    expect(rows.map(row => row.findAll('td')[3].text())).toEqual(['< 1 h', '29 h', '5 days', '—']);
    expect(rows[0].find('a').attributes('href')).toBe('https://www.amazon.fr/dp/B00GONE001');
    expect(rows[0].find('a').attributes('rel')).toBe('noopener noreferrer');
    expect(rows[1].find('a').exists()).toBe(false);
    expect(rows[2].find('a').exists()).toBe(false);
  });

  test('TopPages shows views, clicks and CTR with a safe link', () => {
    const wrapper = mount(TopPages, {
      props: { sort: 'clicks', pages: [{ url: 'https://blog.example/post', impressions: 1200, clicks: 30, ctr: 0.025 }] }
    });
    const cells = wrapper.findAll('td').map(cell => cell.text());
    expect(cells).toEqual(['https://blog.example/post', '1,200', '30', '2.5 %']);
    const link = wrapper.find('a');
    expect(link.attributes('href')).toBe('https://blog.example/post');
    expect(link.attributes('rel')).toBe('noopener noreferrer');
    expect(link.attributes('target')).toBe('_blank');
  });

  test('TopPages renders untrusted page URLs as text only', () => {
    const wrapper = mount(TopPages, {
      props: { sort: 'clicks', pages: [{ url: 'javascript:alert(1)', impressions: 1, clicks: 1, ctr: 1 }] }
    });
    expect(wrapper.find('a').exists()).toBe(false);
    expect(wrapper.find('td.page').text()).toBe('javascript:alert(1)');
  });

  test('TopPages marks the sorted column and emits the requested sort', async () => {
    const wrapper = mount(TopPages, {
      props: { sort: 'ctr', pages: [{ url: 'https://blog.example/post', impressions: 10, clicks: 1, ctr: 0.1 }] }
    });
    const headers = wrapper.findAll('th[aria-sort]');
    expect(headers.map(header => header.attributes('aria-sort'))).toEqual(['none', 'none', 'descending']);
    await headers[0].find('button').trigger('click');
    expect(wrapper.emitted('sort')).toEqual([['impressions']]);
  });

  test('SitesTrend draws the daily CTR of the top sites, with gaps on days without views', async () => {
    const site = (domain: string, ctrs: (number | null)[]) => ({
      domain, impressions: 100, clicks: 5, ctr: 0.05,
      daily: ctrs.map((ctr, i) => ({ date: `2026-10-1${i}`, impressions: ctr === null ? 0 : 100, clicks: 0, ctr }))
    });
    const trends = ['a', 'b', 'c', 'd', 'e', 'f'].map(name => site(`${name}.example`, [0.05, null]));
    const wrapper = mount(SitesTrend, { props: { trends } });

    const data = wrapper.findComponent(Line).props('data');
    expect(data.labels).toEqual(['10-10', '10-11']);
    expect(data.datasets.map(dataset => dataset.label)).toEqual(
      ['a.example', 'b.example', 'c.example', 'd.example', 'e.example']
    );
    expect(data.datasets[0].data).toEqual([5, null]);
    // The table lists every site, the chart only the top 5
    expect(wrapper.findAll('tbody tr')).toHaveLength(6);
    expect(wrapper.find('tbody td').text()).toBe('a.example');

    // A site keeps its colour when the ranking changes
    const colorOf = (label: string) => wrapper.findComponent(Line).props('data').datasets
      .find(dataset => dataset.label === label)?.borderColor;
    const before = colorOf('b.example');
    await wrapper.setProps({ trends: [trends[1], trends[5], trends[0]] });
    expect(colorOf('b.example')).toBe(before);
  });

  test('SitesTrend has an empty state', () => {
    const wrapper = mount(SitesTrend, { props: { trends: [] } });
    expect(wrapper.text()).toContain('No site reported over this period.');
  });

  test('TopPages has an empty state', () => {
    const wrapper = mount(TopPages, { props: { sort: 'clicks', pages: [] } });
    expect(wrapper.text()).toContain('No page reported over this period.');
  });

  test('safeUrl only accepts http(s)', () => {
    expect(safeUrl('https://a.example/x')).toBe('https://a.example/x');
    expect(safeUrl('data:image/png;base64,AAAA')).toBeUndefined();
    expect(safeUrl('not a url')).toBeUndefined();
  });
});

describe('KeywordsView', () => {
  const entry = {
    hash: 'a'.repeat(32),
    url: 'https://blog.example/van/',
    title: 'Un article sur le van',
    product: 'panneau solaire',
    createdAt: '2026-11-05T00:00:00.000Z',
    searchUrl: 'https://www.amazon.fr/s?k=panneau%20solaire'
  };
  const other = { hash: 'b'.repeat(32), url: 'https://blog.example/autre/', title: 'Autre chose', product: null, createdAt: '2026-11-04T00:00:00.000Z' };

  function serve(put: (init: RequestInit) => Promise<Response> = init => {
    const { product } = JSON.parse(String(init.body));
    return jsonResponse(200, { ...entry, product, editedAt: '2026-11-06T00:00:00.000Z', suggested: 'panneau solaire' });
  }) {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => (init.method === 'PUT'
      ? put(init)
      : jsonResponse(200, { available: true, total: 2, items: [entry, other] })));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  async function mounted() {
    const wrapper = mount(KeywordsView);
    await flushPromises();
    return wrapper;
  }

  test('lists the pages with their keywords and a link to Amazon', async () => {
    serve();
    const wrapper = await mounted();

    expect(wrapper.text()).toContain('Un article sur le van');
    const inputs = wrapper.findAll('.keywords-edit input');
    expect((inputs[0].element as HTMLInputElement).value).toBe('panneau solaire');
    expect((inputs[1].element as HTMLInputElement).value).toBe('');
    expect(wrapper.find('.keywords-meta a').attributes('href')).toBe(entry.searchUrl);
  });

  test('saves edited keywords, and tells that caches can delay them', async () => {
    const fetchMock = serve();
    const wrapper = await mounted();
    const save = () => wrapper.findAll('.keywords-edit button')[0];
    expect(save().attributes('disabled')).toBeDefined();

    await wrapper.findAll('.keywords-edit input')[0].setValue(' kit solaire ');
    expect(save().attributes('disabled')).toBeUndefined();
    await wrapper.findAll('.keywords-edit')[0].trigger('submit');
    await flushPromises();

    const [url, init] = fetchMock.mock.calls.find(([, options]) => options.method === 'PUT') as [string, RequestInit];
    expect(url).toContain(`/api/recommendations/${entry.hash}`);
    expect(JSON.parse(String(init.body))).toEqual({ product: 'kit solaire' });
    expect(wrapper.text()).toContain('AI suggested: panneau solaire');
    expect(wrapper.find('.keywords-saved').text()).toContain('up to 24 h');
    expect(wrapper.find('.keywords-saved code').text()).toContain(`/product?page=${entry.hash}`);
    expect(save().attributes('disabled')).toBeDefined();
  });

  test('sends empty keywords as no product', async () => {
    const fetchMock = serve();
    const wrapper = await mounted();

    await wrapper.findAll('.keywords-edit input')[0].setValue('   ');
    await wrapper.findAll('.keywords-edit')[0].trigger('submit');
    await flushPromises();

    const [, init] = fetchMock.mock.calls.find(([, options]) => options.method === 'PUT') as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ product: null });
  });

  test('shows a refused edit on its row and keeps the text', async () => {
    serve(() => jsonResponse(400, { message: 'Keywords must be 2 to 100 characters long' }));
    const wrapper = await mounted();

    await wrapper.findAll('.keywords-edit input')[0].setValue('x');
    await wrapper.findAll('.keywords-edit')[0].trigger('submit');
    await flushPromises();

    expect(wrapper.find('.keywords .error').text()).toContain('2 to 100');
    expect((wrapper.findAll('.keywords-edit input')[0].element as HTMLInputElement).value).toBe('x');
    expect(wrapper.find('.keywords-saved').exists()).toBe(false);
  });

  test('filters on the page, the title and the keywords, without losing what is typed', async () => {
    serve();
    const wrapper = await mounted();
    await wrapper.findAll('.keywords-edit input')[1].setValue('en cours');

    await wrapper.find('input[type=search]').setValue('PANNEAU');
    expect(wrapper.findAll('.keywords tbody tr')).toHaveLength(1);
    await wrapper.find('input[type=search]').setValue('rien de tel');
    expect(wrapper.text()).toContain('No page matches');
    await wrapper.find('input[type=search]').setValue('');
    expect((wrapper.findAll('.keywords-edit input')[1].element as HTMLInputElement).value).toBe('en cours');
  });

  test('renders a page title as text, and no link for an unsafe URL', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(200, {
      available: true, total: 1, items: [{ ...entry, title: '<img src=x onerror=alert(1)>', url: 'javascript:alert(1)' }]
    })));
    const wrapper = await mounted();

    expect(wrapper.find('td.page img').exists()).toBe(false);
    expect(wrapper.find('td.page a').exists()).toBe(false);
    expect(wrapper.find('td.page').text()).toContain('<img src=x');
  });

  test('says when the feature is disabled or nothing was requested', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(200, { available: false, reason: 'Automatic products are disabled' })));
    expect((await mounted()).text()).toContain('Automatic products are disabled');

    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(200, { available: true, total: 0, items: [] })));
    expect((await mounted()).text()).toContain('No page has requested');
  });

  test('asks to log in again when the session expired', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(401, {})));
    const wrapper = await mounted();
  });
});

describe('Amazon quota estimate', () => {
  const day = (amazon: number, notfound = 0) => ({ date: '2026-11-01', cache: 500, amazon, notfound, views: 0, clicks: 0 });

  test.each([
    [0, 1, 0],
    [0.15, 1, 3],
    [100, 1, 2000],
    [2000, 1, 40000],
    [4320, 1, 86400],
    // The per-second limit caps what the daily rule grants
    [5000, 1, 86400],
    [8640, 2, 172800],
    [1_000_000, 10, 864000],
  ])('estimates the quota for a revenue of %d', (revenue, perSecond, perDay) => {
    expect(estimateQuota(revenue)).toEqual({ perSecond, perDay });
  });

  test('sums the lookups that reach Amazon, and ignores the cache', () => {
    expect(amazonUsage([day(10), day(20, 10), day(0)])).toEqual({ average: 13, peak: 30 });
    expect(amazonUsage([])).toEqual({ average: 0, peak: 0 });
  });

  test('computes from the typed revenue, keeps it in this browser and sends nothing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mount(AmazonQuota, { props: { daily: [day(100)] } });
    expect(wrapper.findAll('.kpi-value')[0].text()).toBe('—');

    await wrapper.find('input').setValue('2000');

    expect(wrapper.findAll('.kpi-value').map(value => value.text())).toEqual(['40,000', '1', '100', '100']);
    expect(wrapper.find('[role=status]').text()).toContain('less than 1 %');
    expect(localStorage.getItem('amw-admin-shipped-revenue')).toBe('2000');
    expect(fetchMock).not.toHaveBeenCalled();

    expect(mount(AmazonQuota, { props: { daily: [] } }).findAll('.kpi-value')[0].text()).toBe('40,000');
  });

  test('warns when the busiest day is above the estimate, and when there is no revenue', async () => {
    const wrapper = mount(AmazonQuota, { props: { daily: [day(5000)] } });

    await wrapper.find('input').setValue('100');
    expect(wrapper.find('[role=status]').text()).toContain('above this estimate');

    await wrapper.find('input').setValue('0');
    expect(wrapper.find('[role=status]').text()).toContain('removes access');
  });

  test('forgets a stored amount that makes no sense', () => {
    localStorage.setItem('amw-admin-shipped-revenue', '-5');
    expect(mount(AmazonQuota, { props: { daily: [] } }).findAll('.kpi-value')[0].text()).toBe('—');
  });
});

describe('Pagination', () => {
  const pages = (count: number, prefix = 'page') => Array.from({ length: count }, (_, i) =>
    ({ url: `https://blog.example/${prefix}-${i + 1}`, impressions: 100 - i, clicks: 1, ctr: 0.01 }));
  const urls = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('td.page a').map(link => link.text());

  test('shows 25 rows per page and moves between the pages', async () => {
    const wrapper = mount(TopPages, { props: { pages: pages(30), sort: 'clicks' } });

    expect(urls(wrapper)).toHaveLength(25);
    expect(wrapper.find('.pager').text()).toContain('1–25 of 30');
    expect(wrapper.find('button[aria-label="Previous page"]').attributes('disabled')).toBeDefined();

    await wrapper.find('button[aria-label="Next page"]').trigger('click');

    expect(urls(wrapper)).toHaveLength(5);
    expect(urls(wrapper)[0]).toBe('https://blog.example/page-26');
    expect(wrapper.find('.pager').text()).toContain('26–30 of 30');
    expect(wrapper.find('button[aria-label="Next page"]').attributes('disabled')).toBeDefined();
  });

  test('goes back to the first page when the rows change', async () => {
    const wrapper = mount(TopPages, { props: { pages: pages(30), sort: 'clicks' } });
    await wrapper.find('button[aria-label="Next page"]').trigger('click');

    await wrapper.setProps({ pages: pages(30, 'other') });

    expect(urls(wrapper)[0]).toBe('https://blog.example/other-1');
  });

  test('hides the pager for one page but keeps the export, and says when rows are cut off', () => {
    const short = mount(TopPages, { props: { pages: pages(3), sort: 'clicks' } });
    expect(short.find('.pager').exists()).toBe(false);
    expect(short.find('.table-tools').text()).toContain('Export CSV');
    expect(short.find('.table-tools').text()).not.toContain('Limited');

    const full = mount(TopPages, { props: { pages: pages(500), sort: 'clicks' } });
    expect(full.find('.table-tools').text()).toContain('Limited to the first 500 rows');
  });

  test('filters the rows with the search, from the first page', async () => {
    const wrapper = mount(TopPages, { props: { pages: [...pages(30), ...pages(3, 'van')], sort: 'clicks' } });
    await wrapper.find('button[aria-label="Next page"]').trigger('click');

    await wrapper.find('input[type=search]').setValue('  VAN- ');

    expect(urls(wrapper)).toEqual(['https://blog.example/van-1', 'https://blog.example/van-2', 'https://blog.example/van-3']);
    expect(wrapper.find('.table-search').text()).toContain('3 of 33 rows');
    expect(wrapper.find('.pager').exists()).toBe(false);

    await wrapper.find('input[type=search]').setValue('nothing');
    expect(wrapper.text()).toContain('No row matches this search.');
  });

  test('searches the products by title or ASIN, and the products to replace by page', async () => {
    const product = (value: string, title: string) =>
      ({ product: `id:${value}`, type: 'id' as const, value, title, impressions: 1, clicks: 0, ctr: 0 });
    const top = mount(TopProducts, { props: { products: [product('B000000001', 'Solar panel'), product('B000000002', 'Battery')] } });
    await top.find('input[type=search]').setValue('solar');
    expect(top.findAll('tbody tr')).toHaveLength(1);
    await top.find('input[type=search]').setValue('b000000002');
    expect(top.find('tbody').text()).toContain('Battery');

    const missing = (value: string, page: string) => ({
      product: `id:${value}`, type: 'id' as const, value, count: 1, firstSeen: null, lastSeen: null,
      referers: [{ url: page, count: 1 }],
    });
    const table = mount(NotFoundTable, { props: { products: [missing('B000000001', 'https://van.example/a'), missing('B000000002', 'https://blog.example/b')] } });
    await table.find('input[type=search]').setValue('van.example');
    expect(table.findAll('tbody tr')).toHaveLength(1);
  });

  test('offers 25, 50, 100 or 200 rows per page, and remembers the choice', async () => {
    localStorage.removeItem('amw-admin-page-size');
    const wrapper = mount(TopPages, { props: { pages: pages(120), sort: 'clicks' } });
    const select = wrapper.find('.page-size select');
    expect(select.findAll('option').map(option => option.text())).toEqual(['25', '50', '100', '200']);
    await wrapper.find('button[aria-label="Next page"]').trigger('click');

    await select.setValue('100');

    expect(urls(wrapper)).toHaveLength(100);
    expect(urls(wrapper)[0]).toBe('https://blog.example/page-1');
    expect(localStorage.getItem('amw-admin-page-size')).toBe('100');
    expect(urls(mount(TopPages, { props: { pages: pages(120), sort: 'clicks' } }))).toHaveLength(100);
    localStorage.removeItem('amw-admin-page-size');
  });
});

describe('CSV export', () => {
  test('quotes what needs it, and leaves numbers and empty values alone', () => {
    expect(toCsv(['A', 'B'], [['x,y', 'say "hi"'], ['line\nbreak', 3], [null, undefined], [-1.5, 0]]))
      .toBe('A,B\r\n"x,y","say ""hi"""\r\n"line\nbreak",3\r\n,\r\n-1.5,0\r\n');
  });

  test.each(['=HYPERLINK("http://evil")', '+1+1', '-1+1', '@SUM(A1)', '  =1+1', '\t=1+1'])('neutralises the formula %j', formula => {
    const line = toCsv(['A'], [[formula]]).split('\r\n')[1];
    expect(line.replace(/^"/, '').startsWith("'")).toBe(true);
  });

  test('exports every row, not only the visible page', async () => {
    const created: Blob[] = [];
    URL.createObjectURL = (blob: Blob) => { created.push(blob); return 'blob:x'; };
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const rows = Array.from({ length: 30 }, (_, i) => ({ url: `https://blog.example/${i}`, impressions: 1, clicks: 0, ctr: 0 }));
    const wrapper = mount(TopPages, { props: { pages: rows, sort: 'clicks', days: 7 } });

    await wrapper.find('.table-tools button').trigger('click');

    expect(click).toHaveBeenCalledTimes(1);
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('amw-pages-7d.csv');
    const text = await new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(created[0]);
    });
    expect(text.trim().split('\r\n')).toHaveLength(31);
    click.mockRestore();
  });
});

describe('LlmCosts', () => {
  const OPUS = { feature: 'insights', model: 'claude-opus-5-5', calls: 2, inputTokens: 12000, outputTokens: 3000, estimatedCost: 0.108 };
  const HAIKU = { feature: 'recommendation', model: 'claude-haiku-5-5', calls: 40, inputTokens: 4000, outputTokens: 800, estimatedCost: 0.0008 };

  test('shows the usage and the total, presented as an estimate', () => {
    const wrapper = mount(LlmCosts, { props: { usage: [OPUS, HAIKU] } });

    expect(wrapper.text()).toContain('Anthropic invoice');
    const rows = wrapper.findAll('tbody tr').map(row => row.findAll('td').map(cell => cell.text()));
    expect(rows[0]).toEqual(['Insights', 'claude-opus-5-5', '2', '12,000', '3,000', '$0.11']);
    expect(rows[1]).toEqual(['Recommendations', 'claude-haiku-5-5', '40', '4,000', '800', '< $0.01']);
    expect(wrapper.find('tfoot').text()).toContain('$0.11');
  });

  test('says when a price is unknown, in the row and in the total', () => {
    const wrapper = mount(LlmCosts, { props: { usage: [OPUS, { ...HAIKU, estimatedCost: null }] } });

    expect(wrapper.findAll('tbody tr')[1].text()).toContain('unknown');
    expect(wrapper.find('tfoot').text()).toContain('at least $0.11');
  });
});

describe('SettingsView', () => {
  const SECTIONS = [
    {
      title: 'Server',
      entries: [
        { key: 'Server.port', env: 'SERVER_PORT', description: 'TCP port the server listens on.', value: 8080 },
        { key: 'Server.cors', env: 'SERVER_CORS', description: 'CORS headers.', value: false },
        { key: 'Admin.tokenTtl', env: 'AMW_ADMIN_TOKEN_TTL', description: 'Session lifetime.', value: null }
      ]
    },
    {
      title: 'Recommendation',
      entries: [
        { key: 'Server.allowedSites', env: 'SERVER_ALLOWED_SITES', description: 'Your sites.', value: ['a.example', 'b.example'] },
        { key: 'Amazon.credentialSecret', env: 'AMAZON_CREDENTIAL_SECRET', description: 'Secret.', secret: true, configured: true },
        { key: 'Anthropic.apiKey', env: 'ANTHROPIC_API_KEY', description: 'Claude API key.', secret: true, configured: false, envOnly: true },
        { key: 'Server.httpCache', env: null, description: 'Cache.', value: 300 }
      ]
    }
  ];

  const line = (wrapper: ReturnType<typeof mount>, key: string) =>
    wrapper.findAll('tbody tr').find(candidate => candidate.find('th code').text() === key)!;
  // The last cell: the first one is the description
  const row = (wrapper: ReturnType<typeof mount>, key: string) => line(wrapper, key).findAll('td').at(-1)!.text();

  test('shows each kind of value', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(200, SECTIONS)));
    const wrapper = mount(SettingsView, { global: { stubs: { StuffingForm: true, EffectForm: true } } });
    await flushPromises();

    expect(wrapper.findAll('h2').map(heading => heading.text())).toEqual(['Server', 'Recommendation']);
    expect(row(wrapper, 'Server.port')).toBe('8080');
    expect(row(wrapper, 'Server.cors')).toBe('false');
    expect(row(wrapper, 'Admin.tokenTtl')).toBe('default');
    expect(row(wrapper, 'Server.allowedSites')).toBe('a.example, b.example');
    expect(row(wrapper, 'Amazon.credentialSecret')).toBe('Configured');
    expect(row(wrapper, 'Anthropic.apiKey')).toBe('Not set');
  });

  test('shows the description and the environment variable of each setting', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(200, SECTIONS)));
    const wrapper = mount(SettingsView, { global: { stubs: { StuffingForm: true, EffectForm: true } } });
    await flushPromises();

    expect(line(wrapper, 'Server.port').find('td.description').text()).toBe('TCP port the server listens on.');
    expect(line(wrapper, 'Server.port').find('th .env').text()).toBe('SERVER_PORT');
    expect(line(wrapper, 'Anthropic.apiKey').find('th .env').text()).toBe('ANTHROPIC_API_KEY · environment only');
    expect(line(wrapper, 'Server.httpCache').find('th .env').exists()).toBe(false);
  });

  test('renders values as text', async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(200, [{ title: 'Amazon', entries: [{ key: 'Amazon.partnerTag', env: 'AMAZON_PARTNER_TAG', description: hostile, value: hostile }] }])));
    const wrapper = mount(SettingsView);
    await flushPromises();

    expect(wrapper.find('img').exists()).toBe(false);
    expect(row(wrapper, 'Amazon.partnerTag')).toBe(hostile);
  });

  test('signs out when the session expired', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(401, {})));
    const wrapper = mount(SettingsView);
    await flushPromises();

    expect(wrapper.emitted('logout')).toHaveLength(1);
  });

  test('shows the error of a failed request', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(500, { message: 'Boom' })));
    const wrapper = mount(SettingsView);
    await flushPromises();

    expect(wrapper.find('[role=alert]').text()).toBe('Boom');
  });

  test('stays available without Redis, without the period and refresh controls', async () => {
    sessionStorage.setItem('amw-admin-token', 'token');
    window.location.hash = '#/settings';
    vi.stubGlobal('fetch', vi.fn((url: string) => jsonResponse(200, new URL(url).pathname.endsWith('/api/settings')
      ? SECTIONS
      : { stats: false, message: 'Statistics require Redis', retentionDays: 90 })));

    const wrapper = mount(DashboardView);
    await flushPromises();

    expect(row(wrapper, 'Server.port')).toBe('8080');
    expect(wrapper.text()).not.toContain('Statistics require Redis');
    expect(wrapper.find('.periods').exists()).toBe(false);
    expect(wrapper.find('button[aria-label=Refresh]').exists()).toBe(false);
  });
});

describe('Amazon test button', () => {
  const SECTIONS = [{ title: 'Amazon', entries: [{ key: 'Amazon.marketplace', value: 'www.amazon.fr' }] }, { title: 'Redis', entries: [] }];
  const RESULT = { marketplace: 'www.amazon.fr', partnerTag: 'test-21', checkedAt: '', durationMs: 120, cached: false };

  function mountWith(answer: () => Promise<Response>) {
    const fetchMock = vi.fn((url: string) => (new URL(url).pathname.endsWith('/amazon/test') ? answer() : jsonResponse(200, SECTIONS)));
    vi.stubGlobal('fetch', fetchMock);
    return { wrapper: mount(SettingsView), fetchMock };
  }
  const testCalls = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/amazon/test'));

  test('only calls Amazon on demand, with a POST, and shows the success', async () => {
    const { wrapper, fetchMock } = mountWith(() => jsonResponse(200, {
      ...RESULT, ok: true, message: 'Amazon accepted the credentials', product: { title: 'A book', url: 'https://www.amazon.fr/dp/B000000001?tag=test-21' }
    }));
    await flushPromises();
    expect(wrapper.findAll('.amazon-test')).toHaveLength(1);
    expect(testCalls(fetchMock)).toHaveLength(0);

    await wrapper.find('.amazon-test button').trigger('click');
    await flushPromises();

    const [, init] = testCalls(fetchMock)[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(wrapper.find('.amazon-test-result.succeeded').text()).toContain('Amazon accepted the credentials');
    expect(wrapper.find('.amazon-test-result a').text()).toBe('A book');
  });

  test('shows why it failed, and renders no link for an unsafe URL', async () => {
    const { wrapper } = mountWith(() => jsonResponse(200, {
      ...RESULT, ok: false, failure: 'credentials', message: 'Amazon rejected the credentials', product: { title: 'x', url: 'javascript:alert(1)' }
    }));
    await flushPromises();
    await wrapper.find('.amazon-test button').trigger('click');
    await flushPromises();

    expect(wrapper.find('.amazon-test-result.failed').text()).toContain('Amazon rejected the credentials');
    expect(wrapper.find('.amazon-test-result a').exists()).toBe(false);
  });

  test('says when the test itself could not run, and signs out on an expired session', async () => {
    const failed = mountWith(() => jsonResponse(500, { message: 'Boom' }));
    await flushPromises();
    await failed.wrapper.find('.amazon-test button').trigger('click');
    await flushPromises();
    expect(failed.wrapper.find('.amazon-test [role=alert]').text()).toBe('Boom');

    const expired = mountWith(() => jsonResponse(401, {}));
    await flushPromises();
    await expired.wrapper.find('.amazon-test button').trigger('click');
    await flushPromises();
    expect(expired.wrapper.emitted('logout')).toHaveLength(1);
  });
});

describe('StuffingForm', () => {
  const VALUES = { count: 0, mode: 'recommendation', containerId: 'main-content', products: ['B000000001'], editable: true, recommendationEnabled: true };

  function mountForm(values: Record<string, unknown> = VALUES, answer?: () => Promise<Response>) {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => (init?.method === 'PUT' && answer ? answer() : jsonResponse(200, values)));
    vi.stubGlobal('fetch', fetchMock);
    return { wrapper: mount(StuffingForm), fetchMock };
  }

  test('shows the current values, and saves the new ones', async () => {
    const { wrapper, fetchMock } = mountForm(VALUES, () => jsonResponse(200, { ...VALUES, count: 2, containerId: 'article' }));
    await flushPromises();
    expect((wrapper.find('input[type=number]').element as HTMLInputElement).value).toBe('0');
    expect((wrapper.find('input[type=text]').element as HTMLInputElement).value).toBe('main-content');

    await wrapper.find('input[type=number]').setValue('2');
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('B000000001');
    await wrapper.find('input[type=text]').setValue('article');
    await wrapper.find('textarea').setValue('b084dn3xvn\nB000000002, B000000003 ');
    expect(wrapper.text()).toContain('then the most clicked products');
    await wrapper.find('input[value=manual]').setValue(true);
    expect(wrapper.text()).toContain('the second card the second one');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    const [, init] = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT') as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ count: 2, mode: 'manual', containerId: 'article', products: ['B084DN3XVN', 'B000000002', 'B000000003'] });
    expect(wrapper.find('[role=status]').text()).toContain('Saved');
  });

  test('shows the refusal of the server', async () => {
    const { wrapper } = mountForm(VALUES, () => jsonResponse(400, { message: 'Stuffed cards need Recommendation.enabled' }));
    await flushPromises();
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[role=alert]').text()).toContain('need Recommendation.enabled');
  });

  test('is read-only without Redis, and warns without recommendations', async () => {
    const readOnly = mountForm({ ...VALUES, editable: false });
    await flushPromises();
    expect(readOnly.wrapper.find('button').attributes('disabled')).toBeDefined();
    expect(readOnly.wrapper.text()).toContain('requires Redis');

    const noRecommendations = mountForm({ ...VALUES, recommendationEnabled: false });
    await flushPromises();
    expect(noRecommendations.wrapper.text()).toContain('Recommendation.enabled');

    // The manual list never calls the AI model
    const manual = mountForm({ ...VALUES, mode: 'manual', recommendationEnabled: false });
    await flushPromises();
    expect((manual.wrapper.find('input[value=manual]').element as HTMLInputElement).checked).toBe(true);
    expect(manual.wrapper.text()).not.toContain('Recommendation.enabled');
  });

  test('signs out when the session expired', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(401, {})));
    const wrapper = mount(StuffingForm);
    await flushPromises();
    expect(wrapper.emitted('logout')).toHaveLength(1);
  });
});

describe('Comparison of the effects', () => {
  const row = (effect: string, views: number, clicks: number) => ({ effect, views, clicks, ctr: views > 0 ? clicks / views : 0 });

  test('says when a difference is significant, in both directions', () => {
    const [control, better, worse] = compareEffects([row('none', 10000, 300), row('fade', 10000, 400), row('zoom', 10000, 200)]);

    expect(control.verdict).toBe('control');
    expect(better.verdict).toBe('better');
    expect(better.uplift).toBeCloseTo(1 / 3);
    expect(worse.verdict).toBe('worse');
  });

  test('does not call a small difference a winner', () => {
    expect(compareEffects([row('none', 10000, 300), row('fade', 10000, 320)])[1].verdict).toBe('no-difference');
  });

  test('needs enough data on both sides, however large the gap', () => {
    expect(compareEffects([row('none', 100, 1), row('fade', 100, 50)])[1].verdict).toBe('more-data');
    expect(compareEffects([row('none', 10000, 300), row('fade', 100, 50)])[1].verdict).toBe('more-data');
    expect(compareEffects([row('none', 10000, 5), row('fade', 10000, 400)])[1].verdict).toBe('more-data');
  });

  test('stays honest without a control group or without clicks', () => {
    expect(compareEffects([row('fade', 10000, 400)])[0]).toMatchObject({ uplift: null, verdict: 'more-data' });
    expect(compareEffects([row('none', 0, 0), row('fade', 0, 0)])[1]).toMatchObject({ uplift: null, verdict: 'more-data' });
  });

  test('shows the table', () => {
    const wrapper = mount(EffectComparison, { props: { rows: [row('none', 10000, 300), row('fade', 10000, 400)] } });
    const cells = wrapper.findAll('tbody tr').map(tr => tr.findAll('td').map(td => td.text()));

    expect(cells[0]).toEqual(['none', '10,000', '300', '3.0 %', '—', 'Control group']);
    expect(cells[1]).toEqual(['fade', '10,000', '400', '4.0 %', '+33.3 %', 'Better than the control']);
  });
});

describe('EffectForm', () => {
  const VALUES = { mode: 'none', editable: true };

  test('shows the mode, and saves the new one', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => jsonResponse(200, init?.method === 'PUT' ? { mode: 'compare', editable: true } : VALUES));
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mount(EffectForm);
    await flushPromises();

    await wrapper.find('select').setValue('compare');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    const [, init] = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT') as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ mode: 'compare' });
    expect(wrapper.find('[role=status]').text()).toContain('Saved');
  });

  test('is read-only without Redis', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(200, { mode: 'none', editable: false })));
    const wrapper = mount(EffectForm);
    await flushPromises();

    expect(wrapper.find('button').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('requires Redis');
  });
});

describe('NotFoundTable titles', () => {
  const entry = { product: 'id:B000000001', type: 'id' as const, value: 'B000000001', count: 1, firstSeen: null, lastSeen: null, referers: [] };

  test('shows the title as text, or says it is unknown', () => {
    const wrapper = mount(NotFoundTable, { props: { products: [
      { ...entry, title: '<b>Arduino</b>' },
      { ...entry, product: 'id:B000000002', value: 'B000000002' },
    ] } });

    const cells = wrapper.findAll('tbody tr').map(row => row.find('td').text());
    expect(cells).toEqual(['<b>Arduino</b>', 'Title unknown']);
    expect(wrapper.find('tbody b').exists()).toBe(false);
  });
});
