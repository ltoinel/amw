import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import LoginView from '../src/components/LoginView.vue';
import DashboardView from '../src/components/DashboardView.vue';
import TopProducts from '../src/components/TopProducts.vue';
import NotFoundTable from '../src/components/NotFoundTable.vue';
import TopPages from '../src/components/TopPages.vue';
import { getToken, safeUrl } from '../src/api';

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

beforeEach(() => {
  sessionStorage.clear();
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

    const wrapper = mount(DashboardView, { global: { stubs: { DailyChart: true } } });
    await flushPromises();

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.some(url => url.includes('/api/stats/pages?days=30&limit=20'))).toBe(true);
    expect(wrapper.text()).toContain('Best performing pages');
    expect(wrapper.find('td.page a').attributes('href')).toBe('https://blog.example/post');

    await wrapper.findAll('.periods button')[0].trigger('click');
    await flushPromises();
    expect(fetchMock.mock.calls.map(([url]) => String(url)).some(url => url.includes('/api/stats/pages?days=7'))).toBe(true);
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
          product: 'id:B00GONE001', type: 'id', value: 'B00GONE001', count: 4, lastSeen: null,
          referers: [{ url: 'https://blog.example/post', count: 3 }]
        }]
      }
    });
    expect(wrapper.text()).toContain('B00GONE001');
    expect(wrapper.find('a').attributes('href')).toBe('https://blog.example/post');
    expect(wrapper.find('a').attributes('rel')).toBe('noopener noreferrer');
  });

  test('TopPages shows views, clicks and CTR with a safe link', () => {
    const wrapper = mount(TopPages, {
      props: { pages: [{ url: 'https://blog.example/post', impressions: 1200, clicks: 30, ctr: 0.025 }] }
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
      props: { pages: [{ url: 'javascript:alert(1)', impressions: 1, clicks: 1, ctr: 1 }] }
    });
    expect(wrapper.find('a').exists()).toBe(false);
    expect(wrapper.find('td.page').text()).toBe('javascript:alert(1)');
  });

  test('TopPages has an empty state', () => {
    const wrapper = mount(TopPages, { props: { pages: [] } });
    expect(wrapper.text()).toContain('No page reported over this period.');
  });

  test('safeUrl only accepts http(s)', () => {
    expect(safeUrl('https://a.example/x')).toBe('https://a.example/x');
    expect(safeUrl('data:image/png;base64,AAAA')).toBeUndefined();
    expect(safeUrl('not a url')).toBeUndefined();
  });
});
