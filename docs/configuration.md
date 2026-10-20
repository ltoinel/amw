# Configuration

AMW is configured with [node-config](https://github.com/node-config/node-config) YAML
files located in the `config/` directory of the **current working directory**.

## Which file is loaded?

`NODE_ENV` selects the file; AMW sets it to `production` when it is not defined.

| `NODE_ENV` | File | Typical use |
|---|---|---|
| `production` (default) | `config/production.yml` | npm / Node.js installs; create it from `config/sample.yml` |
| `docker` | `config/docker.yml` | set by the Docker image |
| `development` | `config/development.yml` | `npm run dev` |

node-config then merges, in this order, `local.yml` and `local-<NODE_ENV>.yml` if they
exist, and finally the `NODE_CONFIG` environment variable. Later sources override
earlier ones key by key, which is how the Docker image is customized (see
[Run with Docker](getting-started/docker.md#provide-your-configuration)).

!!! danger "Never commit credentials"
    `config/production.yml` and every file in `config/` other than `sample.yml` and
    `docker.yml` are git-ignored and excluded from the npm package and Docker image.
    Keep it that way.

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

### Server

| Key | `sample.yml` | `docker.yml` | Description |
|---|---|---|---|
| `Server.port` | `8080` | `9080` | HTTP port (1-65535). Falls back to `8080` if empty or `0`. |
| `Server.debug` | `true` | `false` | `true` switches AMW loggers to debug level (full Amazon responses are logged) and exposes error messages in unexpected HTTP 500 responses. Use `false` in production. |
| `Server.path` | `/amw` | `/item` | Base path of every endpoint. Must start with `/`; defaults to `/amw` if empty. The widget expects `/item`, see [API location](widget.md#api-location). |
| `Server.cors` | `false` | `false` | `true` adds `Access-Control-Allow-Origin: *` to every response. Only needed if pages on other origins call the API directly. |
| `Server.projectDir` | `<PATH>` | `/app/` | **Required.** Directory that contains `dist/widgets/widget.js` (repository clone, installed npm package, or `/app/` in Docker). The path must not contain hidden (dot) directories: the file is then refused and `/widget.js` answers 500. |
| `Server.httpCache` | `3600` | `604800` | `max-age` in seconds sent in the `Cache-Control` header of every response. Falls back to `300` if empty or `0`; must not be negative. |
| `Server.rateLimit` | `120` | `120` | Maximum `/product` requests per client IP per one-minute window; beyond it AMW answers HTTP 429. Defaults to `120` when the key is absent. Counters are kept in memory, per AMW process. |
| `Server.trustProxy` | `false` | `1` | Express [`trust proxy`](https://expressjs.com/en/guide/behind-proxies.html) setting, which decides how the client IP is derived from `X-Forwarded-For`: `false` (use the socket address), a number of proxy hops (e.g. `1` behind a single NGINX), or a list of trusted addresses/subnets such as `loopback, 10.0.0.0/8`. Avoid `true`: it trusts any `X-Forwarded-For` value. Defaults to `false` when absent. |

### Redis

| Key | `sample.yml` | `docker.yml` | Description |
|---|---|---|---|
| `Redis.enabled` | `false` | (placeholder) | Must be the boolean `true` to enable the cache; any other value disables it. |
| `Redis.host` | `localhost` | (placeholder) | Redis host. |
| `Redis.port` | `6379` | (placeholder) | Redis port. |
| `Redis.username` | empty | (placeholder) | Redis ACL user name (optional). |
| `Redis.password` | empty | (placeholder) | Redis password (optional). |
| `Redis.expire` | `3600` | `2630000` | Time to live of cached products, in seconds (`2630000` is about one month). Must be positive; defaults to `3600` if empty or `0`. |

When Redis is enabled, AMW connects at startup; if Redis becomes unavailable later,
requests still succeed by calling Amazon directly, and `/health` reports
`"redis": "disconnected"`.

## Docker defaults

`config/docker.yml` as shipped in the image:

```yaml
--8<-- "config/docker.yml"
```

The `${...}` placeholders are **not** expanded by node-config: override the `Amazon`
and `Redis` sections with a mounted `local.yml` or `NODE_CONFIG`.

## Environment variables

| Variable | Effect |
|---|---|
| `NODE_ENV` | Selects `config/<NODE_ENV>.yml`. Defaults to `production`; the Docker image sets `docker`. |
| `NODE_CONFIG` | JSON document merged on top of all files, e.g. `NODE_CONFIG='{"Amazon":{"partnerTag":"mytag-21"},"Redis":{"enabled":true,"host":"redis"}}'`. Handy for container secrets. |
| `NODE_CONFIG_DIR` | Directory containing the configuration files (default: `./config`). |

## Complete sample

`config/sample.yml`, the starting point for `config/production.yml`:

```yaml
--8<-- "config/sample.yml"
```
