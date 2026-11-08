# Configuration

AMW is configured with [node-config](https://github.com/node-config/node-config): YAML
files located in the `config/` directory of the **current working directory**, plus
[environment variables](#environment-variables) for credentials and the most common
settings.

## Which file is loaded?

`NODE_ENV` selects the file; AMW sets it to `production` when it is not defined.

| `NODE_ENV` | File | Typical use |
|---|---|---|
| `production` (default) | `config/production.yml` | npm / Node.js installs; create it from `config/sample.yml` |
| `docker` | `config/docker.yml` | set by the Docker image |
| `development` | `config/development.yml` | `npm run dev`, the dev container (`./start.sh dev`) |

On top of that file, node-config merges, in this order, `local.yml` and
`local-<NODE_ENV>.yml` if they exist, then the
[environment variables](#environment-variables) mapped by
`config/custom-environment-variables.yml`, and finally the `NODE_CONFIG` environment
variable. Later sources override earlier ones key by key.

!!! danger "Never commit credentials"
    `config/sample.yml`, `config/docker.yml` and `config/development.yml` are committed
    and must only contain placeholders or empty values. Put credentials in environment
    variables (a `.env` file created from `.env.example`, which is never committed) or
    in `config/production.yml`, which is excluded from the repository, the npm package
    and the Docker image.

## Reference

### Amazon

Credentials and defaults for the [Amazon Creators API](https://affiliate-program.amazon.com/creatorsapi).

| Key | Sample value | Description |
|---|---|---|
| `Amazon.credentialId` | `<YOUR CREDENTIAL ID>` | Creators API credential ID. |
| `Amazon.credentialSecret` | `<YOUR CREDENTIAL SECRET>` | Creators API credential secret. |
| `Amazon.version` | `3.2` | Version of your Creators API credential, as shown in the Creators API dashboard. |
| `Amazon.partnerTag` | `<YOUR PARTNER TAG>` | Your Associates tracking ID; it is embedded in every product URL returned by Amazon. |
| `Amazon.marketplace` | `www.amazon.fr` | Marketplace to query, e.g. `www.amazon.com`, `www.amazon.de`. |
| `Amazon.condition` | `New` | Offer condition filter: `New` or `Any`. |
| `Amazon.breakerThreshold` | `5` | Consecutive Amazon failures (errors, timeouts, throttling) after which AMW stops calling Amazon for `breakerCooldown` seconds (circuit breaker). `0` disables it. Defaults to `5` when absent. |
| `Amazon.breakerCooldown` | `60` | Seconds the circuit stays open; then a single trial call decides whether Amazon is back. Defaults to `60` when absent. |

### Server

| Key | `sample.yml` | `docker.yml` | Description |
|---|---|---|---|
| `Server.port` | `8080` | `9080` | HTTP port (1-65535). Falls back to `8080` if empty or `0`. |
| `Server.debug` | `true` | `false` | `true` switches AMW loggers to debug level (full Amazon responses are logged) and exposes error messages in unexpected HTTP 500 responses. Use `false` in production. |
| `Server.path` | `/amw` | `/item` | Base path of every endpoint. Must start with `/`; defaults to `/amw` if empty. The widget expects `/item`, see [API location](../user-guide/integration.md#api-location). |
| `Server.cors` | `false` | `false` | `true` adds `Access-Control-Allow-Origin: *` to every response. Only needed if pages on other origins call the API directly. |
| `Server.projectDir` | `<PATH>` | `/app/` | **Required.** Absolute path of the directory that contains `dist/widgets/widget.js` (repository clone, installed npm package, or `/app/` in Docker). The path must not contain hidden (dot) directories: the file is then refused and `/widget.js` answers 500. |
| `Server.httpCache` | `3600` | `604800` | `max-age` in seconds of the `Cache-Control: public, max-age=…` header sent with found products and `widget.js` (every other response is `no-store`). For products it is lowered so that a browser or CDN never keeps a product past 24 hours after the Amazon call. Falls back to `300` if empty or `0`; must not be negative. |
| `Server.rateLimit` | `120` | `120` | Maximum `/product` requests per client IP per one-minute window; beyond it AMW answers HTTP 429. Defaults to `120` when the key is absent. Counters are kept in memory, per AMW process. |
| `Server.theme` | `default` | `default` | Design of the cards: `default`, `native`, `shelf`, `receipt`, `blueprint`, `outdoor`, `terminal`, `magazine`, `pastel` or `neon`, see [Themes](../user-guide/widget.md#themes). A page can choose another with `data-theme`. An unknown name stops the server at startup. |
| `Server.allowedSites` | `[]` | `[]` | Lowercase hosts (with the port if not the default) of your sites: the only ones that may use the widget, and whose pages AMW may download for [recommendations](#recommendation) (list `example.com` and `www.example.com` if you use both). Empty allows every site, without recommendations. See [Restricting the widget to your sites](../user-guide/security.md#allowed-sites). An invalid value stops the server at startup. |
| `Server.clickRateLimit` | `60` | `60` | Maximum `/click` beacons (sent by the widget when a reader clicks a card) per client IP per minute. Defaults to `60` when absent. |
| `Server.viewRateLimit` | `120` | `120` | Maximum `/view` beacons (sent by the widget when cards are displayed, up to 10 per beacon) per client IP per minute. Defaults to `120` when absent. |
| `Server.swagger` | `false` | `false` | `true` serves an interactive [Swagger UI](../user-guide/api.md#swagger-ui) at `<path>/docs/` and the OpenAPI document at `<path>/openapi.json`. Off by default (and when absent) to keep the public surface minimal. |
| `Server.metrics` | `false` | `false` | `true` exposes [Prometheus metrics](../user-guide/api.md#get-metrics) at `<path>/metrics`. Off by default (and when absent): the endpoint has no authentication, expose it to your monitoring network only. |
| `Server.trustProxy` | `false` | `1` | Express [`trust proxy`](https://expressjs.com/en/guide/behind-proxies.html) setting, which decides how the client IP is derived from `X-Forwarded-For`: `false` (use the socket address), a number of proxy hops (e.g. `1` behind a single NGINX), or a list of trusted addresses/subnets such as `loopback, 10.0.0.0/8`. Avoid `true`: it trusts any `X-Forwarded-For` value. Any trusted hop must be the only way to reach AMW, otherwise clients can forge their IP and bypass every rate limit: the Docker default `1` assumes the port is only reachable by the local reverse proxy (published on `127.0.0.1`). Defaults to `false` when absent. Can be set with `SERVER_TRUST_PROXY`. |

### Redis

| Key | `sample.yml` | `docker.yml` | Description |
|---|---|---|---|
| `Redis.enabled` | `false` | `false` | Must be the boolean `true` to enable the cache; any other value disables it. |
| `Redis.host` | `localhost` | `localhost` | Redis host. |
| `Redis.port` | `6379` | `6379` | Redis port. |
| `Redis.username` | empty | empty | Redis ACL user name (optional). |
| `Redis.password` | empty | empty | Redis password (optional). |
| `Redis.expire` | `3600` | `43200` | Freshness of cached products, in seconds: within it, AMW answers from the cache without calling Amazon. Must be positive; defaults to `3600` if empty or `0`. Values above `86400` are capped at `86400` with a startup warning, see [Amazon price freshness](../user-guide/caching.md#amazon-price-freshness). |
| `Redis.staleExpire` | `86400` | `43200` | Extra seconds a product is kept after `Redis.expire`, so that it can still be served when Amazon fails or the circuit breaker is open. A product is never served more than 24 hours after the Amazon call, whatever this value. `0` disables it. Defaults to `86400` when absent. |
| `Redis.notFoundExpire` | `3600` | `3600` | Seconds a product Amazon does not know is remembered, so that a missing ASIN does not cost an Amazon call on every view. Kept in Redis, or in memory (1,000 entries at most) when Redis is disabled. `0` disables it. Defaults to `3600` when absent. |

When Redis is enabled, AMW connects at startup and **exits if Redis is unreachable**.
If Redis becomes unavailable later, requests still succeed by calling Amazon directly,
and `/health` reports `"redis": "disconnected"`. The Docker Compose stacks enable Redis
with `REDIS_ENABLED=true` and `REDIS_HOST=redis`.

### Stuffing

Cards added to articles by `widget.js`, see [Stuffing: adding cards automatically](../user-guide/integration.md#stuffing).
These are the defaults: the administration portal can change them, with Redis.

| Key | `sample.yml` | Environment variable | Description |
|---|---|---|---|
| `Stuffing.count` | `0` | `AMW_STUFFING_COUNT` | Cards per article, from 0 to 5. Above 0 in `recommendation` mode it needs `Recommendation.enabled`, or the server refuses to start. |
| `Stuffing.mode` | `recommendation` | `AMW_STUFFING_MODE` | `recommendation`: the products chosen for the page content. `manual`: the products listed in the portal, in order, without calling the AI model. |
| `Stuffing.containerId` | `main-content` | `AMW_STUFFING_CONTAINER_ID` | The id of the element holding the article. |

### Effect

How the cards appear, see [Appearance effects](../user-guide/widget.md#effects). This is the default:
the administration portal can change it, with Redis.

| Key | `sample.yml` | Environment variable | Description |
|---|---|---|---|
| `Effect.mode` | `none` | `AMW_EFFECT_MODE` | `none`, `fade`, `slide`, `zoom`, `pulse` or `compare`. An invalid value stops the server at startup. |

### Admin

The [administration portal](../user-guide/admin-portal.md) is off by default. Its
password, signing secret and Claude API key are environment variables only, see
[Enabling it](../user-guide/admin-portal.md#enabling-it). Its **Settings** view shows
the values in use, read-only and without the secrets.

| Key | `sample.yml` | `docker.yml` | Description |
|---|---|---|---|
| `Admin.enabled` | `false` | `false` | Must be the boolean `true` to serve the portal at `<path>/admin/`; the server then refuses to start without `AMW_ADMIN_PASSWORD` (12 characters at least). Statistics need Redis. |
| `Admin.tokenTtl` | `3600` | `3600` | Session lifetime, in seconds. |
| `Admin.loginRateLimit` | `10` | `10` | Failed logins allowed per IP every 15 minutes. |
| `Admin.insights` | `false` | `false` | Must be the boolean `true` to enable the [AI insights](../user-guide/admin-portal.md#ai-insights), which send the aggregated statistics to the Claude API. Needs `ANTHROPIC_API_KEY`. |

## Recommendation { #recommendation }

[Automatic product widgets](../user-guide/widget.md#auto), those without an `id`. AMW
downloads each new page to read its title, then makes one billed call to the Claude API. The
server refuses to start if enabled without Redis or `Server.allowedSites`, and needs
`ANTHROPIC_API_KEY` in the environment.

| Key | Sample | Docker | Description |
|---|---|---|---|
| `Recommendation.enabled` | `false` | `false` | `true` lets widgets without an `id` work. When off they hide themselves. |
| `Recommendation.allowedHosts` | — | — | **Deprecated**, replaced by `Server.allowedSites`. Still read when `Server.allowedSites` is empty, for the recommendations only, with a warning at startup. |
| `Recommendation.dailyLimit` | `100` | `100` | Maximum billed calls per UTC day, and ten times more page downloads. Beyond it, new pages get no card until the next day; known pages keep working. |
| `Recommendation.fallback` | `true` | `true` | Pages without a product show the most clicked product of their site over the last 30 days. Clicks are ranked per site for the hosts of `Server.allowedSites` only, from the deployment of this version on. |

A new page must send its URL in the `Referer`, which the widget asks the browser to do. A
client can forge it, but only to designate a page of your sites. Claude spending is therefore
bounded by your number of pages, provided your site answers 404 to unknown URLs: on a site
answering 200 to any path, only `dailyLimit` limits it.

If a CDN or firewall protects your site, let AMW through: it downloads pages from your server
with the user agent `AmazonModernWidgets`. A blocked download gives no recommendation, and is
retried after an hour.

`/click` is public, so forged clicks can push a product to the top of a site's ranking, within
the per-IP limit of `Server.clickRateLimit`. It stays a real Amazon product with your partner
tag, but you did not choose it: set `fallback` to `false` if that matters on your site.

Recommendations are stored in Redis as `amw:recommendation:<md5>`, in JSON with the URL, the
title and the product. Edit the keywords in the [admin portal](../user-guide/admin-portal.md#keywords), or delete a key to have that page analysed again on its next visit. For
them to last, Redis needs persistence and an eviction policy sparing keys without a TTL
(`volatile-lru`, or none): the repository's `redis.conf` does both.

## Environment variables

`config/custom-environment-variables.yml` maps the following variables onto
configuration keys, whatever the `NODE_ENV`. Unset or empty variables are ignored and
the YAML value is kept. Variables marked *JSON* are parsed as JSON, so write `true`,
`false` or a number.

| Variable | Configuration key | Format |
|---|---|---|
| `AMAZON_CREDENTIAL_ID` | `Amazon.credentialId` | string |
| `AMAZON_CREDENTIAL_SECRET` | `Amazon.credentialSecret` | string |
| `AMAZON_CREDENTIAL_VERSION` | `Amazon.version` | string |
| `AMAZON_PARTNER_TAG` | `Amazon.partnerTag` | string |
| `AMAZON_MARKETPLACE` | `Amazon.marketplace` | string |
| `AMAZON_BREAKER_THRESHOLD` | `Amazon.breakerThreshold` | JSON |
| `AMAZON_BREAKER_COOLDOWN` | `Amazon.breakerCooldown` | JSON |
| `SERVER_PORT` | `Server.port` | JSON |
| `SERVER_DEBUG` | `Server.debug` | JSON |
| `SERVER_PATH` | `Server.path` | string |
| `SERVER_CORS` | `Server.cors` | JSON |
| `SERVER_PROJECT_DIR` | `Server.projectDir` | string |
| `SERVER_RATE_LIMIT` | `Server.rateLimit` | JSON |
| `SERVER_SWAGGER` | `Server.swagger` | JSON |
| `SERVER_METRICS` | `Server.metrics` | JSON |
| `SERVER_CLICK_RATE_LIMIT` | `Server.clickRateLimit` | JSON |
| `SERVER_THEME` | `Server.theme` | string |
| `SERVER_ALLOWED_SITES` | `Server.allowedSites` | JSON (`["www.example.com"]`) |
| `SERVER_VIEW_RATE_LIMIT` | `Server.viewRateLimit` | JSON |
| `AMW_RECOMMENDATION_ENABLED` | `Recommendation.enabled` | JSON |
| `AMW_RECOMMENDATION_ALLOWED_HOSTS` | `Recommendation.allowedHosts` (deprecated) | JSON (`["www.example.com"]`) |
| `AMW_RECOMMENDATION_DAILY_LIMIT` | `Recommendation.dailyLimit` | JSON |
| `AMW_RECOMMENDATION_FALLBACK` | `Recommendation.fallback` | JSON |
| `SERVER_TRUST_PROXY` | `Server.trustProxy` | JSON (`1`, `false`, or a list such as `["loopback","10.0.0.0/8"]`) |
| `REDIS_ENABLED` | `Redis.enabled` | JSON |
| `REDIS_HOST` | `Redis.host` | string |
| `REDIS_PORT` | `Redis.port` | JSON |
| `REDIS_USERNAME` | `Redis.username` | string |
| `REDIS_PASSWORD` | `Redis.password` | string |
| `REDIS_STALE_EXPIRE` | `Redis.staleExpire` | JSON |
| `REDIS_NOT_FOUND_EXPIRE` | `Redis.notFoundExpire` | JSON |
| `AMW_ADMIN_ENABLED` | `Admin.enabled` | JSON |
| `AMW_ADMIN_TOKEN_TTL` | `Admin.tokenTtl` | JSON |
| `AMW_ADMIN_LOGIN_RATE_LIMIT` | `Admin.loginRateLimit` | JSON |
| `AMW_ADMIN_INSIGHTS` | `Admin.insights` | JSON |

`Amazon.condition`, `Server.httpCache` and `Redis.expire` have no
variable: set them in a YAML file (for Docker, a mounted
[`local.yml`](docker.md#settings-without-an-environment-variable)).

[`.env.example`](https://github.com/ltoinel/amw/blob/develop/.env.example) lists the
variables: copy it to `.env`, which is never committed. Both Docker Compose files and
`docker run --env-file .env` read it; for a local Node.js run, export the variables in
your shell.

Other variables:

| Variable | Effect |
|---|---|
| `NODE_ENV` | Selects `config/<NODE_ENV>.yml`. Defaults to `production`; the Docker image sets `docker`. |
| `NODE_CONFIG` | JSON document merged on top of everything else, e.g. `NODE_CONFIG='{"Server":{"httpCache":86400}}'`. |
| `NODE_CONFIG_DIR` | Directory containing the configuration files (default: `./config`). |
| `AMW_ADMIN_PASSWORD` | Admin portal password (required when `Admin.enabled`, 12 characters at least). |
| `AMW_ADMIN_SECRET` | Signing key of the admin tokens; random when unset, which logs admins out on every restart. |
| `ANTHROPIC_API_KEY` | Claude API key used by the AI insights (`Admin.insights`). |
| `AMW_DEV_PORT` | Host port of the development container (default `8080`), see [Development environment](../developer/environment.md#docker-development-environment). |

## Docker defaults

`config/docker.yml` as shipped in the image (credentials are empty on purpose: provide
them with environment variables):

```yaml
--8<-- "config/docker.yml"
```

## Development defaults

`config/development.yml`, loaded by `npm run dev` and the dev container:

```yaml
--8<-- "config/development.yml"
```

## Complete sample

`config/sample.yml`, the starting point for `config/production.yml`:

```yaml
--8<-- "config/sample.yml"
```
