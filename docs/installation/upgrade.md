# Upgrade

Read the [release notes](https://github.com/ltoinel/amw/releases) first: breaking
changes are flagged there (Conventional Commits `!` / `BREAKING CHANGE`).

## Upgrading to 5.9

- **Admin secret of 32 characters at least**: the server refuses to start when `AMW_ADMIN_SECRET`
  is set and shorter (`openssl rand -base64 32` gives 44). Leaving it unset still works.
- **A new password ends the sessions**: the admin tokens are now signed with the secret and the
  password together, so changing `AMW_ADMIN_PASSWORD` logs every admin out. The upgrade itself
  does it once. See [Sessions](../user-guide/admin-portal.md#sessions).

## Upgrading to 5.8

- **MCP for AI agents**: an agent can read the figures and run A/B tests through
  `<path>/admin/mcp`, off by default. It needs `Admin.mcp: true` (`AMW_ADMIN_MCP`) and an
  `AMW_MCP_TOKEN` of 32 characters at least: the server refuses to start with one and not the
  other. See [MCP for AI agents](../user-guide/mcp.md).
- **Best deals once a day**: each search reads Amazon once every 24 hours instead of every 3 hours
  (up to 3 calls a day per search). A discount that starts during the day appears at the next
  search. The last list is kept 48 hours in Redis, for the days a search fails. Flash sales still
  running come first, and a product whose discount fell below the smallest discount of its search
  gives its card to the next one.
- **Impressions**: the portal and the docs say *impressions* instead of *views*. The API fields
  (`views`), the Redis keys and the `/view` beacon do not change; the live setting *View reports per IP
  and minute* is now *Impression reports per IP and minute*.
- **A/B tests**: a confidence interval and the time to a verdict, the click-through rate per day
  and variant, a planned duration (1 to 90 days) after which the test serves the control group,
  and a history of the tests that ended, with a one-click winner.
- **Affiliate disclosure once per page**: `data-disclosure-once` (or
  `setApiConfig({ disclosureOnce: true })`) shows it under the first card displayed only. Off by
  default; `off`, `false`, `0` and `no` turn it off.
- **Card templates**: `data-template` on the script, or `data-amw-template` on a card, picks
  `default` or `compact`. The default card does not change.
- **Shine effect**: a streak sweeps once across the buy button.
- **Dashboard**: the top 5 pages by clicks beside the daily click-through rate chart; the custom
  products show their price and discount.
- **Anthropic SDK 1.x**: nothing to change in the configuration.

## Upgrading to 5.7

- **Stuffing sources as shares**: Stuffing no longer picks one source. Each source (AI
  recommendations, best products of the site, custom list, best deals) has a slider, 0 turning
  it off and 100 % making it the only one, and the shares must make 100 %. A site saved with one
  source shows it at 100 %: nothing changes for visitors.
- **Visits**: the overview counts the visits of the pages where a card was seen, once per page
  and browser tab session, like the impressions. Days before the upgrade have none, so the tile
  appears once the new `widget.js` reaches the pages (within an hour).
- **Banners of your own**: the custom list can show banners outside Amazon (link, image, id), without
  the Amazon marks. A cached `widget.js` older than this version shows them as unavailable
  products until it is refreshed (within an hour).
- **Best deals view**: several deals searches (keywords, category, smallest discount, most
  products), each with a preview of what Amazon returns. A search saved in the Stuffing view by
  5.6 becomes the first one.
- **Design view**: the A/B tests view becomes **Design**, with one preview of the card on top and
  the theme, effect and button label in blocks that unfold one at a time. **While an A/B test runs
  on a site, its theme, effect and button label are locked**: the API answers `409` to a change of
  another kind until the test stops. A timer shows how long the test has been running.
- **AI per site**: each site of the Sites view has an *AI recommendations* switch, on by default.
- **Renamed views**: *Keywords* is now **AI Recommendation**; the `#/keywords` and `#/abtests`
  addresses keep working.
- **To replace** follows the period: it lists the products still requested during the period.
- **Outdoor theme** refined: the product sits inside the stitching, on a twill cloth.
- A [portal user manual](../user-guide/admin-manual.md) walks through the portal task by task.
- **Custom products page**: the product list leaves the Stuffing view for its own **Custom
  products** view (`#/custom`), and can be changed whatever the Stuffing source.

## Upgrading to 5.6

- **Products cached 24 hours**: `Redis.expire` now defaults to `86400` seconds, the longest Amazon
  allows, instead of `3600` (`43200` in the Docker configuration): one Amazon call a day per
  product shown. A file or environment variable that sets `Redis.expire` keeps its value; set
  `3600` to follow Amazon prices more closely.
- **Button label**: the card button now reads *See the offer on Amazon* (*Check the price on
  Amazon* without a price), in the 7 languages. The A/B tests view can choose another label for a
  site, or compare them.
- **Active site without a picker**: the portal opens on the last site used, or the first of the
  list; the switcher of the title bar changes it and its gear manages the sites. The Amazon quota
  estimate gets its own **Amazon quota** view, and the Claude API spending an **AI cost** view.
  The AI insights cover the active site.
- **Settings per site**: Stuffing, the effect, the theme and the button label can differ from
  one site to another. Each site keeps the current settings until you save its own in the portal,
  so visitors see no change after the upgrade. The A/B tests are measured per site from this
  version on, and one runs at a time on a site.
- **A/B tests view reworked**: each of the theme, effect and button label has a preview, *Apply*,
  *Start the test*, and *Keep* on the results to end a test with the chosen value. The *Save*
  buttons are gone. The preview page (`<Server.path>/admin/preview`) is served with the portal, so
  a reverse proxy that filters the admin paths must let it through.
- **Best deals Stuffing source**: the discounted products of an Amazon search (keywords, category,
  smallest discount), the larger discounts more often. It uses one Amazon search every 3 hours per
  site.
- **Fewer Amazon calls**: the `/product` lookups of a page arriving together share one `GetItems`
  call (10 products at most).
- **New themes**: `denim`, `leather`, `canvas`, `alpine`, and the seasonal `christmas`,
  `halloween` and `blackfriday`.
- **Periods**: the portal adds *1 day* and a *Custom* period; the statistics API accepts `from=` and
  `to=` in place of `days=`.

## Upgrading to 5.5

- **Live settings**: the theme, the HTTP cache, the rate limits and the AI features can be changed
  in the Settings view of the portal, and override the configuration file while the server runs.
  See [Live settings](../user-guide/admin-portal.md#live-settings).
- **Sites page**: the sites and their tracking IDs move from the Settings view to a **Sites**
  page, with a description and a URL each. It starts from `Server.allowedSites` and the tracking
  IDs already set; once saved, it replaces `Server.allowedSites`, without a restart. See
  [Sites](../user-guide/admin-portal.md#sites). The `/api/partner-tags` endpoints of the portal are
  replaced by `/api/sites`.
- **Amazon quota chart**: the quota estimate of the overview gets a chart of the daily share of the
  quota used. AMW now counts every request it sends to Amazon; the days before are estimated.
- **AI view**: the Insights view becomes **AI** and holds the estimated cost of the Claude API
  calls, which leaves the overview. The `#/insights` address still opens it.
- **Stuffing page**: Stuffing moves from the Settings view to its own page, with an on/off switch
  and a product list that shows each product. A configuration with `Stuffing.count` above 0, and
  the values already saved in the portal, stay on. A new source of products,
  `Stuffing.mode: popular`, shows the most clicked products of the page's site without calling
  Claude.
- **Active site**: after signing in, the portal asks for the site to work on, and every view but
  the **Server settings** (formerly *Settings*) shows this site only; the switcher of the title bar
  changes it, and its gear opens the Sites view. The Amazon quota estimate moves to the Server
  settings, as the quota is shared by every site. The figures of each site of the Sites page are
  counted from this version on: earlier days show nothing. The AI, A/B tests and Stuffing views
  still cover every site in this version, and say so.
- **Recommendations read `<title>` and the meta description first**, before the Open Graph tags.
  Only pages analysed from now on are concerned: the search terms already stored are kept.
- **Broader search terms**: when Amazon finds nothing for the recommended search terms, AMW tries
  one or two broader terms that Claude gives in the same call, before the most clicked product.
  Pages analysed before this version have none.
- **Portal settings in a file** (optional): set `Admin.settingsFile` (`AMW_ADMIN_SETTINGS_FILE`)
  to keep the settings changed in the portal out of Redis, see
  [Where the portal keeps its settings](../user-guide/admin-portal.md#settings-file). The values
  already in Redis keep applying until you save them again. The repository's Compose stack and
  the [Compose guide](docker-compose.md) now do it, with an `amw-data` volume on `/app/data`.

## Upgrading to 5.4

- **One list of sites**: `Recommendation.allowedHosts` is deprecated, `Server.allowedSites` now also
  lists the sites that may get recommendations. Older files keep working: when
  `Server.allowedSites` is empty, the old list still serves the recommendations alone, and the
  server logs a warning. Move the hosts to `Server.allowedSites` (or `SERVER_ALLOWED_SITES`), which
  also hides the widget on other sites, then remove `Recommendation.allowedHosts`.
- **Admin sessions last 10 days**: `Admin.tokenTtl` now defaults to 864000 seconds, and the
  portal keeps its token after the browser is closed. Set `AMW_ADMIN_SECRET` so that
  restarts do not log admins out, and keep a shorter `Admin.tokenTtl` on a shared computer.
  A configuration file that sets `tokenTtl: 3600` keeps the old one-hour sessions. See
  [Sessions](../user-guide/admin-portal.md#sessions).
- **Stuffing counts the cards already in the article**: `Stuffing.count` is now a maximum per
  article, the cards you placed in the article container included. An article that already
  holds cards gets fewer stuffed ones than before. See [Stuffing](../user-guide/integration.md#stuffing).
- **Cards look slightly different**: the image has a fixed size (160 px, 88 px on small screens)
  and is shown whole, the title takes up to two lines, and the card reserves its height and stays
  invisible until its product arrives. A site stylesheet that sized `.amw-widget-img-container`
  in percent should be checked.
- **Effects moved to the A/B tests view** of the portal, with the comparison that was on the
  overview. A stored `compare` mode keeps comparing all the effects.
- **Nothing changes by default** for the new options: `Admin.allowedIps` and
  `Stuffing.wordsPerCard` are off, and the tracking IDs per site and the theme test are empty.

## Upgrading to 5.3

- **Impressions are now unique per tab session**: the widget reports a product once per page and
  browser tab session, so reloads no longer count. Expect lower impression counts and higher
  click-through rates than before; past days keep their figures. See
  [Impressions, clicks and pages](../user-guide/admin-portal.md#impressions-clicks-and-pages).
- **Themes are separate files**: `widget.js` also loads `themes/<theme>.css` for a theme other
  than `default`. If a proxy or a CDN rule lists the paths of AMW one by one, add `/themes/`.
- **Quiet console**: routine messages of the widget now need `data-debug` on the script tag, see
  [Debugging](../user-guide/integration.md#debugging).
- **Nothing changes by default** for the new options: `Server.allowedSites` is empty and
  `Stuffing.count` is 0. See
  [Restricting the widget to your sites](../user-guide/security.md#allowed-sites) and
  [Stuffing](../user-guide/integration.md#stuffing).

## Upgrading to 5.2

5.2 has no breaking change, but several behaviours are worth checking:

- **Impressions are now reported by the widget** (`POST /view`), so they no longer depend on what
  HTTP caches serve. Expect higher impression counts and lower click-through rates than before: the
  old figures missed everything served from a cache. Past days keep their figures.
- **Widgets pinned to a hashed URL** (`widget.<hash>.js`) keep working but report no impressions until
  you update the URL. `widget.js` updates by itself once its cache expires.
- **Direct API calls** to `/product` no longer count as impressions, see
  [`POST /view`](../user-guide/api.md#post-view).
- **More product requests on a cold page**: the widget uses `/product` rather than batches of
  `/products`, which a CDN rarely reuses. Without a CDN, consider raising `Server.rateLimit` if
  your pages show many products.
- **A `.amw` element without an `id`** used to be ignored with a console warning. It now asks
  for a recommendation, and hides itself while the feature is off.
- **The Redis eviction policy** of the repository's `redis.conf` moves from `allkeys-lru` to
  `volatile-lru`, so that recommendations are not evicted.

New and optional: [widget themes](../user-guide/widget.md#themes), [automatic products](../user-guide/widget.md#auto)
(off by default, billed by the Claude API) and `Server.viewRateLimit`.

## Upgrading to 5.0

5.0 has two breaking changes and two behaviour changes worth checking:

- **Redis password (breaking, repository Compose stack only)**: `./start.sh docker`
  refuses to start Redis without `REDIS_PASSWORD` in `.env`. Add one before upgrading:
  `echo "REDIS_PASSWORD=$(openssl rand -hex 24)" >> .env`. The published image and
  your own Compose files are not affected.
- **Widget language (breaking)**: a page whose `<html lang>` is missing or not
  supported no longer falls back to French but to the visitor's browser language, then
  English. Regional codes (`fr-FR`, `en-US`…) are now recognised. To keep French
  everywhere, set `lang="fr"` on the page or `data-lang="fr"` on the widgets, see
  [Languages](../user-guide/widget.md#languages).
- **Port published on 127.0.0.1**: the repository Compose stack now publishes 9080 on
  the loopback interface only, because the Docker configuration trusts one proxy hop
  (`Server.trustProxy: 1`). If another host reached AMW on port 9080 directly, put a
  reverse proxy in front of it, or publish the port yourself and set
  `SERVER_TRUST_PROXY=false`, see [Reverse proxy](reverse-proxy.md).
- **Unknown products render nothing**: a widget whose product Amazon does not know
  hides itself instead of showing an error. The admin portal lists these products under
  **Products to replace**.

New and optional: the [administration portal](../user-guide/admin-portal.md) gains a
side navigation, a best performing pages view and AI insights (`Admin.insights`, off by
default).

## Docker

```bash
docker pull ltoinel/amw:latest          # or the new X.Y.Z tag you pin
docker stop amw && docker rm amw
docker run -d --name amw -p 127.0.0.1:9080:9080 --env-file .env --restart unless-stopped ltoinel/amw:latest
```

## Docker Compose

=== "Published image"

    ```bash
    docker compose pull
    docker compose up -d
    ```

=== "From a clone"

    ```bash
    git pull                       # or git checkout vX.Y.Z
    ./start.sh docker              # rebuilds the image and restarts the stack
    ```

The Redis volume is kept, so the product cache survives the upgrade.

!!! warning "The repository stack requires `REDIS_PASSWORD`"
    Since the Redis password was introduced, `docker/docker-compose.yml` (the
    `./start.sh docker` stack) refuses to start Redis without `REDIS_PASSWORD` in `.env`:
    add one (`echo "REDIS_PASSWORD=$(openssl rand -hex 24)" >> .env`) before upgrading.
    The cached products are kept: the password only protects new connections.

## npm package

```bash
npm install amazon-modern-widgets@latest
pm2 restart amw                    # or your process manager
```

Compare your `config/production.yml` with the new
`node_modules/amazon-modern-widgets/config/sample.yml` and copy
`config/custom-environment-variables.yml` again: new settings may have been added.

## From source

```bash
git pull                           # or git checkout vX.Y.Z
./start.sh                         # reinstalls dependencies if needed, rebuilds, starts
```

## After upgrading

- [Verify the installation](verify.md): `/item/health` reports the new `version`.
- Browsers and proxies may keep the previous `widget.js` for up to `Server.httpCache`
  seconds; purge your CDN or NGINX cache if you need the new widget immediately.
