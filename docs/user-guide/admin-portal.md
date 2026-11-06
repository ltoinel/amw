# Administration portal

AMW ships a small web portal, served at `<Server.path>/admin/` (`/amw/admin/` by
default), that shows how the widgets are used: hits, clicks, the most displayed
products, the best performing pages, the products to replace, AI-generated
insights and the settings in use.

## Enabling it

| Setting | Environment variable | Default | Description |
|---|---|---|---|
| `Admin.enabled` | `AMW_ADMIN_ENABLED` | `false` | Serves the portal and its API. |
| — | `AMW_ADMIN_PASSWORD` | — | Required, at least 12 characters: the server refuses to start without it. |
| — | `AMW_ADMIN_SECRET` | random | Token signing key. When unset, admins are logged out on every restart. |
| `Admin.tokenTtl` | `AMW_ADMIN_TOKEN_TTL` | `3600` | Session lifetime, in seconds. |
| `Admin.loginRateLimit` | `AMW_ADMIN_LOGIN_RATE_LIMIT` | `10` | Failed logins allowed per IP every 15 minutes. |
| `Admin.insights` | `AMW_ADMIN_INSIGHTS` | `false` | AI insights written by Claude (see [Privacy](#privacy)). Also needs `ANTHROPIC_API_KEY`. |
| — | `ANTHROPIC_API_KEY` | — | Claude API key, environment only, used by the insights. |

Statistics are stored in Redis (`Redis.enabled: true`): without Redis the portal only
shows the settings and says that statistics are unavailable. Daily counters are kept 90 days.

## Dashboard

The portal is laid out like a code editor: an **activity bar** on the left (at the
bottom of the screen on phones) switches between views, and a **title bar** shows the
current view, the period selector (7, 30 or 90 days) and a refresh button. The period
applies to every view except the products to replace, which are a running list, and
the settings.

| View | Address | Content |
|---|---|---|
| **Overview** | `#/overview` | Key figures (product requests, share served from the Redis cache, products not found, clicks, overall click-through rate), the hits per day / clicks per day charts, and the click-through rate per site: daily CTR of the 5 most viewed sites (blank on days without views) with a table of every site. |
| **Products** | `#/products` | Most displayed products: impressions, clicks and click-through rate per product. |
| **Pages** | `#/pages` | Best performing pages: the pages embedding the widget (top 20) with their views, clicks and click-through rate. Click a column header to rank them by views, clicks or CTR, and use the **Site** filter to show the pages of a single domain. |
| **To replace** | `#/notfound` | Products Amazon no longer returns, with how long they have been missing (hours, then days after 48 h), a link to their Amazon page (product page for an ASIN, search for a keyword) and the pages where they are still embedded. |
| **Insights** | `#/insights` | AI-generated summary and recommendations, see [Insights (AI)](#insights). |
| **Settings** | `#/settings` | Settings in use since the server started, available without Redis. Read-only: change the configuration file or the environment variables, then restart. Secrets are never displayed, only whether they are configured. |

The selected view is kept in the address (`/amw/admin/#/pages`), so reloading the page,
bookmarking a view and the browser back button all work.

- **Keyboard**: <kbd>Tab</kbd> reaches the activity bar, the arrow keys (and
  <kbd>Home</kbd> / <kbd>End</kbd>) move between views, <kbd>Enter</kbd> or
  <kbd>Space</kbd> opens the focused one.
- **Theme**: light or dark, following the system preference by default. The sun / moon
  button at the bottom of the activity bar switches it; the choice is remembered in the
  browser. The sign out button sits below it.

### Views, clicks and pages

- A **view** (impression) is one card displayed by the widget, reported with the
  `/view` beacon whatever cache the product came from (browser, CDN, the widget's own
  5-minute cache). A page showing three products counts three views per display, and
  lazy loaded cards only count once they load. Products not found are not views. Direct
  API calls to `/product`, and visitors whose browser blocks the beacon, are not counted.
- **Product requests** are the lookups that reached AMW (`Cache`, `Amazon` and `Not
  found` in the chart). They fall when a CDN serves the products: this measures the load
  on the server and the Amazon quota, not the audience.
- A **click** is one `/click` beacon, sent by the widget when its affiliate link is
  followed.
- A **product** is an ASIN. Keywords only appear for the days recorded before views
  were reported by the widget.
- A **product to replace** is one Amazon reported as missing. It leaves the list as soon
  as Amazon returns it again (back in the catalogue), with the pages recorded for it.
- **Days are UTC**: the counters roll over at midnight UTC, so evening traffic in
  Europe or America may be counted on the next day.
- The **page** is the `Referer` header of the product request or of the click beacon,
  reduced to its origin and path: the query string and the fragment are dropped, as
  they may carry personal or session data. Requests without a usable `Referer` count in
  the global figures but in no page.

!!! note "Browsers often send only the site, not the page"
    Under the default `strict-origin-when-cross-origin` referrer policy, browsers only
    send the origin (`https://blog.example/`) on cross-origin requests, so pages of a
    same site are grouped together when AMW runs on another domain. The recommended
    setup, AMW proxied under the same origin as your site (see
    [Reverse proxy](../installation/reverse-proxy.md)), gets the full page path;
    otherwise set a less strict `Referrer-Policy` on your site, such as
    `no-referrer-when-downgrade`.

The `Referer` is sent by the client and can be forged: every set is bounded (1,000
pages and 1,000 products per day, 500 products to replace, 20 pages per missing
product) and the portal only renders `http(s)` URLs as links, opened with
`rel="noopener noreferrer"`.

!!! warning "Statistics share Redis with the product cache"
    They are stored in the same Redis as the cached products. The repository's Redis
    configuration evicts any key when it reaches `maxmemory` (`allkeys-lru`, 256 MB),
    so under memory pressure old statistics can disappear along with cached products.
    Give Redis enough memory for both, or point AMW to a Redis whose eviction policy
    fits your retention needs.

## Insights (AI) {#insights}

The **Insights** view is the only place where the portal uses AI: it sends the
statistics of the selected period to Claude (Claude Opus 5.5, through the Anthropic API)
and shows what Claude makes of them:

- a **summary** of the period in 3 to 6 sentences;
- at most 6 **recommendations**, each naming the pages or products concerned, for
  example a page that gets many views but few clicks, a product Amazon no longer knows
  to replace on a given page, or a traffic trend.

Claude only sees the figures the portal already shows (see [AI insights](#ai-insights)
for the exact list): no IP address, user agent or cookie, which AMW never stores anyway.

!!! note "Enabling it"
    The feature is disabled by default. Set `Admin.insights: true` (or
    `AMW_ADMIN_INSIGHTS=true`) and put your Claude API key in `ANTHROPIC_API_KEY`
    (for Docker, in `.env`), then restart AMW. Each analysis is billed to your
    Anthropic account, a few thousand tokens per call.

- Opening the view never calls Claude: it shows the last analysis of the selected
  period, whatever its age, with when it was generated and by which model. A period
  never analysed shows a **Generate** button.
- **Generate** / **Regenerate** asks Claude for a new analysis of the period. It takes
  10 to 60 seconds: a progress indicator shows meanwhile. Clicks within a minute of the
  previous analysis return it instead of making a new call.
- The last analysis of each period is stored in Redis (kept 90 days, like the
  statistics), so it survives a restart.
- When the feature is disabled the view says why and how to enable it.
- The content is labelled **AI-generated**: it can be wrong, check it before acting on
  it. It is derived from client-controlled data (page URLs), so the portal renders it
  as plain text only, never as HTML or Markdown.

## API

The portal reads JSON endpoints under `<Server.path>/admin/api`, all requiring the
bearer token returned by `POST /api/login` (`{"password": "..."}`):

| Endpoint | Description |
|---|---|
| `GET /api/status` | Whether statistics are available, the retention in days and the running `version` (`release`, plus `revision` and `buildDate` for the published Docker images), shown in the portal footer. |
| `GET /api/settings` | Settings in use, as a list of sections (`title`, `entries`). An entry has a `key` and a `value` (`null` when the default of the option applies); a secret has `secret: true` and `configured` instead, never its value. Local paths are left out. |
| `GET /api/stats/daily?days=` | Hits per source and clicks, one entry per day. |
| `GET /api/stats/products?days=&limit=` | Most displayed products. |
| `GET /api/stats/pages?days=&limit=&sort=&domain=` | Best performing pages: `url`, `impressions`, `clicks`, `ctr`. `sort` is `clicks` (default), `impressions` or `ctr`; `domain` keeps the pages of one hostname. Invalid values return `400`. |
| `GET /api/stats/domains?days=` | Sites embedding the widget, most viewed first: `domain`, `impressions`, `clicks`, `ctr`. |
| `GET /api/stats/domains/daily?days=&limit=` | Most viewed sites (`limit` 5 by default, 20 at most) with `daily`: `date`, `impressions`, `clicks`, `ctr` (`null` on days without views). |
| `GET /api/stats/notfound?limit=` | Products to replace, with their pages, `firstSeen` (start of the absence, cleared when Amazon returns the product again), `lastSeen` and `url` (Amazon page on the configured marketplace, without the partner tag). |
| `GET /api/insights?days=` | Last AI insights of the period (`summary`, `recommendations`, `generatedAt`, `model`, `cached`), never calls Claude; `{"available": true, "days", "missing": true}` when the period was never analysed, `{"available": false, "reason"}` when disabled. See [Insights (AI)](#insights). |
| `POST /api/insights?days=` | Generates new AI insights of the period (same shape); 502 when Claude cannot answer. |

`days` defaults to 30 (at most 90) and `limit` to 50 (at most 500).

## Privacy

Only aggregated counters are stored, with the URL of the pages embedding the widget
(without query string). No IP address, user agent or cookie is ever stored.

### AI insights

With `Admin.insights: true` and `ANTHROPIC_API_KEY` set, the portal can ask Claude
(Claude Opus 5.5, through the Anthropic API) to analyse a period and suggest what to do:
pages that get views but few clicks, products to replace, trends.

- **What is sent**: the figures the portal shows for the period (daily counters, the 20
  most displayed products with their title, the 20 best performing pages, the 20
  products to replace with up to 5 pages each). Page URLs are already stripped of their
  query string; no IP address, user agent or cookie exists to be sent.
- **Cost**: each analysis is one Claude API call, billed to your Anthropic account (a few
  thousand tokens). An analysis is only made when an admin asks for it (never when the
  view opens), the last one of each period is kept in Redis, and a regeneration within a
  minute of the previous one returns the same report.
- **Trust**: the answer is model output, shown as plain text and labelled as such. Page
  URLs and product titles come from browsers and from Amazon: Claude is told to treat
  them as data, but a forged `Referer` can still end up quoted in the analysis.
- If Claude declines a request, it is retried on the fallback model Anthropic
  recommends; the report shows which model answered.
