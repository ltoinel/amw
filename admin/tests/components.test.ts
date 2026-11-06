import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import LoginView from '../src/components/LoginView.vue';
import DashboardView from '../src/components/DashboardView.vue';
import TopProducts from '../src/components/TopProducts.vue';
import NotFoundTable from '../src/components/NotFoundTable.vue';
import TopPages from '../src/components/TopPages.vue';
import SitesTrend from '../src/components/SitesTrend.vue';
import InsightsView from '../src/components/InsightsView.vue';
import SettingsView from '../src/components/SettingsView.vue';
import ActivityBar from '../src/components/ActivityBar.vue';
import DailyChart from '../src/components/DailyChart.vue';
import { Bar, Line } from 'vue-chartjs';
import { getToken, safeUrl } from '../src/api';
import { initTheme, theme, toggleTheme } from '../src/theme';

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
    expect(urls.some(url => url.includes('/api/stats/pages?days=30&sort=clicks&limit=20'))).toBe(true);
    expect(wrapper.text()).toContain('Best performing pages');
    expect(wrapper.find('td.page a').attributes('href')).toBe('https://blog.example/post');

    await wrapper.findAll('.periods button')[0].trigger('click');
    await flushPromises();
    expect(fetchMock.mock.calls.map(([url]) => String(url)).some(url => url.includes('/api/stats/pages?days=7'))).toBe(true);
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
    expect(urls().some(url => url.includes('/api/stats/pages?days=30&sort=clicks&domain=blog.example&limit=20'))).toBe(true);

    await wrapper.findAll('th button.sort')[2].trigger('click');
    await flushPromises();
    expect(urls().some(url => url.includes('/api/stats/pages?days=30&sort=ctr&domain=blog.example&limit=20'))).toBe(true);
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
    expect(tabs.map(tab => tab.attributes('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1', '-1']);
    expect(tabs.map(tab => tab.attributes('aria-label'))).toEqual(['Overview', 'Products', 'Pages', 'To replace', 'Insights', 'Settings']);

    (tabs[0].element as HTMLElement).focus();
    await tabs[0].trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();
    expect(document.activeElement).toBe(tabs[1].element);
    expect(tabs[1].attributes('tabindex')).toBe('0');

    await tabs[1].trigger('keydown', { key: 'ArrowUp' });
    await flushPromises();
    await tabs[0].trigger('keydown', { key: 'ArrowUp' });
    await flushPromises();
    expect(document.activeElement).toBe(tabs[5].element);
    expect(wrapper.emitted('select')).toBeUndefined();

    await tabs[5].trigger('click');
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
    expect(cells).toEqual(['Arduino Uno', 'B084DN3XVN', '1,200', '30', '2.5 %']);
    expect(wrapper.find('a').attributes('href')).toBe('https://www.amazon.fr/dp/B084DN3XVN');
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
    expect(rows.map(row => row.findAll('td')[2].text())).toEqual(['< 1 h', '29 h', '5 days', '—']);
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

describe('SettingsView', () => {
  const SECTIONS = [
    {
      title: 'Server',
      entries: [
        { key: 'Server.port', value: 8080 },
        { key: 'Server.cors', value: false },
        { key: 'Admin.tokenTtl', value: null }
      ]
    },
    {
      title: 'Recommendation',
      entries: [
        { key: 'Recommendation.allowedHosts', value: ['a.example', 'b.example'] },
        { key: 'Amazon.credentialSecret', secret: true, configured: true },
        { key: 'ANTHROPIC_API_KEY', secret: true, configured: false }
      ]
    }
  ];

  const row = (wrapper: ReturnType<typeof mount>, key: string) =>
    wrapper.findAll('tbody tr').find(candidate => candidate.find('th').text() === key)!.find('td').text();

  test('shows each kind of value', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(200, SECTIONS)));
    const wrapper = mount(SettingsView);
    await flushPromises();

    expect(wrapper.findAll('h2').map(heading => heading.text())).toEqual(['Server', 'Recommendation']);
    expect(row(wrapper, 'Server.port')).toBe('8080');
    expect(row(wrapper, 'Server.cors')).toBe('false');
    expect(row(wrapper, 'Admin.tokenTtl')).toBe('default');
    expect(row(wrapper, 'Recommendation.allowedHosts')).toBe('a.example, b.example');
    expect(row(wrapper, 'Amazon.credentialSecret')).toBe('Configured');
    expect(row(wrapper, 'ANTHROPIC_API_KEY')).toBe('Not set');
  });

  test('renders values as text', async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(200, [{ title: 'Amazon', entries: [{ key: 'Amazon.partnerTag', value: hostile }] }])));
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
