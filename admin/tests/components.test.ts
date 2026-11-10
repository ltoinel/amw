import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import LoginView from '../src/components/LoginView.vue';
import DashboardView from '../src/components/DashboardView.vue';
import TopProducts from '../src/components/TopProducts.vue';
import NotFoundTable from '../src/components/NotFoundTable.vue';
import QuotaChart from '../src/components/QuotaChart.vue';
import TopPages from '../src/components/TopPages.vue';
import SitesTrend from '../src/components/SitesTrend.vue';
import InsightsView from '../src/components/InsightsView.vue';
import KeywordsView from '../src/components/KeywordsView.vue';
import LlmCosts from '../src/components/LlmCosts.vue';
import SettingsView from '../src/components/SettingsView.vue';
import StuffingForm from '../src/components/StuffingForm.vue';
import CustomProductsView from '../src/components/CustomProductsView.vue';
import DealsView from '../src/components/DealsView.vue';
import CtrBadge from '../src/components/CtrBadge.vue';
import { averageCtr, ctrLevel } from '../src/ctr';
import SitesView from '../src/components/SitesView.vue';
import KpiTile from '../src/components/KpiTile.vue';
import { compact, shortDate } from '../src/chartStyle';
import QuotaView from '../src/components/QuotaView.vue';
import { activeSite, setActiveSite } from '../src/site';
import SettingsBackup from '../src/components/SettingsBackup.vue';
import LiveSettingsForm from '../src/components/LiveSettingsForm.vue';
import VariantComparison from '../src/components/VariantComparison.vue';
import AbTestsView from '../src/components/AbTestsView.vue';
import { compareEffects, compareVariants } from '../src/effects';
import ActivityBar from '../src/components/ActivityBar.vue';
import AmwLogo from '../src/components/AmwLogo.vue';
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
  // The site the dashboard opens on: without one, its views only ask to add a site
  setActiveSite('blog.example');
  history.replaceState(null, '', window.location.pathname);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LoginView', () => {
  test('shows the AMW logo, inline so that the Content-Security-Policy allows it', () => {
    const wrapper = mount(LoginView);
    const logo = wrapper.find('svg.amw-logo');
    expect(logo.exists()).toBe(true);
    expect(logo.attributes('aria-hidden')).toBe('true');
    expect(logo.find('image').exists()).toBe(false);
  });

  test('stores the token in localStorage after a successful login', async () => {
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
    // Kept after the tab is closed, unlike sessionStorage
    expect(localStorage.getItem('amw-admin-token')).toBe('123.abc');
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
    localStorage.setItem('amw-admin-token', 'token');
    const fetchMock = vi.fn(() => jsonResponse(200, { stats: false, message: 'Statistics require Redis', retentionDays: 90 }));
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mount(DashboardView);
    await flushPromises();

    expect(wrapper.text()).toContain('Statistics require Redis');
    // The status, and the sites of the switcher, which need no statistics
    expect((fetchMock.mock.calls as unknown as [string][]).map(([url]) => new URL(String(url)).pathname.split('/').pop()).sort()).toEqual(['sites', 'status']);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toEqual({ Authorization: 'Bearer token' });
  });

  test('loads the best performing pages for the selected period', async () => {
    localStorage.setItem('amw-admin-token', 'token');
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
    expect(urls.some(url => url.includes('/api/stats/pages?days=30&sort=clicks') && url.includes('limit=500'))).toBe(true);
    expect(wrapper.text()).toContain('Best performing pages');
    expect(wrapper.find('td.page a').attributes('href')).toBe('https://blog.example/post');

    await wrapper.findAll('.periods button')[1].trigger('click');
    await flushPromises();
    expect(fetchMock.mock.calls.map(([url]) => String(url)).some(url => url.includes('/api/stats/pages?days=7'))).toBe(true);

    // 1 day, then a custom range, sent as two dates once both are valid
    expect(wrapper.findAll('.periods button').map(button => button.text())).toEqual(['1 day', '7 days', '30 days', '90 days', 'Custom']);
    await wrapper.findAll('.periods button')[4].trigger('click');
    await flushPromises();
    const inputs = wrapper.findAll('.period-range input');
    expect(inputs).toHaveLength(2);
    fetchMock.mockClear();
    const today = new Date().toISOString().slice(0, 10);
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    await inputs[0].setValue(twoDaysAgo);
    await inputs[0].trigger('change');
    await flushPromises();
    expect(fetchMock.mock.calls.map(([url]) => String(url)).some(url => url.includes(`/api/stats/pages?from=${twoDaysAgo}&to=${today}`))).toBe(true);
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
    localStorage.setItem('amw-admin-token', 'token');
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
    expect(footer.findAll('a').map(link => link.attributes('href')))
      .toEqual(['https://ludovic.toinel.com', 'https://github.com/ltoinel/amw/releases/tag/v5.1.0']);
  });

  test('sorts the products on the server', async () => {
    localStorage.setItem('amw-admin-token', 'token');
    const fetchMock = statsFetch();
    vi.stubGlobal('fetch', fetchMock);
    window.location.hash = '#/products';
    const wrapper = mount(DashboardView, {
      global: { stubs: { DailyChart: true, TopProducts: { props: ['sort'], emits: ['sort'], template: '<button class="stub-sort" @click="$emit(\'sort\', \'clicks\')">{{ sort }}</button>' } } }
    });
    await flushPromises();
    expect(wrapper.find('.stub-sort').text()).toBe('impressions');
    await wrapper.find('.stub-sort').trigger('click');
    await flushPromises();
    expect(fetchMock.mock.calls.map(([url]) => String(url)).some(url => url.includes('/api/stats/products?days=30&sort=clicks&limit=500'))).toBe(true);
    expect(wrapper.find('.stub-sort').text()).toBe('clicks');
  });

  test('sorts the pages on the server', async () => {
    localStorage.setItem('amw-admin-token', 'token');
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

    await wrapper.findAll('th button.sort')[2].trigger('click');
    await flushPromises();
    expect(fetchMock.mock.calls.map(([url]) => String(url)).some(url => url.includes('/api/stats/pages?days=30&sort=ctr') && url.includes('limit=500'))).toBe(true);
  });

  test('shows the active site only, switches it from the header and opens the sites with the gear', async () => {
    localStorage.setItem('amw-admin-token', 'token');
    setActiveSite('blog.example');
    const fetchMock = vi.fn((url: string) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/status')) return jsonResponse(200, { stats: true, retentionDays: 90 });
      if (path.endsWith('/sites')) return jsonResponse(200, { sites: [{ host: 'blog.example' }, { host: 'shop.example:8080' }] });
      if (path.endsWith('/stats/daily')) return jsonResponse(200, [ACTIVE_DAY]);
      if (path.endsWith('/stats/domains/daily')) {
        return jsonResponse(200, ['blog.example', 'shop.example'].map(domain => ({ domain, impressions: 1, clicks: 0, ctr: 0, daily: [] })));
      }
      return jsonResponse(200, []);
    });
    vi.stubGlobal('fetch', fetchMock);

    window.location.hash = '#/overview';
    const wrapper = mount(DashboardView, { global: { stubs: { DailyChart: true, SitesTrend: true } } });
    await flushPromises();

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    for (const path of ['stats/daily?days=30', 'stats/products?days=30&sort=impressions&limit=500', 'stats/products/count?days=30', 'stats/pages?days=30&sort=clicks', 'stats/notfound?days=30&limit=500']) {
      expect(urls.some(url => url.includes(path) && url.includes('site=blog.example'))).toBe(true);
    }
    // No figures of every site together: the Amazon quota moved to the server settings
    expect(urls.some(url => url.includes('stats/domains?'))).toBe(false);
    expect(wrapper.find('#view-panel').text()).not.toContain('Amazon quota');
    expect(wrapper.findComponent({ name: 'SitesTrend' }).props('trends')).toEqual([expect.objectContaining({ domain: 'blog.example' })]);

    const select = wrapper.find('select.site-filter');
    expect(select.findAll('option').map(option => option.text())).toEqual(['blog.example', 'shop.example:8080']);
    await select.setValue('shop.example:8080');
    expect(activeSite.value).toBe('shop.example:8080');
    expect(localStorage.getItem('amw-admin-site')).toBe('shop.example:8080');

    await wrapper.find('button[aria-label="Manage the sites"]').trigger('click');
    expect(window.location.hash).toBe('#/sites');
  });

  test('explains how to get figures when the site has no traffic yet', async () => {
    localStorage.setItem('amw-admin-token', 'token');
    setActiveSite('new.example');
    vi.stubGlobal('fetch', vi.fn((url: string) => (new URL(url).pathname.endsWith('/status')
      ? jsonResponse(200, { stats: true, retentionDays: 90 })
      : jsonResponse(200, []))));
    window.location.hash = '#/overview';
    const wrapper = mount(DashboardView, { global: { stubs: { DailyChart: true } } });
    await flushPromises();

    expect(wrapper.find('.notice h2').text()).toBe('No traffic from new.example over the last 30 days');
    expect(wrapper.find('.kpis').exists()).toBe(false);
  });

  test('opens on the first site, follows a removed active site, and asks for a site when there is none', async () => {
    localStorage.setItem('amw-admin-token', 'token');
    setActiveSite('gone.example');
    let hosts = [{ host: 'blog.example' }];
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/status')) return jsonResponse(200, { stats: true, retentionDays: 90 });
      if (path.endsWith('/sites')) return jsonResponse(200, { sites: hosts });
      return jsonResponse(200, []);
    }));

    mount(DashboardView, { global: { stubs: { DailyChart: true } } });
    await flushPromises();
    expect(activeSite.value).toBe('blog.example');

    // A first visit opens on the first site too
    setActiveSite('');
    mount(DashboardView, { global: { stubs: { DailyChart: true } } });
    await flushPromises();
    expect(activeSite.value).toBe('blog.example');

    hosts = [];
    setActiveSite('gone.example');
    mount(DashboardView, { global: { stubs: { DailyChart: true } } });
    await flushPromises();
    expect(activeSite.value).toBe('');

    // Without any site: no figures, and the gear of the title bar is the way to add one
    window.location.hash = '#/overview';
    const empty = mount(DashboardView, { global: { stubs: { DailyChart: true } } });
    await flushPromises();
    expect(empty.find('.notice h2').text()).toBe('No site yet');
    expect(empty.find('.scope-badge').text()).toBe('No site yet');
    expect(empty.find('button[aria-label="Manage the sites"]').exists()).toBe(true);
    expect(empty.find('.kpis').exists()).toBe(false);
  });

  test('goes back to the login screen when the token expired', async () => {
    localStorage.setItem('amw-admin-token', 'expired');
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
    // A day with traffic: without any, the overview shows how to get some instead of its figures
    if (path.endsWith('/stats/daily')) return jsonResponse(200, [ACTIVE_DAY]);
    return jsonResponse(200, []);
  });
}

const ACTIVE_DAY = { date: '2026-11-01', cache: 3, amazon: 1, notfound: 0, views: 4, clicks: 1, amazonCalls: 1 };

describe('Navigation', () => {
  test('opens the overview by default and keeps the view in the URL hash', async () => {
    localStorage.setItem('amw-admin-token', 'token');
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
    localStorage.setItem('amw-admin-token', 'token');
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
    localStorage.setItem('amw-admin-token', 'token');
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
    expect(tabs.map(tab => tab.attributes('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1', '-1', '-1', '-1', '-1', '-1', '-1', '-1', '-1']);
    // The sites open with the gear of the site switcher
    expect(tabs.map(tab => tab.attributes('aria-label'))).toEqual(['Overview', 'Products', 'Pages', 'To replace', 'AI Recommendation', 'Design', 'Stuffing', 'Custom products', 'Best deals', 'AI', 'Amazon quota', 'AI cost', 'Server settings']);

    (tabs[0].element as HTMLElement).focus();
    await tabs[0].trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();
    expect(document.activeElement).toBe(tabs[1].element);
    expect(tabs[1].attributes('tabindex')).toBe('0');

    await tabs[1].trigger('keydown', { key: 'ArrowUp' });
    await flushPromises();
    await tabs[0].trigger('keydown', { key: 'ArrowUp' });
    await flushPromises();
    expect(document.activeElement).toBe(tabs[12].element);
    expect(wrapper.emitted('select')).toBeUndefined();

    await tabs[12].trigger('click');
    expect(wrapper.emitted('select')).toEqual([['settings']]);
  });

  test('puts the views of every site at the bottom, and leads the logo to the overview', () => {
    const wrapper = mount(ActivityBar, { props: { active: 'products' } });
    const children = [...wrapper.find('[role=tablist]').element.children].map(child => (child as HTMLElement).dataset.view ?? child.className);
    expect(children.slice(-4)).toEqual(['activity-spacer', 'quota', 'aicost', 'settings']);
    expect(wrapper.find('a.activitybar-logo').attributes('href')).toBe('#/overview');
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
    localStorage.setItem('amw-admin-token', 'token');
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
    expect(url).toMatch(/\/api\/insights\?days=30&site=blog\.example$/);
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
    expect(regenerateUrl).toMatch(/\/api\/insights\?days=30&site=blog\.example$/);
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
    expect(wrapper.text()).toContain('No analysis of the last 7 days of blog.example yet.');
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
    expect(url).toMatch(/days=90&site=blog\.example$/);
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

  test('shows the cost estimate in its own view, out of the AI view, with a period', async () => {
    const usage = [{ feature: 'recommendation', model: 'claude-haiku-5-5', calls: 4, inputTokens: 8000, outputTokens: 400, estimatedCost: 0.01 }];
    const fetchMock = statsFetch(path => {
      if (path.endsWith('/insights')) return jsonResponse(200, SUCCESS);
      if (path.endsWith('/stats/llm')) return jsonResponse(200, usage);
      return undefined;
    });
    vi.stubGlobal('fetch', fetchMock);
    window.location.hash = '#/insights';
    const wrapper = mount(DashboardView, { global: { stubs: { DailyChart: true } } });
    await flushPromises();
    expect(wrapper.text()).toContain('Clicks are up.');
    expect(wrapper.find('.ai-cost').exists()).toBe(false);

    await wrapper.find('#tab-aicost').trigger('click');
    await flushPromises();
    expect(wrapper.find('.ai-cost').text()).toContain('Estimated AI cost');
    expect(wrapper.find('.ai-cost').text()).toContain('claude-haiku-5-5');
    expect(wrapper.find('.periods').exists()).toBe(true);
    expect(wrapper.find('select.site-filter').exists()).toBe(false);
  });

  test('says when Claude was not called over the period', async () => {
    vi.stubGlobal('fetch', statsFetch());
    window.location.hash = '#/aicost';
    const wrapper = mount(DashboardView, { global: { stubs: { DailyChart: true } } });
    await flushPromises();
    expect(wrapper.find('.ai-cost').text()).toContain('No call to Claude over the period');
  });
});

describe('Charts and key figures', () => {
  test('write the dates without the year and the large numbers in short', () => {
    expect(shortDate('2026-11-03')).toBe('Nov 3');
    expect(compact(1234)).toBe('1.2K');
    expect(compact(12)).toBe('12');
  });

  test('show the change of a figure against the previous period, good or bad', () => {
    const up = mount(KpiTile, { props: { label: 'Views', value: 1200, previous: 1000, series: [1, 3, 2] } });
    expect(up.find('.kpi-value').text()).toBe('1,200');
    expect(up.find('.kpi-change').classes()).toContain('good');
    expect(up.find('.kpi-change').text()).toBe('+20 % against the previous period');
    expect(up.find('.kpi-spark polyline').exists()).toBe(true);

    // More products not found is bad news
    const notFound = mount(KpiTile, { props: { label: 'Not found', value: 120, previous: 100, better: 'down' } });
    expect(notFound.find('.kpi-change').classes()).toContain('bad');

    const rate = mount(KpiTile, { props: { label: 'CTR', kind: 'rate', value: 0.041, previous: 0.045 } });
    expect(rate.find('.kpi-value').text()).toBe('4.1 %');
    expect(rate.find('.kpi-change').text()).toBe('−0.4 pt against the previous period');
    expect(rate.find('.kpi-change').classes()).toContain('bad');

    // Nothing to compare with: no change, rather than an infinite rise
    expect(mount(KpiTile, { props: { label: 'Views', value: 10, previous: 0 } }).find('.kpi-change').exists()).toBe(false);
    expect(mount(KpiTile, { props: { label: 'Views', value: 10 } }).find('.kpi-change').exists()).toBe(false);
  });

  test('stack the requests with gaps and a rounded top, and total them in the tooltip', () => {
    const daily = [{ date: '2026-11-01', cache: 3, amazon: 1, notfound: 1, views: 4, clicks: 1, amazonCalls: 1 }];
    const wrapper = mount(DailyChart, { props: { daily, kind: 'hits' }, global: { stubs: { Bar: true } } });
    const bar = wrapper.findComponent({ name: 'Bar' });
    const datasets = (bar.props('data') as { datasets: { borderRadius: unknown; borderWidth: unknown }[] }).datasets;
    expect(datasets.map(dataset => dataset.borderRadius)).toEqual([0, 0, { topLeft: 4, topRight: 4 }]);
    expect(datasets[0].borderWidth).toBe(0);
    const footer = (bar.props('options') as { plugins: { tooltip: { callbacks: { footer: (items: unknown[]) => string } } } }).plugins.tooltip.callbacks.footer;
    expect(footer([{ parsed: { y: 3 } }, { parsed: { y: 1 } }, { parsed: { y: 1 } }])).toBe('Total: 5');
  });

  test('fetch the previous period of the same length for the overview', async () => {
    localStorage.setItem('amw-admin-token', 'token');
    const fetchMock = statsFetch();
    vi.stubGlobal('fetch', fetchMock);
    window.location.hash = '#/overview';
    mount(DashboardView, { global: { stubs: { DailyChart: true, SitesTrend: true } } });
    await flushPromises();
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    const from = new Date(Date.now() - 59 * 86400000).toISOString().slice(0, 10);
    const to = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    expect(urls.some(url => url.includes(`stats/daily?from=${from}&to=${to}`))).toBe(true);
  });

  test('show no change when the previous period has too little traffic to compare', async () => {
    localStorage.setItem('amw-admin-token', 'token');
    // The same single day of traffic for both periods: one day out of 30 is not enough
    vi.stubGlobal('fetch', statsFetch());
    window.location.hash = '#/overview';
    const wrapper = mount(DashboardView, { global: { stubs: { DailyChart: true, SitesTrend: true } } });
    await flushPromises();
    expect(wrapper.find('.kpis').exists()).toBe(true);
    expect(wrapper.find('.kpi-change').exists()).toBe(false);
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
        }],
        sort: 'impressions'
      }
    });
    const cells = wrapper.findAll('td').map(cell => cell.text());
    expect(cells).toEqual(['Arduino Uno', 'B084DN3XVN', '1,200', '30', '2.5 %, close to the site\'s 2.5 %', '—']);
    expect(wrapper.find('a').attributes('href')).toBe('https://www.amazon.fr/dp/B084DN3XVN');
  });

  test('TopProducts tells how long each product has been cached', () => {
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000 - 1000).toISOString();
    const product = (value: string, fetchedAt?: string) =>
      ({ product: `id:${value}`, type: 'id' as const, value, title: value, impressions: 1, clicks: 0, ctr: 0, fetchedAt });
    const wrapper = mount(TopProducts, {
      props: { products: [product('B000000001', ago(0)), product('B000000002', ago(42)), product('B000000003', ago(185)), product('B000000004')], sort: 'impressions' }
    });

    const ages = wrapper.findAll('tbody tr').map(row => row.findAll('td').at(-1)?.text());
    expect(ages).toEqual(['< 1 min', '42 min', '3 h 05', '—']);
    expect(wrapper.findAll('tbody tr')[3].findAll('td').at(-1)?.attributes('title')).toBe('Not in cache');
  });

  test('TopProducts ranks by the column clicked, as the server sorts', async () => {
    const wrapper = mount(TopProducts, {
      props: { products: [{ product: 'id:B000000001', type: 'id' as const, value: 'B000000001', title: 'A', impressions: 2, clicks: 1, ctr: 0.5 }], sort: 'impressions' }
    });
    const headers = wrapper.findAll('th button.sort');
    expect(headers.map(header => header.text())).toEqual(['Impressions', 'Clicks', 'CTR']);
    expect(wrapper.findAll('th')[2].attributes('aria-sort')).toBe('descending');
    await headers[2].trigger('click');
    expect(wrapper.emitted('sort')).toEqual([['ctr']]);
  });

  test('NotFoundTable sorts by failed lookups, absence or pages', async () => {
    const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();
    const missing = (value: string, count: number, firstSeen: string | null, pages: number) => ({
      product: `id:${value}`, type: 'id' as const, value, count, firstSeen, lastSeen: firstSeen,
      referers: Array.from({ length: pages }, (_, i) => ({ url: `https://blog.example/${value}/${i}`, count: 1 }))
    });
    const wrapper = mount(NotFoundTable, {
      props: { products: [missing('B000000001', 5, hoursAgo(2), 1), missing('B000000002', 9, hoursAgo(100), 0), missing('B000000003', 1, null, 3), missing('B000000004', 5, hoursAgo(50), 2)] }
    });
    const order = () => wrapper.findAll('tbody tr').map(row => row.find('code').text());
    expect(order()).toEqual(['B000000002', 'B000000004', 'B000000001', 'B000000003']);

    const headers = wrapper.findAll('th button.sort');
    expect(headers.map(header => header.text())).toEqual(['Failed lookups', 'Missing for', 'Pages']);
    await headers[1].trigger('click');
    expect(order()).toEqual(['B000000002', 'B000000004', 'B000000001', 'B000000003']);
    expect(wrapper.findAll('th')[2].attributes('aria-sort')).toBe('descending');
    await headers[2].trigger('click');
    expect(order()).toEqual(['B000000003', 'B000000004', 'B000000001', 'B000000002']);
  });

  test('untrusted URLs are never rendered as links or images', () => {
    const wrapper = mount(TopProducts, {
      props: {
        products: [{
          product: 'id:X', type: 'id', value: 'X', title: 'Evil',
          image: 'javascript:alert(1)', url: 'javascript:alert(1)', impressions: 1, clicks: 0, ctr: 0
        }],
        sort: 'impressions'
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
    expect(cells).toEqual(['https://blog.example/post', '1,200', '30', '2.5 %, close to the site\'s 2.5 %']);
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
    // Full dates: the axis writes them "Oct 10" and the tooltip keeps the year
    expect(data.labels).toEqual(['2026-10-10', '2026-10-11']);
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
    expect(wrapper.text()).toContain('No view over this period.');
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
  // The pages of the active site only
  beforeEach(() => setActiveSite('blog.example'));

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

  test('pages through the pages, and stays on the page of a saved row', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...entry, hash: i.toString(16).padStart(32, '0'), title: `Article ${i}`, product: `produit ${i}` }));
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => (init.method === 'PUT'
      ? jsonResponse(200, { ...many[27], product: 'nouveau', editedAt: '2026-11-06T00:00:00.000Z', suggested: 'produit 27' })
      : jsonResponse(200, { available: true, total: 30, items: many }))));
    const wrapper = await mounted();

    expect(wrapper.findAll('.keywords tbody tr')).toHaveLength(25);
    expect(wrapper.find('.pager').text()).toContain('1–25 of 30');
    await wrapper.find('button[aria-label="Next page"]').trigger('click');
    expect(wrapper.findAll('.keywords tbody tr')).toHaveLength(5);

    const row = wrapper.findAll('.keywords tbody tr')[2];
    await row.find('.keywords-edit input').setValue('nouveau');
    await row.find('.keywords-edit').trigger('submit');
    await flushPromises();
    expect(wrapper.find('.pager').text()).toContain('26–30 of 30');
    expect(wrapper.find('.keywords-saved').exists()).toBe(true);
  });

  test('renders a page title as text, and leaves out a URL of another scheme', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(200, {
      available: true, total: 2, items: [
        { ...entry, title: '<img src=x onerror=alert(1)>' },
        // No host: it cannot be a page of the active site, so it is never rendered as a link
        { ...other, title: 'Unsafe', url: 'javascript:alert(1)' }
      ]
    })));
    const wrapper = await mounted();

    expect(wrapper.find('td.page img').exists()).toBe(false);
    expect(wrapper.find('td.page').text()).toContain('<img src=x');
    expect(wrapper.text()).not.toContain('Unsafe');
    expect(wrapper.find('a[href^="javascript"]').exists()).toBe(false);
  });

  test('shows the pages without keywords at the top of the view', async () => {
    serve();
    const wrapper = await mounted();
    const choices = wrapper.findAll('.page-filter label.source-option strong');
    expect(choices.map(choice => choice.text())).toEqual(['All pages (2)', 'Without keywords (1)']);
    expect(wrapper.findAll('.keywords tbody tr')).toHaveLength(2);

    await wrapper.find('input[value=missing]').setValue(true);
    expect(wrapper.findAll('.keywords tbody tr')).toHaveLength(1);
    expect(wrapper.find('.keywords tbody').text()).toContain('Autre chose');
  });

  test('lists the pages of the active site only', async () => {
    const elsewhere = { ...other, hash: 'c'.repeat(32), url: 'https://shop.example/page/', title: 'Ailleurs' };
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(200, { available: true, total: 3, items: [entry, other, elsewhere] })));
    const wrapper = await mounted();
    expect(wrapper.text()).toContain('Un article sur le van');
    expect(wrapper.text()).not.toContain('Ailleurs');

    setActiveSite('news.example');
    const empty = await mounted();
    expect(empty.text()).toContain('No page of news.example has requested a recommendation yet.');
  });

  test('says when the feature is disabled or nothing was requested', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(200, { available: false, reason: 'Automatic products are disabled' })));
    expect((await mounted()).text()).toContain('Automatic products are disabled');

    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(200, { available: true, total: 0, items: [] })));
    expect((await mounted()).text()).toContain('No page of blog.example has requested');
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
    expect(amazonUsage([day(10), day(20, 10), day(0)])).toEqual({ average: 13, peak: 30, approximate: true });
    expect(amazonUsage([])).toEqual({ average: 0, peak: 0, approximate: false });
  });

  test('prefers the calls counted by the server, from the day it counts them', () => {
    expect(amazonUsage([{ ...day(10), amazonCalls: null }, { ...day(10), amazonCalls: 25 }])).toEqual({ average: 18, peak: 25, approximate: true });
    expect(amazonUsage([{ ...day(10), amazonCalls: 0 }, { ...day(10), amazonCalls: 4 }])).toEqual({ average: 2, peak: 4, approximate: false });
  });

  test('charts the share of the quota per day, with the figures in a table', async () => {
    const daily = [{ ...day(0), date: '2026-11-01', amazonCalls: 50 }, { ...day(0), date: '2026-11-02', amazonCalls: 300 }, { ...day(40), date: '2026-10-31' }];
    const wrapper = mount(QuotaChart, { props: { daily, perDay: 200 }, global: { stubs: { Bar: true } } });
    const rows = wrapper.findAll('tbody tr').map(row => row.findAll('td').map(cell => cell.text()));
    expect(rows).toEqual([['2026-11-01', '50', '25 %'], ['2026-11-02', '300', '150 %'], ['2026-10-31', '40 (estimated)', '20 %']]);
    expect(wrapper.findAll('tbody tr')[1].classes()).toContain('over');
    expect(wrapper.find('.chart').attributes('aria-label')).toBe('Share of the daily Amazon quota used per day');

    const bar = wrapper.findComponent({ name: 'Bar' });
    const datasets = (bar.props('data') as { datasets: { label: string; data: number[] }[] }).datasets;
    expect(datasets.map(dataset => dataset.label)).toEqual(['Share of the daily quota', 'Quota (100 %)']);
    expect(datasets[0].data).toEqual([25, 150, 20]);
    expect(datasets[1].data).toEqual([100, 100, 100]);

    const raw = mount(QuotaChart, { props: { daily, perDay: null }, global: { stubs: { Bar: true } } });
    expect(raw.findAll('thead th')).toHaveLength(2);
    const rawSets = (raw.findComponent({ name: 'Bar' }).props('data') as { datasets: { label: string; data: number[] }[] }).datasets;
    expect(rawSets.map(dataset => dataset.label)).toEqual(['Amazon calls']);
    expect(rawSets[0].data).toEqual([50, 300, 40]);
  });

  test('scales the chart to the calls when the busiest day is far below the quota', () => {
    const daily = [{ ...day(0), date: '2026-11-01', amazonCalls: 150 }, { ...day(0), date: '2026-11-02', amazonCalls: 235 }];
    const wrapper = mount(QuotaChart, { props: { daily, perDay: 864000 }, global: { stubs: { Bar: true } } });

    const bar = wrapper.findComponent({ name: 'Bar' });
    const datasets = (bar.props('data') as { datasets: { label: string; data: number[] }[] }).datasets;
    expect(datasets.map(dataset => dataset.label)).toEqual(['Share of the daily quota']);
    const y = (bar.props('options') as { scales: { y: { suggestedMax?: number; ticks: { callback: (value: number) => string } } } }).scales.y;
    expect(y.suggestedMax).toBeUndefined();
    expect(y.ticks.callback(0.025)).toBe('0.025 %');
    expect(wrapper.find('.chart-note').text()).toContain('the 100 % line is above the chart');
    expect(wrapper.findAll('tbody tr').map(row => row.findAll('td')[2].text())).toEqual(['0.017 %', '0.027 %']);
  });

  test('leaves the quota out for a single site, which shares it', () => {
    const wrapper = mount(AmazonQuota, { props: { daily: [day(10)], site: 'blog.example' }, global: { stubs: { QuotaChart: true } } });
    expect(wrapper.text()).toContain('shared by every site');
    expect(wrapper.findComponent({ name: 'QuotaChart' }).exists()).toBe(false);
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
    const top = mount(TopProducts, { props: { products: [product('B000000001', 'Solar panel'), product('B000000002', 'Battery')], sort: 'impressions' } });
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
    const wrapper = mount(SettingsView, { global: { stubs: { SettingsBackup: true, LiveSettingsForm: true } } });
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
    const wrapper = mount(SettingsView, { global: { stubs: { SettingsBackup: true, LiveSettingsForm: true } } });
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
    localStorage.setItem('amw-admin-token', 'token');
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
  const VALUES = {
    enabled: true, count: 1, mode: 'recommendation', containerId: 'main-content', products: ['B000000001'], wordsPerCard: 0,
    sites: { 'old.example': 1 }, allowedSites: ['www.geeek.org', 'apollovan.fr'], editable: true, recommendationEnabled: true
  };
  const PREVIEW = { id: 'B000000001', status: 200, product: { title: 'Echo Dot', image: 'https://m.media-amazon.com/echo.jpg', url: 'https://www.amazon.fr/dp/B000000001' } };

  function mountForm(values: Record<string, unknown> = VALUES, answer?: () => Promise<Response>, previews: unknown[] = [PREVIEW]) {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('/api/products')) {
        const ids = new URL(url).searchParams.get('ids')?.split(',') ?? [];
        return jsonResponse(200, { results: ids.map(id => (previews as { id: string }[]).find(preview => preview.id === id) ?? { id, status: 404 }) });
      }
      return init?.method === 'PUT' && answer ? answer() : jsonResponse(200, values);
    });
    vi.stubGlobal('fetch', fetchMock);
    return { wrapper: mount(StuffingForm), fetchMock };
  }
  const putBody = (fetchMock: ReturnType<typeof vi.fn>) => {
    const [, init] = fetchMock.mock.calls.find(([, options]) => (options as RequestInit | undefined)?.method === 'PUT') as unknown as [string, RequestInit];
    return JSON.parse(init.body as string);
  };

  test('sends no search to a server without deals', async () => {
    const { wrapper, fetchMock } = mountForm(VALUES, () => jsonResponse(200, VALUES));
    await flushPromises();
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(putBody(fetchMock).deals).toBeUndefined();
  });

  test('is off by default, and turns on', async () => {
    const { wrapper, fetchMock } = mountForm({ ...VALUES, enabled: false, count: 0 }, () => jsonResponse(200, VALUES));
    await flushPromises();
    expect((wrapper.find('input[role=switch]').element as HTMLInputElement).checked).toBe(false);
    expect(wrapper.find('input[type=number]').exists()).toBe(false);

    await wrapper.find('input[role=switch]').setValue(true);
    await wrapper.find('input[type=number]').setValue('2');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(putBody(fetchMock)).toMatchObject({ enabled: true, count: 2 });
    expect(wrapper.find('[role=status]').text()).toContain('Saved');
  });

  const sliders = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('.mix-source input[type=range]');
  const shares = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('.mix-share').map(output => output.text());
  const withMix = { ...VALUES, deals: { keywords: '', searchIndex: 'All', minSavingPercent: 20 }, weights: { recommendation: 0, popular: 0, manual: 0, deals: 0 } };

  test('shows a single source as 100 %, the others off', async () => {
    const { wrapper } = mountForm({ ...withMix, mode: 'popular' });
    await flushPromises();
    expect(wrapper.findAll('.mix-text strong').map(label => label.text())).toEqual(['AI recommendations', 'Best products of the site', 'Custom product list', 'Best deals']);
    expect(shares(wrapper)).toEqual(['Off', '100 %', 'Off', 'Off']);
    expect(wrapper.text()).toContain('While the site has too few clicks, the cards show the custom products of the site (1)');
    expect(wrapper.find('a[href="#/custom"]').exists()).toBe(true);
  });

  test('moves one share alone, shows the total in red above 100 %, and saves a mix of 100 %', async () => {
    const { wrapper, fetchMock } = mountForm(withMix, () => jsonResponse(200, withMix));
    await flushPromises();
    expect(shares(wrapper)).toEqual(['100 %', 'Off', 'Off', 'Off']);
    const save = () => wrapper.find('button[type=submit]');

    await sliders(wrapper)[2].setValue('60');
    // The others stay as they were
    expect(shares(wrapper)).toEqual(['100 %', 'Off', '60 %', 'Off']);
    expect(wrapper.find('.mix-total').text().replace(/\s+/g, ' ')).toContain('Total: 160 % — 60 % too many');
    expect(wrapper.find('.mix-total').classes()).toContain('over');
    expect(wrapper.findAll('.mix-share.over')).toHaveLength(4);
    expect(save().attributes('disabled')).toBeDefined();

    await sliders(wrapper)[0].setValue('20');
    expect(wrapper.find('.mix-total').text()).toContain('20 % left to give');
    expect(wrapper.findAll('.mix-share.over')).toHaveLength(0);
    expect(save().attributes('disabled')).toBeDefined();

    await sliders(wrapper)[3].setValue('20');
    expect(wrapper.find('.mix-total').text()).toBe('Total: 100 %');
    // Deals need a search of the Best deals view
    expect(wrapper.find('a[href="#/deals"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Add one search at least before saving');
    expect(save().attributes('disabled')).toBeDefined();
  });

  test('keeps the deals searches when saving, and links to them', async () => {
    const search = { keywords: 'casque', searchIndex: 'Electronics', minSavingPercent: 40, maxProducts: 5 };
    const values = { ...withMix, mode: 'mix', weights: { recommendation: 80, popular: 0, manual: 0, deals: 20 }, dealSearches: [search] };
    const { wrapper, fetchMock } = mountForm(values, () => jsonResponse(200, values));
    await flushPromises();
    expect(wrapper.find('.stuffing-products-link').text()).toContain('best deals searches of the site (1)');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(putBody(fetchMock)).toMatchObject({ mode: 'mix', weights: { recommendation: 80, popular: 0, manual: 0, deals: 20 }, dealSearches: [search] });
  });

  test('saves a source at 100 % in its own mode', async () => {
    const { wrapper, fetchMock } = mountForm(withMix, () => jsonResponse(200, withMix));
    await flushPromises();
    await sliders(wrapper)[0].setValue('0');
    await sliders(wrapper)[1].setValue('100');
    expect(shares(wrapper)).toEqual(['Off', '100 %', 'Off', 'Off']);
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(putBody(fetchMock)).toMatchObject({ mode: 'popular' });
  });

  test('reads the weights of a mix saved before the shares made 100', async () => {
    const { wrapper } = mountForm({ ...withMix, mode: 'mix', weights: { recommendation: 1, popular: 1, manual: 2, deals: 0 } });
    await flushPromises();
    expect(shares(wrapper)).toEqual(['25 %', '25 %', '50 %', 'Off']);
  });

  test('turns a server without a switch on when it adds cards', async () => {
    const { enabled: _enabled, ...older } = VALUES;
    const { wrapper } = mountForm(older);
    await flushPromises();
    expect((wrapper.find('input[role=switch]').element as HTMLInputElement).checked).toBe(true);
  });

  test('sets a ratio of words for the active site, which then has its own settings', async () => {
    const { wrapper, fetchMock } = mountForm({ ...VALUES, own: false }, () => jsonResponse(200, { ...VALUES, own: true }));
    await flushPromises();
    // The site is the context of the whole page: no number per site any more
    expect(wrapper.find('.stuffing-sites').exists()).toBe(false);
    expect(wrapper.find('.site-inherit').text()).toContain('blog.example uses the Stuffing of every site');

    await wrapper.find('input[step="50"]').setValue('300');
    expect(wrapper.text()).toContain('An article of 600 words gets 2 cards at most');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(putBody(fetchMock)).toMatchObject({ wordsPerCard: 300 });
    expect(String(fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')?.[0])).toContain('stuffing?site=blog.example');
    expect(wrapper.find('.site-inherit').exists()).toBe(false);
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
    expect(readOnly.wrapper.find('button[type=submit]').attributes('disabled')).toBeDefined();
    expect(readOnly.wrapper.text()).toContain('requires Redis');

    const noRecommendations = mountForm({ ...VALUES, recommendationEnabled: false });
    await flushPromises();
    expect(noRecommendations.wrapper.text()).toContain('Recommendation.enabled');

    // The manual list never calls the AI model, nor do cards switched off
    const manual = mountForm({ ...VALUES, mode: 'manual', recommendationEnabled: false });
    await flushPromises();
    expect(manual.wrapper.findAll('.mix-share').map(output => output.text())).toEqual(['Off', 'Off', '100 %', 'Off']);
    expect(manual.wrapper.text()).not.toContain('Recommendation.enabled');
    const off = mountForm({ ...VALUES, enabled: false, recommendationEnabled: false });
    await flushPromises();
    expect(off.wrapper.text()).not.toContain('Recommendation.enabled');
  });

  test('signs out when the session expired', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(401, {})));
    const wrapper = mount(StuffingForm);
    await flushPromises();
    expect(wrapper.emitted('logout')).toHaveLength(1);
  });
});

describe('CustomProductsView', () => {
  const VALUES = {
    enabled: true, count: 1, mode: 'recommendation', containerId: 'main-content', products: ['B000000001'], wordsPerCard: 0,
    sites: { 'old.example': 1 }, allowedSites: ['www.geeek.org', 'apollovan.fr'], editable: true, recommendationEnabled: true
  };
  const PREVIEW = { id: 'B000000001', status: 200, product: { title: 'Echo Dot', image: 'https://m.media-amazon.com/echo.jpg', url: 'https://www.amazon.fr/dp/B000000001' } };

  function mountForm(values: Record<string, unknown> = VALUES, answer?: () => Promise<Response>, previews: unknown[] = [PREVIEW]) {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('/api/products')) {
        const ids = new URL(url).searchParams.get('ids')?.split(',') ?? [];
        return jsonResponse(200, { results: ids.map(id => (previews as { id: string }[]).find(preview => preview.id === id) ?? { id, status: 404 }) });
      }
      return init?.method === 'PUT' && answer ? answer() : jsonResponse(200, values);
    });
    vi.stubGlobal('fetch', fetchMock);
    return { wrapper: mount(CustomProductsView), fetchMock };
  }

  test('says what the list does with the source of the Stuffing cards', async () => {
    const { wrapper } = mountForm({ ...VALUES, mode: 'deals', own: false });
    await flushPromises();
    expect(wrapper.text()).toContain('this list is kept for when you choose another source');
    expect(wrapper.find('.site-inherit').text()).toContain('blog.example uses the Stuffing of every site');
    // Nothing changed yet
    expect(wrapper.find('button[type=submit]').attributes('disabled')).toBeDefined();
  });

  test('previews the products, adds, orders and removes them', async () => {
    const added = { id: 'B084DN3XVN', status: 200, product: { title: 'Kindle', image: 'javascript:alert(1)', url: 'https://www.amazon.fr/dp/B084DN3XVN' } };
    const { wrapper, fetchMock } = mountForm(VALUES, () => jsonResponse(200, VALUES), [PREVIEW, added]);
    await flushPromises();

    let rows = wrapper.findAll('.product-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].find('img').attributes('src')).toBe('https://m.media-amazon.com/echo.jpg');
    expect(rows[0].find('a').text()).toBe('Echo Dot');

    const input = wrapper.find('input[aria-label="ASIN to add"]');
    await input.setValue('nope');
    expect(wrapper.find('[role=alert]').text()).toContain('10 letters or digits');
    await input.setValue('b000000001');
    expect(wrapper.find('[role=alert]').text()).toContain('already in the list');
    await input.setValue(' b084dn3xvn ');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    await input.setValue('B00GONE001');
    await wrapper.findAll('button').find(button => button.text().includes('Add'))?.trigger('click');
    await flushPromises();

    rows = wrapper.findAll('.product-row');
    expect(rows.map(row => row.find('code').text())).toEqual(['B000000001', 'B084DN3XVN', 'B00GONE001']);
    // Looked up once each, and never with an unsafe image
    const lookups = fetchMock.mock.calls.map(([url]) => String(url)).filter(url => url.includes('/api/products'));
    expect(lookups.map(url => new URL(url).searchParams.get('ids'))).toEqual(['B000000001', 'B084DN3XVN', 'B00GONE001']);
    expect(rows[1].find('img').exists()).toBe(false);
    expect(rows[2].text()).toContain('Amazon does not return this product');

    await rows[0].find('button[aria-label="Move B000000001 down"]').trigger('click');
    await wrapper.find('button[aria-label="Remove B00GONE001"]').trigger('click');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    // The list alone, so that the other Stuffing settings stay as the Stuffing view left them
    const [url, init] = fetchMock.mock.calls.find(([, options]) => (options as RequestInit | undefined)?.method === 'PUT') as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toMatch(/\/api\/stuffing\/products$/);
    expect(new URL(url).searchParams.get('site')).toBe('blog.example');
    expect(JSON.parse(init.body as string)).toEqual({ products: ['B084DN3XVN', 'B000000001'] });
    expect(wrapper.find('[role=status]').text()).toBe('Saved.');
  });

  test('stops at 20 products', async () => {
    const products = Array.from({ length: 20 }, (_, i) => `B0000000${String(i).padStart(2, '0')}`);
    const { wrapper } = mountForm({ ...VALUES, products });
    await flushPromises();
    expect(wrapper.find('input[aria-label="ASIN to add"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('Custom products (20/20)');
  });

  test('says when the previews fail, and keeps the list', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => (url.includes('/api/products') ? jsonResponse(503, { message: 'down' }) : jsonResponse(200, VALUES))));
    const wrapper = mount(CustomProductsView);
    await flushPromises();
    expect(wrapper.text()).toContain('could not be previewed: down');
    expect(wrapper.findAll('.product-row')).toHaveLength(1);
  });

});

describe('DealsView', () => {
  const VALUES = {
    enabled: true, count: 2, mode: 'deals', containerId: 'main-content', products: [], wordsPerCard: 0, sites: {},
    deals: { keywords: 'casque', searchIndex: 'Electronics', minSavingPercent: 30 }, dealSearches: [], editable: true, recommendationEnabled: true, allowedSites: []
  };
  function serve(values: Record<string, unknown> = VALUES) {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/deals/preview')) {
        const keywords = new URL(url).searchParams.get('keywords');
        if (keywords === 'down') return jsonResponse(503, { message: 'Amazon is down' });
        return jsonResponse(200, { results: keywords === 'nothing' ? [] : [
          { asin: 'B0DEAL0001', savings: 40, product: { title: 'Casque A', image: 'https://m.media-amazon.com/a.jpg', url: 'https://www.amazon.fr/dp/B0DEAL0001' } },
          { asin: 'B0DEAL0002', savings: 25, product: { title: 'Casque B', image: 'javascript:alert(1)', url: 'https://www.amazon.fr/dp/B0DEAL0002' } }
        ] });
      }
      if (init?.method === 'PUT') return jsonResponse(200, { ...values, dealSearches: JSON.parse(init.body as string).searches });
      return jsonResponse(200, values);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  test('starts from the single search saved before, previews it, and saves several searches', async () => {
    const fetchMock = serve();
    const wrapper = mount(DealsView);
    await flushPromises();
    const rows = () => wrapper.findAll('.deal-search');
    expect(rows()).toHaveLength(1);
    expect((rows()[0].find('input[type=text]').element as HTMLInputElement).value).toBe('casque');

    await rows()[0].findAll('button').find(button => button.text().includes('Preview'))!.trigger('click');
    await flushPromises();
    const results = rows()[0].findAll('.deal-result');
    expect(results.map(result => result.find('.deal-saving').text())).toEqual(['-40 %', '-25 %']);
    expect(results[1].find('img').exists()).toBe(false);
    const preview = fetchMock.mock.calls.map(([url]) => new URL(String(url))).find(url => url.pathname.endsWith('/deals/preview'))!;
    expect(Object.fromEntries(preview.searchParams)).toEqual({ keywords: 'casque', searchIndex: 'Electronics', minSavingPercent: '30', maxProducts: '10' });

    // A changed search hides the preview of the former one
    await rows()[0].find('input[type=text]').setValue('casque bluetooth');
    expect(rows()[0].find('.deal-results').exists()).toBe(false);

    await wrapper.findAll('button').find(button => button.text().includes('Add a search'))!.trigger('click');
    expect(wrapper.find('button[type=submit]').attributes('disabled')).toBeDefined();
    await rows()[1].find('input[type=text]').setValue(' lego ');
    await rows()[1].find('select').setValue('ToysAndGames');
    await rows()[1].findAll('input[type=number]')[1].setValue('3');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    const [url, init] = fetchMock.mock.calls.find(([, options]) => (options as RequestInit | undefined)?.method === 'PUT') as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toMatch(/\/api\/stuffing\/deals$/);
    expect(JSON.parse(init.body as string)).toEqual({ searches: [
      { keywords: 'casque bluetooth', searchIndex: 'Electronics', minSavingPercent: 30, maxProducts: 10 },
      { keywords: 'lego', searchIndex: 'ToysAndGames', minSavingPercent: 20, maxProducts: 3 }
    ] });
    expect(wrapper.find('[role=status]').text()).toBe('Saved.');
  });

  test('says when a search finds nothing or fails, and stops at 5 searches', async () => {
    serve({ ...VALUES, dealSearches: [
      { keywords: 'nothing', searchIndex: 'All', minSavingPercent: 90, maxProducts: 10 },
      { keywords: 'down', searchIndex: 'All', minSavingPercent: 20, maxProducts: 10 }
    ] });
    const wrapper = mount(DealsView);
    await flushPromises();
    const rows = wrapper.findAll('.deal-search');
    for (const row of rows) {
      await row.findAll('button').find(button => button.text().includes('Preview'))!.trigger('click');
      await flushPromises();
    }
    expect(rows[0].text()).toContain('Amazon finds no product of every category with 90 % off at least');
    expect(rows[1].find('[role=alert]').text()).toContain('Amazon is down');

    const add = () => wrapper.findAll('button').find(button => button.text().includes('Add a search'))!;
    for (let i = 0; i < 3; i++) await add().trigger('click');
    expect(wrapper.findAll('.deal-search')).toHaveLength(5);
    expect(add().attributes('disabled')).toBeDefined();
    await wrapper.findAll('.deal-search')[0].find('button[aria-label="Remove search 1"]').trigger('click');
    expect(wrapper.findAll('.deal-search')).toHaveLength(4);
    // The preview of the former second search moved up with it
    expect(wrapper.findAll('.deal-search')[0].find('[role=alert]').exists()).toBe(true);
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

  test('asks for more evidence as more groups are compared', () => {
    const variant = (name: string, views: number, clicks: number) => ({ name, views, clicks, ctr: clicks / views });
    // z ≈ 2.45: a winner against one group, not among nine
    const pair = [variant('shelf', 10000, 300), variant('neon', 10000, 362)];
    expect(compareVariants(pair, 'shelf')[1].verdict).toBe('better');
    const crowd = [...pair, ...['native', 'receipt', 'blueprint', 'outdoor', 'terminal', 'magazine', 'pastel'].map(name => variant(name, 10000, 300))];
    expect(compareVariants(crowd, 'shelf')[1].verdict).toBe('no-difference');
  });

  test('shows the table', () => {
    const variant = (name: string, views: number, clicks: number) => ({ name, views, clicks, ctr: clicks / views });
    const wrapper = mount(VariantComparison, { props: { rows: [variant('none', 10000, 300), variant('fade', 10000, 400)], control: 'none', label: 'Effect' } });
    const cells = wrapper.findAll('tbody tr').map(tr => tr.findAll('td').map(td => td.text()));

    expect(wrapper.find('th').text()).toBe('Effect');
    expect(cells[0]).toEqual(['none', '10,000', '300', '3.0 %', '—', 'Control group']);
    expect(cells[1]).toEqual(['fade', '10,000', '400', '4.0 %', '+33.3 %', 'Better than the control']);
  });
});

describe('CtrBadge', () => {
  test('compares the rows of a table with the click-through rate of the site', () => {
    const products = [
      { product: 'id:B000000001', type: 'id' as const, value: 'B000000001', impressions: 1000, clicks: 50, ctr: 0.05 },
      { product: 'id:B000000002', type: 'id' as const, value: 'B000000002', impressions: 1000, clicks: 30, ctr: 0.03 },
    ];
    // Against the table, the first is above its 4 %; against a site at 2 %, both are
    const wrapper = mount(TopProducts, { props: { products, sort: 'impressions', average: 0.02 } });
    expect(wrapper.findAll('.ctr-badge').map(badge => badge.classes().includes('good'))).toEqual([true, true]);
  });


  test('compares a rate with the average of its table', () => {
    const rows = [{ impressions: 1000, clicks: 50 }, { impressions: 1000, clicks: 10 }, { impressions: 50, clicks: 20 }];
    // 80 clicks for 2,050 views: a large row weighs more than a small one
    expect(averageCtr(rows)).toBeCloseTo(80 / 2050);
    expect(averageCtr([])).toBe(0);
    expect(ctrLevel(0.05, 1000, 0.039)).toBe('good');
    expect(ctrLevel(0.039, 1000, 0.039)).toBe('average');
    expect(ctrLevel(0.01, 1000, 0.039)).toBe('low');
    expect(ctrLevel(0.4, 50, 0.039)).toBe('few');
    expect(ctrLevel(0.1, 1000, 0)).toBe('few');
  });

  test('colors the badge and says why, for screen readers too', () => {
    const good = mount(CtrBadge, { props: { ctr: 0.06, impressions: 500, average: 0.04 } });
    expect(good.classes()).toContain('good');
    expect(good.text()).toBe('6.0 %, well above the site\'s 4.0 %');
    expect(good.attributes('title')).toBe('6.0 %: well above the site\'s 4.0 %');
    const few = mount(CtrBadge, { props: { ctr: 0.5, impressions: 10, average: 0.04 } });
    expect(few.classes()).toContain('few');
    expect(few.text()).toContain('too few to judge');
  });
});

describe('QuotaView', () => {
  test('estimates the quota from the calls of every site over 30 days', async () => {
    const fetchMock = vi.fn(() => jsonResponse(200, [{ date: '2026-11-01', cache: 0, amazon: 5, notfound: 0, views: 0, clicks: 0, amazonCalls: 120 }]));
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mount(QuotaView, { global: { stubs: { QuotaChart: true } } });
    await flushPromises();

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain('stats/daily?days=30');
    expect(url).not.toContain('site=');
    expect(wrapper.find('h2').text()).toBe('Amazon quota estimate');
    expect(wrapper.findComponent({ name: 'AmazonQuota' }).exists()).toBe(true);
  });

  test('shows an error instead of a broken chart', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(200, { unexpected: true })));
    const wrapper = mount(QuotaView);
    await flushPromises();
    expect(wrapper.find('[role=alert]').text()).toContain('not available');
  });
});

describe('SitesView', () => {
  const SITE = { host: 'www.geeek.org', description: 'Blog', url: 'https://www.geeek.org/', partnerTag: '' };
  const VALUES = { sites: [SITE], saved: false, defaultTag: 'main-21', recommendationEnabled: true, editable: true };
  const button = (wrapper: ReturnType<typeof mount>, text: string) => wrapper.findAll('button').find(candidate => candidate.text().includes(text));
  const putBodies = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));
  const answering = () => vi.fn((_url: string, init?: RequestInit) => jsonResponse(200, init?.method === 'PUT' ? { ...VALUES, ...JSON.parse(init.body as string), saved: true } : VALUES));

  test('shows each site as a card, without inputs until it is edited', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(200, { ...VALUES, sites: [SITE, { ...SITE, host: 'apollovan.fr', description: '', partnerTag: 'apollovan-21' }] })));
    const wrapper = mount(SitesView);
    await flushPromises();

    const cards = wrapper.findAll('.site-card');
    expect(cards).toHaveLength(2);
    expect(wrapper.find('input').exists()).toBe(false);
    expect(cards[0].text()).toContain('www.geeek.org');
    expect(cards[0].text()).toContain('main-21 (default)');
    expect(cards[0].find('a[href="https://www.geeek.org/"]').exists()).toBe(true);
    expect(cards[1].text()).toContain('No description');
    expect(cards[1].text()).toContain('apollovan-21');
    expect(wrapper.text()).toContain('comes from Server.allowedSites');
  });

  test('edits a card and saves the list at once', async () => {
    const fetchMock = answering();
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mount(SitesView);
    await flushPromises();

    await wrapper.find('button[aria-label="Edit www.geeek.org"]').trigger('click');
    const inputs = wrapper.findAll('.site-card.editing input');
    expect(inputs).toHaveLength(4);
    await inputs[1].setValue(' Mon blog ');
    await inputs[3].setValue('geeek-21');
    await wrapper.find('.site-card.editing form').trigger('submit');
    await flushPromises();

    expect(putBodies(fetchMock)).toEqual([{ sites: [{ host: 'www.geeek.org', description: 'Mon blog', url: 'https://www.geeek.org/', partnerTag: 'geeek-21' }] }]);
    expect(wrapper.find('.site-card.editing').exists()).toBe(false);
    expect(wrapper.find('[role=status]').text()).toContain('www.geeek.org saved');
    expect(wrapper.text()).not.toContain('comes from Server.allowedSites');
  });

  test('cancels an edit without saving', async () => {
    const fetchMock = answering();
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mount(SitesView);
    await flushPromises();

    await wrapper.find('button[aria-label="Edit www.geeek.org"]').trigger('click');
    await wrapper.findAll('.site-card.editing input')[1].setValue('Changed');
    await button(wrapper, 'Cancel')?.trigger('click');

    expect(wrapper.find('.site-card').text()).toContain('Blog');
    expect(putBodies(fetchMock)).toEqual([]);
  });

  test('adds a site in a new card, refusing a host already listed', async () => {
    const fetchMock = answering();
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mount(SitesView);
    await flushPromises();

    await button(wrapper, 'Add a site')?.trigger('click');
    const host = wrapper.find('.site-card.editing input');
    await host.setValue('WWW.geeek.org');
    expect(wrapper.find('[role=alert]').text()).toContain('already listed');
    expect(wrapper.find('.site-card.editing button[type=submit]').attributes('disabled')).toBeDefined();

    await host.setValue(' Apollovan.fr ');
    await wrapper.find('.site-card.editing form').trigger('submit');
    await flushPromises();

    expect(putBodies(fetchMock)).toEqual([{ sites: [SITE, { host: 'apollovan.fr', description: '', url: '', partnerTag: '' }] }]);
    expect(wrapper.findAll('.site-card')).toHaveLength(2);
  });

  test('removes a site only once confirmed', async () => {
    const fetchMock = answering();
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mount(SitesView);
    await flushPromises();

    await wrapper.find('button[aria-label="Remove www.geeek.org"]').trigger('click');
    expect(wrapper.find('.site-card-confirm').text()).toContain('Remove this site?');
    expect(putBodies(fetchMock)).toEqual([]);
    await wrapper.find('.site-card-confirm button.danger').trigger('click');
    await flushPromises();

    expect(putBodies(fetchMock)).toEqual([{ sites: [] }]);
    expect(wrapper.findAll('[role=status]').map(status => status.text())).toContain('www.geeek.org removed.');
  });

  test('keeps the edit open and shows the error when saving fails', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => (init?.method === 'PUT'
      ? jsonResponse(400, { error: 'Bad Request', message: 'sites must list distinct hosts' })
      : jsonResponse(200, VALUES))));
    const wrapper = mount(SitesView);
    await flushPromises();

    await wrapper.find('button[aria-label="Edit www.geeek.org"]').trigger('click');
    await wrapper.find('.site-card.editing form').trigger('submit');
    await flushPromises();

    expect(wrapper.find('.site-card.editing').exists()).toBe(true);
    expect(wrapper.find('[role=alert]').text()).toContain('distinct hosts');
  });

  test('says what an empty list means, and that saving needs a store', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(200, { ...VALUES, editable: false })));
    const wrapper = mount(SitesView);
    await flushPromises();
    expect(wrapper.text()).toContain('requires Redis');
    expect(wrapper.find('button[aria-label="Edit www.geeek.org"]').attributes('disabled')).toBeDefined();
    expect(button(wrapper, 'Add a site')?.attributes('disabled')).toBeDefined();

    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(200, { ...VALUES, sites: [] })));
    const empty = mount(SitesView);
    await flushPromises();
    expect(empty.text()).toContain('every site may show the widget, and recommendations are off');
  });

  test('never links a URL of another scheme', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(200, { ...VALUES, sites: [{ ...SITE, url: 'javascript:alert(1)' }] })));
    const wrapper = mount(SitesView);
    await flushPromises();
    expect(wrapper.find('.site-card a').exists()).toBe(false);
  });

  test('shows an error from an older server', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(200, [])));
    const wrapper = mount(SitesView);
    await flushPromises();
    expect(wrapper.find('[role=alert]').text()).toContain('not available');
  });
});

describe('AbTestsView', () => {
  type Store = { theme: Record<string, unknown>; effect: Record<string, unknown>; label: Record<string, unknown> };
  function serve(store: Store, stats: { themes?: unknown[]; effects?: unknown[]; labels?: unknown[] } = {}) {
    return vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      const body = init?.method === 'PUT' ? JSON.parse(init.body as string) : null;
      const kind = path.endsWith('/theme-test') ? 'theme' : path.endsWith('/effect') ? 'effect' : path.endsWith('/button-label') ? 'label' : null;
      if (kind) {
        if (body) store[kind] = { ...store[kind], ...body };
        return jsonResponse(200, store[kind]);
      }
      if (path.endsWith('/stats/themes')) return jsonResponse(200, stats.themes ?? []);
      if (path.endsWith('/stats/effects')) return jsonResponse(200, stats.effects ?? []);
      if (path.endsWith('/stats/labels')) return jsonResponse(200, stats.labels ?? []);
      return jsonResponse(404, {});
    });
  }
  const idle = (): Store => ({
    theme: { mode: 'off', themes: [], defaultTheme: 'shelf', editable: true },
    effect: { mode: 'none', effects: ['none', 'fade', 'slide', 'zoom', 'pulse'], editable: true },
    label: { label: 'offer', mode: 'off', labels: [], editable: true }
  });
  const puts = (fetchMock: ReturnType<typeof serve>) => fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'PUT')
    .map(([url, init]) => [new URL(url).pathname.split('/api/')[1] + new URL(url).search, JSON.parse((init as RequestInit).body as string)]);
  const section = (wrapper: ReturnType<typeof mount>, title: string) => wrapper.findAll('details').find(s => s.find('h2').text() === title)!;
  const button = (scope: ReturnType<ReturnType<typeof mount>['find']>, text: string) => scope.findAll('button').find(b => b.text().includes(text))!;

  test('applies a theme to the active site, previewed before', async () => {
    const fetchMock = serve(idle());
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mount(AbTestsView, { props: { days: 30 } });
    await flushPromises();
    const theme = section(wrapper, 'Theme');
    // One preview, above the blocks, with the values of every block
    expect(wrapper.findAll('iframe')).toHaveLength(1);
    const preview = () => new URL(wrapper.find('.design-preview iframe').attributes('src')!, 'http://x/').searchParams;
    expect(preview().get('theme')).toBe('shelf');
    expect(button(theme, 'Apply').attributes('disabled')).toBeDefined();

    await theme.find('select').setValue('neon');
    await section(wrapper, 'Button label').find('select').setValue('buy');
    await flushPromises();
    expect(preview().get('theme')).toBe('neon');
    expect(preview().get('label')).toBe('buy');
    await button(theme, 'Apply').trigger('click');
    await flushPromises();
    expect(puts(fetchMock)).toEqual([['theme-test?site=blog.example', { mode: 'off', themes: [], theme: 'neon' }]]);
    expect(theme.find('.experiment-status').text()).toBe('neon');
  });

  test('starts a test, then stops it keeping the winner', async () => {
    const fetchMock = serve(idle(), { labels: [{ label: 'offer', views: 10, clicks: 1, ctr: 0.1 }, { label: 'buy', views: 10, clicks: 3, ctr: 0.3 }] });
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mount(AbTestsView, { props: { days: 30 } });
    await flushPromises();
    let label = section(wrapper, 'Button label');
    expect(button(label, 'Start the test').attributes('disabled')).toBeDefined();
    await label.find('.chips label:nth-child(4) input').setValue(true);
    await button(label, 'Start the test').trigger('click');
    await flushPromises();
    expect(puts(fetchMock).at(-1)).toEqual(['button-label?site=blog.example', { label: 'offer', mode: 'compare', labels: ['offer', 'buy'] }]);

    label = section(wrapper, 'Button label');
    expect(label.text()).toContain('A/B test running');
    // One test at a time on a site
    expect(button(section(wrapper, 'Theme'), 'Start the test').attributes('disabled')).toBeDefined();
    expect(section(wrapper, 'Theme').text()).toContain('A label test runs on this site: stop it to change the theme');
    // Nothing else can change while it runs
    expect(section(wrapper, 'Theme').find('select').attributes('disabled')).toBeDefined();
    expect(button(section(wrapper, 'Appearance effect'), 'Apply').attributes('disabled')).toBeDefined();

    const rows = label.findAll('tbody tr');
    await rows[1].find('button').trigger('click');
    await flushPromises();
    expect(puts(fetchMock).at(-1)).toEqual(['button-label?site=blog.example', { label: 'buy', mode: 'off', labels: [] }]);
    expect(section(wrapper, 'Button label').find('.experiment-status').text()).toBe('Buy on Amazon');
  });

  test('folds the blocks, opening the one with a running test', async () => {
    const store = idle();
    store.effect = { mode: 'compare', effects: ['none', 'zoom'], editable: true };
    vi.stubGlobal('fetch', serve(store));
    const wrapper = mount(AbTestsView, { props: { days: 30 } });
    await flushPromises();
    const open = wrapper.findAll('details').map(block => [block.find('h2').text(), (block.element as HTMLDetailsElement).open]);
    expect(open).toEqual([['Theme', false], ['Appearance effect', true], ['Button label', false]]);
    // One group: the browser keeps one block open at a time
    expect(wrapper.findAll('details').map(block => block.attributes('name'))).toEqual(['design-blocks', 'design-blocks', 'design-blocks']);
    // The summary still says what each block holds
    expect(section(wrapper, 'Theme').find('summary').text()).toContain('shelf');
  });

  test('says how long the running test has been on', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-10T12:00:00Z'), toFake: ['Date', 'setInterval', 'clearInterval'] });
    const store = idle();
    store.label = { label: 'offer', mode: 'compare', labels: ['offer', 'buy'], startedAt: '2026-11-07T08:30:00Z', editable: true };
    vi.stubGlobal('fetch', serve(store));
    const wrapper = mount(AbTestsView, { props: { days: 30 } });
    await flushPromises();
    const timer = () => section(wrapper, 'Button label').find('.experiment-timer');
    expect(timer().text()).toBe('Running for 3 d 3 h');
    vi.advanceTimersByTime(60 * 60_000);
    await flushPromises();
    expect(timer().text()).toBe('Running for 3 d 4 h');
    // No timer outside a test
    expect(section(wrapper, 'Theme').find('.experiment-timer').exists()).toBe(false);
    vi.useRealTimers();
  });

  test('compares the themes against the theme of the site, and the effects against none', async () => {
    const store = idle();
    store.theme = { mode: 'compare', themes: ['shelf', 'neon'], defaultTheme: 'shelf', editable: true };
    vi.stubGlobal('fetch', serve(store, {
      themes: [{ theme: 'shelf', views: 10, clicks: 1, ctr: 0.1 }, { theme: 'neon', views: 10, clicks: 2, ctr: 0.2 }],
      effects: [{ effect: 'fade', views: 10, clicks: 1, ctr: 0.1 }, { effect: 'zoom', views: 10, clicks: 1, ctr: 0.1 }]
    }));
    const wrapper = mount(AbTestsView, { props: { days: 30 } });
    await flushPromises();

    const [themes, effects] = wrapper.findAll('table').map(table => table.findAll('tbody tr').map(tr => tr.findAll('td').map(td => td.text())));
    expect(themes[0]).toEqual(['shelf', '10', '1', '10.0 %', '—', 'Control group', 'Keep']);
    expect(themes[1][4]).toBe('+100.0 %');
    // Without "none" in the results, the first effect is the control; no test runs, so nothing to keep
    expect(effects[0]).toEqual(['fade', '10', '1', '10.0 %', '—', 'Control group']);
  });

  test('is read-only without Redis', async () => {
    const store = idle();
    for (const kind of ['theme', 'effect', 'label'] as const) store[kind].editable = false;
    vi.stubGlobal('fetch', serve(store));
    const wrapper = mount(AbTestsView, { props: { days: 30 } });
    await flushPromises();
    expect(wrapper.findAll('select').every(select => select.attributes('disabled') !== undefined)).toBe(true);
    expect(wrapper.findAll('button').filter(b => b.text().includes('Start')).every(b => b.attributes('disabled') !== undefined)).toBe(true);
  });
});

describe('NotFoundTable columns', () => {
  test('shows no title column: the ASIN or keyword names the product', () => {
    const entry = { product: 'id:B000000001', type: 'id' as const, value: 'B000000001', count: 1, firstSeen: null, lastSeen: null, referers: [], title: 'Arduino' };
    const wrapper = mount(NotFoundTable, { props: { products: [entry] } });
    expect(wrapper.findAll('thead th').map(th => th.text())).toEqual(['ASIN / keyword', 'Failed lookups', 'Missing for', 'Pages']);
    expect(wrapper.text()).not.toContain('Arduino');
  });
});

describe('SettingsBackup', () => {
  test('downloads the exported settings as a JSON file', async () => {
    const fetch = vi.fn((_url: string) => jsonResponse(200, { amw: '5.5.0', sites: { sites: [] } }));
    vi.stubGlobal('fetch', fetch);
    const createObjectURL = vi.fn(() => 'blob:backup');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const wrapper = mount(SettingsBackup);

    await wrapper.findAll('button')[0].trigger('click');
    await flushPromises();

    expect(fetch.mock.calls[0][0]).toContain('settings/export');
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(wrapper.find('[role="status"]').text()).toBe('Exported.');
    click.mockRestore();
  });

  async function pick(wrapper: ReturnType<typeof mount>, content: string) {
    const input = wrapper.find('input[type="file"]');
    Object.defineProperty(input.element, 'files', { value: [new File([content], 'backup.json')], configurable: true });
    await input.trigger('change');
    await flushPromises();
  }

  test('imports a file and reports the sections', async () => {
    const fetch = vi.fn((_url: string, _init?: RequestInit) => jsonResponse(200, { imported: ['stuffing', 'sites'] }));
    vi.stubGlobal('fetch', fetch);
    const wrapper = mount(SettingsBackup);

    await pick(wrapper, '{"sites":{"sites":[]}}');

    expect(fetch.mock.calls[0][0]).toContain('settings/import');
    expect(fetch.mock.calls[0][1]?.body).toBe('{"sites":{"sites":[]}}');
    expect(wrapper.find('[role="status"]').text()).toBe('Imported: stuffing, sites.');
    expect(wrapper.emitted('imported')).toHaveLength(1);
  });

  test('reports a file that is not JSON, and the refusal of the server', async () => {
    const fetch = vi.fn((_url: string) => jsonResponse(400, { message: 'Invalid sections, nothing was imported: themeTest' }));
    vi.stubGlobal('fetch', fetch);
    const wrapper = mount(SettingsBackup);

    await pick(wrapper, 'not json');
    expect(wrapper.find('[role="alert"]').text()).toContain('backup.json is not a JSON file');
    expect(fetch).not.toHaveBeenCalled();

    await pick(wrapper, '{}');
    expect(wrapper.find('[role="alert"]').text()).toContain('nothing was imported: themeTest');
    expect(wrapper.emitted('imported')).toBeUndefined();
  });

  test('logs out when the session expired', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(401, {})));
    const wrapper = mount(SettingsBackup);
    await wrapper.findAll('button')[0].trigger('click');
    await flushPromises();
    expect(wrapper.emitted('logout')).toHaveLength(1);
  });
});

describe('AmwLogo', () => {
  test('gives each logo of the page its own gradient', () => {
    const wrapper = mount(ActivityBar, { props: { active: 'overview' } });
    const bar = wrapper.find('.activitybar-logo svg');
    expect(bar.exists()).toBe(true);
    const id = bar.find('linearGradient').attributes('id');
    expect(bar.find('rect').attributes('fill')).toBe(`url(#${id})`);
    // The dashboard shows two at once: the activity bar's and the phone title bar's
    const both = mount({ components: { AmwLogo }, template: '<div><AmwLogo /><AmwLogo /></div>' });
    const ids = both.findAll('linearGradient').map(gradient => gradient.attributes('id'));
    expect(new Set(ids).size).toBe(2);
  });
});

describe('LiveSettingsForm', () => {
  const configured = { theme: 'default', httpCache: 300, rateLimit: 120, clickRateLimit: 30, viewRateLimit: 60, recommendations: true, dailyLimit: 100, fallback: true, insights: false };
  const answer = (overrides = {}) => ({
    configured, overrides, effective: { ...configured, ...overrides }, themes: ['default', 'neon'], editable: true,
  });

  test('saves only what differs from the configuration', async () => {
    const fetch = vi.fn((_url: string, init?: RequestInit) => jsonResponse(200, init?.method === 'PUT' ? answer(JSON.parse(String(init.body))) : answer()));
    vi.stubGlobal('fetch', fetch);
    const wrapper = mount(LiveSettingsForm);
    await flushPromises();

    await wrapper.find('select').setValue('neon');
    const inputs = wrapper.findAll('input[type="number"]');
    await inputs[0].setValue(60);
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    const put = fetch.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ theme: 'neon', httpCache: 60 });
    expect(wrapper.find('[role="status"]').text()).toBe('Saved.');
    expect(wrapper.emitted('saved')).toHaveLength(1);
  });

  test('cannot turn on an AI feature that the configuration leaves off', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(200, answer())));
    const wrapper = mount(LiveSettingsForm);
    await flushPromises();

    const boxes = wrapper.findAll('input[type="checkbox"]');
    expect(boxes.map(box => (box.element as HTMLInputElement).disabled)).toEqual([false, false, true]);
    expect(wrapper.text()).toContain('Off in the configuration');
  });

  test('goes back to the configuration', async () => {
    const fetch = vi.fn((_url: string, init?: RequestInit) => jsonResponse(200, init?.method === 'PUT' ? answer() : answer({ theme: 'neon' })));
    vi.stubGlobal('fetch', fetch);
    const wrapper = mount(LiveSettingsForm);
    await flushPromises();

    await wrapper.find('button.secondary').trigger('click');
    await flushPromises();
    const put = fetch.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(put?.[1]?.body).toBe('{}');
    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('default');
  });

  test('shows why it cannot save, and an error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(200, { ...answer(), editable: false })));
    const readOnly = mount(LiveSettingsForm);
    await flushPromises();
    expect(readOnly.text()).toContain('requires Redis');

    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(503, { message: 'These settings are not available' })));
    const failing = mount(LiveSettingsForm);
    await flushPromises();
    expect(failing.find('[role="alert"]').text()).toContain('not available');

    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(401, {})));
    const expired = mount(LiveSettingsForm);
    await flushPromises();
    expect(expired.emitted('logout')).toHaveLength(1);
  });
});
