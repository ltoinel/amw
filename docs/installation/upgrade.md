# Upgrade

Read the [release notes](https://github.com/ltoinel/amw/releases) first: breaking
changes are flagged there (Conventional Commits `!` / `BREAKING CHANGE`).

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
  the values already saved in the portal, stay on.
- **Site selector**: the title bar of the portal filters the overview, products, pages and
  products to replace by site. The figures of each site of the Sites page are counted from this
  version on: earlier days show nothing for a single site.
- **Recommendations read `<title>` and the meta description first**, before the Open Graph tags.
  Only pages analysed from now on are concerned: the search terms already stored are kept.
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

- **Views are now unique per tab session**: the widget reports a product once per page and
  browser tab session, so reloads no longer count. Expect lower view counts and higher
  click-through rates than before; past days keep their figures. See
  [Views, clicks and pages](../user-guide/admin-portal.md#views-clicks-and-pages).
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

- **Views are now reported by the widget** (`POST /view`), so they no longer depend on what
  HTTP caches serve. Expect higher view counts and lower click-through rates than before: the
  old figures missed everything served from a cache. Past days keep their figures.
- **Widgets pinned to a hashed URL** (`widget.<hash>.js`) keep working but report no views until
  you update the URL. `widget.js` updates by itself once its cache expires.
- **Direct API calls** to `/product` no longer count as views, see
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
